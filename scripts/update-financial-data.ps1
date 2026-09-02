param(
  [switch]$SkipFederal,
  [switch]$SkipState,
  [switch]$SkipTesouro,
  [switch]$SkipDiarias
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$painel = Join-Path $root "painel-cidadao"
$emendas = Join-Path $painel "emendas"
$logDir = Join-Path $root "private\logs"
$backupRoot = Join-Path $root "private\backups"
$stateDir = Join-Path $root "private\state"
$lockPath = Join-Path $logDir "coleta.lock"
$logPath = Join-Path $logDir ("financeiro-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
$lockToken = $null
$backupPath = $null
$sourceStatus = [ordered]@{ federal = "pulado"; tesouro = "pulado"; estadual = "pulado"; diarias = "pulado" }

New-Item -ItemType Directory -Force -Path $logDir,$backupRoot,$stateDir | Out-Null

function Write-FinancialLog {
  param([string]$Message)
  $line = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] " + $Message
  try { Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 } catch {}
  Write-Host $line
}

function Acquire-FinancialLock {
  if (Test-Path -LiteralPath $lockPath) {
    $parts = ([System.IO.File]::ReadAllText($lockPath, [System.Text.Encoding]::UTF8)) -split "\|"
    $ownerPid = 0
    $ownerAlive = $parts.Count -ge 2 -and [int]::TryParse($parts[0], [ref]$ownerPid) -and
      $parts[1] -eq $env:COMPUTERNAME -and $null -ne (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)
    if ($ownerAlive) {
      Write-FinancialLog "Outra coleta esta em andamento; ciclo financeiro pulado sem alterar dados."
      return $null
    }
    Write-FinancialLog "Lock orfao removido antes do ciclo financeiro."
    Remove-Item -LiteralPath $lockPath -Force
  }
  $token = "{0}|{1}|{2}|{3}" -f $PID, $env:COMPUTERNAME, (Get-Date).ToUniversalTime().ToString("o"), ([guid]::NewGuid())
  $stream = New-Object System.IO.FileStream($lockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($token)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  } finally {
    $stream.Dispose()
  }
  return $token
}

function Invoke-FinancialStep {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [int[]]$AcceptedExitCodes = @(0)
  )
  Write-FinancialLog $Label
  Push-Location $WorkingDirectory
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $FilePath @Arguments 2>&1 | ForEach-Object { Write-FinancialLog "$_" }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
    Pop-Location
  }
  if ($AcceptedExitCodes -notcontains $code) {
    throw "$Label falhou com codigo $code"
  }
  return $code
}

function New-FinancialBackup {
  $destination = Join-Path $backupRoot ("financeiro-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  $files = @(
    "painel-cidadao\data\chunks\diarias.json",
    "painel-cidadao\data\chunks\federal.json",
    "painel-cidadao\data\chunks\chat_context.json",
    "painel-cidadao\data\manifest.json",
    "painel-cidadao\data.js",
    "painel-cidadao\emendas\data\emendas_federais.js",
    "painel-cidadao\emendas\data\emendas_tesouro.js",
    "painel-cidadao\emendas\data\emendas_estaduais_normalizadas.js"
  )
  $manifest = @()
  foreach ($relative in $files) {
    $source = Join-Path $root $relative
    if (Test-Path -LiteralPath $source) {
      $safeName = $relative.Replace("\", "__")
      Copy-Item -LiteralPath $source -Destination (Join-Path $destination $safeName) -Force
      $manifest += [pscustomobject]@{ relative = $relative; backup = $safeName }
    }
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination "manifest.json") -Encoding UTF8
  return $destination
}

function Restore-FinancialBackup {
  param([string]$Backup)
  $manifestPath = Join-Path $Backup "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath)) { return }
  $manifest = @(Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json)
  foreach ($item in $manifest) {
    $source = Join-Path $Backup $item.backup
    $target = Join-Path $root $item.relative
    if (Test-Path -LiteralPath $source) {
      Copy-Item -LiteralPath $source -Destination $target -Force
    }
  }
  Write-FinancialLog "Dados financeiros restaurados do backup $Backup."
}

try {
  $lockToken = Acquire-FinancialLock
  if (-not $lockToken) { exit 0 }
  $backupPath = New-FinancialBackup

  if (-not $SkipDiarias) {
    Invoke-FinancialStep "Atualizando diarias da Prefeitura e da Camara." "python" @("-u", "coletor.py", "--so-diarias") $painel | Out-Null
    $sourceStatus.diarias = "ok"
  }
  if (-not $SkipFederal) {
    $code = Invoke-FinancialStep "Atualizando emendas federais CGU e Transferegov." "python" @("-u", "coletor_emendas_federais.py") $emendas @(0, 2)
    $sourceStatus.federal = if ($code -eq 0) { "ok" } else { "preservado" }
    Invoke-FinancialStep "Normalizando emendas federais." "python" @("-u", "normalizar_emendas_federais.py") $emendas | Out-Null
    Invoke-FinancialStep "Sincronizando resumo federal, convenios e Transferegov." "python" @("-u", "coletor_federal.py") $painel | Out-Null
  }
  if (-not $SkipTesouro) {
    $code = Invoke-FinancialStep "Atualizando ordens bancarias federais do Tesouro Transparente." "python" @("-u", "coletor_emendas_tesouro.py") $emendas @(0, 2)
    $sourceStatus.tesouro = if ($code -eq 0) { "ok" } else { "preservado" }
  }
  if (-not $SkipState) {
    $code = Invoke-FinancialStep "Atualizando emendas estaduais oficiais." "python" @("-u", "coletor_emendas_estaduais.py") $emendas @(0, 2)
    $sourceStatus.estadual = if ($code -eq 0) { "ok" } else { "preservado" }
  }

  Invoke-FinancialStep "Auditando emendas federais e estaduais." "python" @("-u", "audit_emendas.py") $emendas | Out-Null
  Invoke-FinancialStep "Regenerando contexto factual do site." "npm.cmd" @("run", "data:chat") $root | Out-Null
  Invoke-FinancialStep "Sincronizando bundle e manifesto." "npm.cmd" @("run", "data:bundle") $root | Out-Null
  Invoke-FinancialStep "Validando schemas financeiros." "npm.cmd" @("run", "data:schema") $root | Out-Null
  Invoke-FinancialStep "Conferindo numeros publicados." "npm.cmd" @("run", "test:numeros") $root | Out-Null

  $state = [ordered]@{
    executado_em = (Get-Date).ToString("o")
    status = "sucesso"
    fontes = $sourceStatus
    whatsapp = "fora_do_escopo"
  }
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stateDir "financial-update.json") -Encoding UTF8
  Write-FinancialLog ("Ciclo financeiro concluido: " + (($sourceStatus.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ", "))
  exit 0
} catch {
  Write-FinancialLog ("ERRO: " + $_.Exception.Message)
  if ($backupPath) { Restore-FinancialBackup -Backup $backupPath }
  $state = [ordered]@{
    executado_em = (Get-Date).ToString("o")
    status = "falha"
    erro = $_.Exception.Message
    fontes = $sourceStatus
  }
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stateDir "financial-update.json") -Encoding UTF8
  exit 1
} finally {
  if ($lockToken -and (Test-Path -LiteralPath $lockPath)) {
    $currentToken = [System.IO.File]::ReadAllText($lockPath, [System.Text.Encoding]::UTF8)
    if ($currentToken -eq $lockToken) {
      Remove-Item -LiteralPath $lockPath -Force
    }
  }
}
