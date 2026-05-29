param(
  [switch]$SkipTests,
  [switch]$SkipPackage
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$painel = Join-Path $root "painel-cidadao"
$logDir = Join-Path $root "private\logs"
$lockPath = Join-Path $logDir "coleta.lock"
$logPath = Join-Path $logDir ("coleta-" + (Get-Date -Format "yyyy-MM-dd") + ".log")

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] " + $Message
  Write-Host $line
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
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

  Push-Location $painel
  try {
    & python coletor.py 2>&1 | ForEach-Object { Write-Log $_ }
    if ($LASTEXITCODE -ne 0) {
      throw "coletor.py falhou com codigo $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }

  Write-Log "Validando dados."
  Push-Location $root
  try {
    & npm.cmd run validate:data 2>&1 | ForEach-Object { Write-Log $_ }
    if ($LASTEXITCODE -ne 0) {
      throw "validate:data falhou com codigo $LASTEXITCODE"
    }

    if (-not $SkipTests) {
      Write-Log "Rodando testes Playwright."
      & npm.cmd test 2>&1 | ForEach-Object { Write-Log $_ }
      if ($LASTEXITCODE -ne 0) {
        throw "npm test falhou com codigo $LASTEXITCODE"
      }
    }

    if (-not $SkipPackage) {
      Write-Log "Gerando pacote limpo."
      & npm.cmd run deploy:zip 2>&1 | ForEach-Object { Write-Log $_ }
      if ($LASTEXITCODE -ne 0) {
        throw "deploy:zip falhou com codigo $LASTEXITCODE"
      }

      Write-Log "Validando pacote limpo."
      & npm.cmd run validate:deploy 2>&1 | ForEach-Object { Write-Log $_ }
      if ($LASTEXITCODE -ne 0) {
        throw "validate:deploy falhou com codigo $LASTEXITCODE"
      }
    }
  } finally {
    Pop-Location
  }

  Write-Log "Coleta automatica concluida com sucesso."
  exit 0
} catch {
  Write-Log ("ERRO: " + $_.Exception.Message)
  exit 1
} finally {
  if (Test-Path $lockPath) {
    Remove-Item -LiteralPath $lockPath -Force
  }
}
