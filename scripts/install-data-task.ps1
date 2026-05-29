param(
  [ValidateSet("Daily", "Watch")]
  [string]$Mode = "Daily",

  [string]$At = "06:30",

  [int]$IntervalMinutes = 180,

  [switch]$SkipTests,
  [switch]$SkipPackage,

  [string]$TaskName = "Fiscaliza Varginha - Atualizar dados"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$updateScript = Join-Path $root "scripts\update-data.ps1"

if (-not (Test-Path $updateScript)) {
  throw "Script de atualizacao nao encontrado: $updateScript"
}

$argList = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", "`"$updateScript`""
)

if ($SkipTests) { $argList += "-SkipTests" }
if ($SkipPackage) { $argList += "-SkipPackage" }

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument ($argList -join " ") `
  -WorkingDirectory $root

if ($Mode -eq "Daily") {
  $trigger = New-ScheduledTaskTrigger -Daily -At $At
} else {
  $start = (Get-Date).Date.AddMinutes(5)
  $trigger = New-ScheduledTaskTrigger -Once -At $start `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
}

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Atualiza dados do Fiscaliza Varginha, valida e gera pacote limpo." `
  -Force | Out-Null

Write-Host "Tarefa instalada/atualizada:"
Write-Host "  $TaskName"
if ($Mode -eq "Daily") {
  Write-Host "Modo:"
  Write-Host "  Diario as $At"
} else {
  Write-Host "Modo:"
  Write-Host "  Vigia a cada $IntervalMinutes minutos"
}
Write-Host "Logs:"
Write-Host "  $(Join-Path $root 'private\logs')"
