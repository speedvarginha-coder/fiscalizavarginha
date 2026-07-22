param(
  [string]$DailyAt = "06:30",
  [int]$WatchIntervalMinutes = 60
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$installer = Join-Path $root "scripts\install-data-task.ps1"
$healthScript = Join-Path $root "scripts\check-pipeline-health.mjs"

if (-not (Test-Path $installer)) { throw "Instalador nao encontrado: $installer" }

Write-Host "Configurando tarefas canonicas do Fiscaliza Varginha..."

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer `
  -Mode Daily -At $DailyAt -GitSync `
  -TaskName "Fiscaliza Varginha - Atualizacao diaria"
if ($LASTEXITCODE -ne 0) { throw "Falha ao configurar coleta diaria." }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer `
  -Mode Watch -IntervalMinutes $WatchIntervalMinutes `
  -OnlyIfChanged -GitSync -SkipSlowAudits `
  -TaskName "Fiscaliza Varginha - Vigia rapida"
if ($LASTEXITCODE -ne 0) { throw "Falha ao configurar vigia rapida." }

$node = (Get-Command node.exe -ErrorAction Stop).Source
$watchdogAction = New-ScheduledTaskAction `
  -Execute $node `
  -Argument 'scripts\check-pipeline-health.mjs --tarefa=watchdog-independente' `
  -WorkingDirectory $root
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(10) `
  -RepetitionInterval (New-TimeSpan -Hours 2) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$watchdogSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -MultipleInstances IgnoreNew
Register-ScheduledTask `
  -TaskName "Fiscaliza Varginha - Watchdog Independente" `
  -Action $watchdogAction -Trigger $watchdogTrigger -Settings $watchdogSettings `
  -Description "Monitora heartbeat e ultimo sucesso da coleta do Fiscaliza Varginha." `
  -Force | Out-Null

# Tarefas antigas deste mesmo repositorio. Apenas desabilita (reversivel);
# nao toca nas tarefas do projeto separado "4_Fiscaliza Robo-Auditor".
$legacyTasks = @(
  "Fiscaliza Varginha - Atualizar dados",
  "FiscalizaVarginha_Pipeline",
  "FiscalizaVarginha_EmendasFederais"
)
foreach ($taskName in $legacyTasks) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) {
    Disable-ScheduledTask -TaskName $taskName | Out-Null
    Write-Host "Tarefa legada desabilitada: $taskName"
  }
}

Write-Host "Automacao organizada com sucesso."
Write-Host "  Coleta completa: diariamente as $DailyAt"
Write-Host "  Vigia leve: a cada $WatchIntervalMinutes minutos"
Write-Host "  Watchdog: a cada 2 horas"
Write-Host "  Protecao de sobreposicao: lock compartilhado; ciclo concorrente sai sem alterar dados."
