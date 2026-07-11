$root = $PSScriptRoot
$Action = New-ScheduledTaskAction -Execute (Join-Path $root "automacao_diaria.bat") -WorkingDirectory $root

$Trigger1 = New-ScheduledTaskTrigger -Daily -At 08:00am
$Trigger2 = New-ScheduledTaskTrigger -Daily -At 12:00pm
$Trigger3 = New-ScheduledTaskTrigger -Daily -At 06:00pm

# Allow it to run even on laptop battery, run as soon as possible if missed, require network
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RunOnlyIfNetworkAvailable

Write-Host "Registrando a tarefa no Agendador do Windows..."
Register-ScheduledTask -Action $Action -Trigger $Trigger1, $Trigger2, $Trigger3 -Settings $Settings -TaskName "FiscalizaVarginha_Pipeline" -Description "Roda a coleta, deploy e envio de mensagens WhatsApp do Fiscaliza Varginha diariamente." -Force

Write-Host "Pronto! Automação configurada com sucesso para 08:00, 12:00 e 18:00."
