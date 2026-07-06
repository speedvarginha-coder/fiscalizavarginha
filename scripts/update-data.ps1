param(
  [switch]$SkipTests,
  [switch]$SkipPackage,
  [switch]$OnlyIfChanged,

  [ValidateSet("Full", "Sapl", "NoHeavy")]
  [string]$CollectorMode = "Full"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$painel = Join-Path $root "painel-cidadao"
$dataDir = Join-Path $painel "data"
$dataJs = Join-Path $painel "data.js"
$logDir = Join-Path $root "private\logs"
$backupRoot = Join-Path $root "private\backups"
$lockPath = Join-Path $logDir "coleta.lock"
$logPath = Join-Path $logDir ("coleta-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
$backupPath = $null

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] " + $Message
  Write-Host $line
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

function Invoke-AndLog {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  Write-Log $Label
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments 2>&1 | ForEach-Object { Write-Log $_ }
    if ($LASTEXITCODE -ne 0) {
      throw "$Label falhou com codigo $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function New-PublishedDataBackup {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $dest = Join-Path $backupRoot ("coleta-" + $stamp)
  New-Item -ItemType Directory -Force -Path $dest | Out-Null

  if (Test-Path $dataDir) {
    Copy-Item -LiteralPath $dataDir -Destination (Join-Path $dest "data") -Recurse -Force
  }
  if (Test-Path $dataJs) {
    Copy-Item -LiteralPath $dataJs -Destination (Join-Path $dest "data.js") -Force
  }

  Write-Log "Backup dos dados publicado em: $dest"
  return $dest
}

function Restore-PublishedDataBackup {
  param([string]$Backup)
  if (-not $Backup -or -not (Test-Path $Backup)) {
    Write-Log "Sem backup disponivel para rollback."
    return
  }

  $backupData = Join-Path $Backup "data"
  $backupDataJs = Join-Path $Backup "data.js"

  Write-Log "Restaurando dados anteriores a partir do backup."
  if (Test-Path $backupData) {
    if (Test-Path $dataDir) {
      Remove-Item -LiteralPath $dataDir -Recurse -Force
    }
    Copy-Item -LiteralPath $backupData -Destination $dataDir -Recurse -Force
  }
  if (Test-Path $backupDataJs) {
    Copy-Item -LiteralPath $backupDataJs -Destination $dataJs -Force
  }
}

function Remove-OldBackups {
  Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 8 |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Recurse -Force
    }
}

function Invoke-SourceProbe {
  param([switch]$Record)

  $args = @("scripts/check-source-updates.mjs")
  if ($Record) { $args += "--record" }

  Push-Location $root
  try {
    & node @args 2>&1 | ForEach-Object { Write-Log $_ }
    return $LASTEXITCODE
  } finally {
    Pop-Location
  }
}

if (Test-Path $lockPath) {
  $lockAge = (Get-Date) - (Get-Item -LiteralPath $lockPath).LastWriteTime
  if ($lockAge.TotalHours -lt 6) {
    Write-Log "Outra coleta parece estar em andamento. Lock: $lockPath"
    exit 2
  }
  Write-Log "Lock antigo detectado; removendo."
  Remove-Item -LiteralPath $lockPath -Force
}

Set-Content -LiteralPath $lockPath -Value (Get-Date -Format "o") -Encoding UTF8

try {
  Write-Log "Iniciando coleta automatica."
  Write-Log "Projeto: $root"
  Write-Log "Modo do coletor: $CollectorMode"

  if ($OnlyIfChanged) {
    Write-Log "Verificando se fontes mudaram antes de coletar."
    $probeCode = Invoke-SourceProbe
    if ($probeCode -eq 0) {
      Write-Log "Nenhuma mudanca detectada; coleta pulada."
      exit 0
    }
    Write-Log "Mudanca, defasagem ou falha de verificacao detectada; seguindo com coleta."
  }

  $backupPath = New-PublishedDataBackup

  $collectorArgs = @("-u", "coletor.py")
  if ($CollectorMode -eq "Sapl") {
    $collectorArgs += "--so-sapl"
  } elseif ($CollectorMode -eq "NoHeavy") {
    $collectorArgs += "--sem-pncp"
    $collectorArgs += "--sem-pessoal"
  }

  Invoke-AndLog `
    -Label "Rodando coletor.py." `
    -FilePath "python" `
    -Arguments $collectorArgs `
    -WorkingDirectory $painel

  Push-Location $root
  try {
    Invoke-AndLog `
      -Label "Gerando indice de relevancia parlamentar." `
      -FilePath "npm.cmd" `
      -Arguments @("run", "data:indice") `
      -WorkingDirectory $root

    $previousChunks = $null
    if ($backupPath) {
      $candidate = Join-Path $backupPath "data\chunks"
      if (Test-Path $candidate) {
        $previousChunks = $candidate
        $env:FISCALIZA_PREVIOUS_CHUNKS = $previousChunks
        Write-Log "Snapshot comparativo usara backup anterior: $previousChunks"
      }
    }

    Invoke-AndLog `
      -Label "Validando dados e sincronizando bundle offline." `
      -FilePath "npm.cmd" `
      -Arguments @("run", "validate:data") `
      -WorkingDirectory $root

    if ($previousChunks) {
      Remove-Item Env:\FISCALIZA_PREVIOUS_CHUNKS -ErrorAction SilentlyContinue
    }

    # Gate rápido de integridade dos dados — roda SEMPRE, mesmo com -SkipTests,
    # para que o vigia (watch) nunca publique chunks com formato/cálculo quebrado.
    Invoke-AndLog `
      -Label "Gate rápido de dados (sintaxe + cálculos)." `
      -FilePath "npm.cmd" `
      -Arguments @("run", "test:data") `
      -WorkingDirectory $root

    if (-not $SkipTests) {
      Invoke-AndLog `
        -Label "Rodando testes Playwright (suíte completa)." `
        -FilePath "npm.cmd" `
        -Arguments @("test") `
        -WorkingDirectory $root
    }

    if (-not $SkipPackage) {
      Invoke-AndLog `
        -Label "Gerando pacote limpo." `
        -FilePath "npm.cmd" `
        -Arguments @("run", "deploy:zip") `
        -WorkingDirectory $root

      Invoke-AndLog `
        -Label "Validando pacote limpo." `
        -FilePath "npm.cmd" `
        -Arguments @("run", "validate:deploy") `
        -WorkingDirectory $root
    }
  } finally {
    Pop-Location
  }

  Write-Log "Registrando assinaturas atuais das fontes."
  $recordCode = Invoke-SourceProbe -Record
  if ($recordCode -ne 0) {
    Write-Log "Aviso: registro de assinaturas retornou codigo $recordCode."
  }

  Write-Log "Disparando alertas automatizados para o WhatsApp."
  try {
    & python (Join-Path $painel "alertar_whatsapp.py") 2>&1 | ForEach-Object { Write-Log $_ }
  } catch {
    Write-Log "Aviso: falha ao enviar alertas do WhatsApp: $_"
  }

  Remove-OldBackups
  Write-Log "Coleta automatica concluida com sucesso."
  exit 0
} catch {
  Write-Log ("ERRO: " + $_.Exception.Message)
  Restore-PublishedDataBackup -Backup $backupPath
  exit 1
} finally {
  if (Test-Path $lockPath) {
    Remove-Item -LiteralPath $lockPath -Force
  }
}
