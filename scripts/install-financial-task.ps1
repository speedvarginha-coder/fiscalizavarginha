param(
  [string]$At = "05:15",
  [string]$TaskName = "Fiscaliza Varginha - Emendas e diarias"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$script = Join-Path $root "scripts\update-financial-data.ps1"
if (-not (Test-Path -LiteralPath $script)) {
  throw "Atualizador financeiro nao encontrado: $script"
}

$arguments = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-WindowStyle", "Hidden",
  "-File", "`"$script`""
)
$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument ($arguments -join " ") `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -WakeToRun `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -RestartCount 2 `
  -RestartInterval (New-TimeSpan -Minutes 15)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Atualiza emendas federais, estaduais e diarias; valida e preserva a ultima base integra." `
  -Force | Out-Null

Write-Host "Tarefa instalada: $TaskName"
Write-Host "Horario diario: $At"
Write-Host "WhatsApp: nao executado"
