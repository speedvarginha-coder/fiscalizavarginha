$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name.Split("\")[-1]
$wrapper = Join-Path $root "scripts\run-update-task.ps1"
$bridgeWatchdog = Join-Path $root "scripts\check-whatsapp-bridge.mjs"
$externalBackupScript = Join-Path $root "scripts\backup-external.ps1"
$externalSiteScript = Join-Path $root "scripts\check-external-site.mjs"
$dailyReportScript = Join-Path $root "scripts\generate-daily-operational-report.mjs"
$node = (Get-Command node.exe -ErrorAction Stop).Source

function New-ResilientSettings {
  param(
    [TimeSpan]$ExecutionLimit,
    [int]$RestartCount,
    [TimeSpan]$RestartInterval
  )
  $params = @{
    AllowStartIfOnBatteries = $true
    DontStopIfGoingOnBatteries = $true
    StartWhenAvailable = $true
    WakeToRun = $true
    MultipleInstances = "IgnoreNew"
    Hidden = $true
    ExecutionTimeLimit = $ExecutionLimit
  }
  if ($RestartCount -gt 0) {
    $params.RestartCount = $RestartCount
    $params.RestartInterval = $RestartInterval
  }
  New-ScheduledTaskSettingsSet @params
}

function Update-TaskSettings {
  param(
    [string]$Name,
    [TimeSpan]$ExecutionLimit,
    [int]$RestartCount,
    [TimeSpan]$RestartInterval
  )
  $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
  if (-not $task) {
    Write-Warning "Tarefa ausente, sem ajuste: $Name"
    return
  }
  $settings = New-ResilientSettings -ExecutionLimit $ExecutionLimit -RestartCount $RestartCount -RestartInterval $RestartInterval
  Set-ScheduledTask -TaskName $Name -Settings $settings | Out-Null
  Write-Host "Resiliencia aplicada: $Name"
}

# Ligado na tomada, nunca suspende nem hiberna. A tela ainda pode apagar sem
# interromper as automacoes. Na bateria, o comportamento original e preservado.
& powercfg.exe /change standby-timeout-ac 0 | Out-Null
& powercfg.exe /change hibernate-timeout-ac 0 | Out-Null

# As tarefas de coleta usam um wrapper que transforma somente o codigo 4
# (WhatsApp indisponivel) em sucesso operacional. Assim o Agendador reinicia
# falhas reais de coleta/deploy, mas nao repete todo o ciclo por causa do canal.
$dailyAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
  '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -GitSync' -f $wrapper
) -WorkingDirectory $root
Set-ScheduledTask -TaskName "Fiscaliza Varginha - Atualizacao diaria" -Action $dailyAction | Out-Null

$watchAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
  '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -OnlyIfChanged -GitSync -SkipSlowAudits' -f $wrapper
) -WorkingDirectory $root
Set-ScheduledTask -TaskName "Fiscaliza Varginha - Vigia rapida" -Action $watchAction | Out-Null

Update-TaskSettings "Fiscaliza Varginha - Atualizacao diaria" (New-TimeSpan -Hours 4) 1 (New-TimeSpan -Minutes 20)
Update-TaskSettings "Fiscaliza Varginha - Vigia rapida" (New-TimeSpan -Hours 2) 2 (New-TimeSpan -Minutes 10)
Update-TaskSettings "Fiscaliza Varginha - Watchdog Independente" (New-TimeSpan -Minutes 15) 3 (New-TimeSpan -Minutes 2)
Update-TaskSettings "Fiscaliza Varginha - Desempenho do Site" (New-TimeSpan -Minutes 10) 2 (New-TimeSpan -Minutes 5)
Update-TaskSettings "Fiscaliza Varginha - Ponte WhatsApp" ([TimeSpan]::Zero) 10 (New-TimeSpan -Minutes 1)

$watchdogAction = New-ScheduledTaskAction -Execute $node -Argument ('"{0}"' -f $bridgeWatchdog) -WorkingDirectory $root
$watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$watchdogSettings = New-ResilientSettings -ExecutionLimit (New-TimeSpan -Minutes 2) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName "Fiscaliza Varginha - Vigia WhatsApp" `
  -Action $watchdogAction `
  -Trigger $watchdogTrigger `
  -Settings $watchdogSettings `
  -Principal $principal `
  -Description "Confere a ponte WhatsApp a cada 5 minutos e reinicia a tarefa apos duas falhas consecutivas." `
  -Force | Out-Null

$externalBackupAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
  '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $externalBackupScript
) -WorkingDirectory $root
$externalBackupTrigger = New-ScheduledTaskTrigger -Daily -At "07:30"
$externalBackupSettings = New-ResilientSettings -ExecutionLimit (New-TimeSpan -Hours 1) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask `
  -TaskName "Fiscaliza Varginha - Backup Externo" `
  -Action $externalBackupAction `
  -Trigger $externalBackupTrigger `
  -Settings $externalBackupSettings `
  -Principal $principal `
  -Description "Copia diariamente o ultimo backup validado para o Google Drive e confere o SHA-256." `
  -Force | Out-Null

$externalSiteAction = New-ScheduledTaskAction -Execute $node -Argument ('"{0}"' -f $externalSiteScript) -WorkingDirectory $root
$externalSiteTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
  -RepetitionInterval (New-TimeSpan -Minutes 10) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$externalSiteSettings = New-ResilientSettings -ExecutionLimit (New-TimeSpan -Minutes 2) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask `
  -TaskName "Fiscaliza Varginha - Monitor Externo" `
  -Action $externalSiteAction `
  -Trigger $externalSiteTrigger `
  -Settings $externalSiteSettings `
  -Principal $principal `
  -Description "Confere site, release e manifest publicados a cada 10 minutos." `
  -Force | Out-Null

$dailyReportAction = New-ScheduledTaskAction -Execute $node -Argument ('"{0}" --email' -f $dailyReportScript) -WorkingDirectory $root
$dailyReportTrigger = New-ScheduledTaskTrigger -Daily -At "08:45"
$dailyReportSettings = New-ResilientSettings -ExecutionLimit (New-TimeSpan -Minutes 10) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 3)
Register-ScheduledTask `
  -TaskName "Fiscaliza Varginha - Relatorio Operacional" `
  -Action $dailyReportAction `
  -Trigger $dailyReportTrigger `
  -Settings $dailyReportSettings `
  -Principal $principal `
  -Description "Gera e envia por e-mail o resumo diario de coleta, deploy, WhatsApp, fontes e backups." `
  -Force | Out-Null

Write-Host "Configuracao local de resiliencia concluida."
