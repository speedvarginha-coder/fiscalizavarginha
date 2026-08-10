<#
.SYNOPSIS
  Agenda a publicacao automatica dos resumos semanal e mensal.

.DESCRIPTION
  Semanal  - toda sexta, cobre segunda ate a propria sexta.
  Mensal   - todo dia 1o, cobre o mes anterior ja fechado.

  Publicar no dia 1o em vez do ultimo dia do mes e deliberado: no ultimo dia o
  mes ainda nao acabou e o resumo sairia incompleto, sem os atos daquele dia.

  Cada execucao gera a pagina, publica no site e avisa o grupo com o link. Se o
  deploy falhar ou a pagina nao responder 200, a mensagem NAO e enviada.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-resumo-tasks.ps1
  powershell -ExecutionPolicy Bypass -File scripts\install-resumo-tasks.ps1 -Remover
#>
param(
  [string]$HoraSemanal = "19:30",
  [string]$HoraMensal  = "09:00",
  [switch]$Remover
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$tarefaSemanal = "Fiscaliza Varginha - Resumo semanal"
$tarefaMensal  = "Fiscaliza Varginha - Resumo mensal"

function Remove-TarefaSeExistir([string]$nome) {
  $existente = Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
  if ($existente) {
    Unregister-ScheduledTask -TaskName $nome -Confirm:$false
    Write-Host "Removida: $nome"
  }
}

if ($Remover) {
  Remove-TarefaSeExistir $tarefaSemanal
  Remove-TarefaSeExistir $tarefaMensal
  Write-Host "Agendamentos de resumo removidos."
  return
}

$node = (Get-Command node).Source
$script = Join-Path $root "scripts\publicar-resumo.mjs"
if (-not (Test-Path $script)) { throw "Nao encontrei $script" }

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
  -MultipleInstances IgnoreNew

# --- Semanal: sexta-feira ---
Remove-TarefaSeExistir $tarefaSemanal
Register-ScheduledTask `
  -TaskName $tarefaSemanal `
  -Action (New-ScheduledTaskAction -Execute $node `
            -Argument "`"$script`" --tipo=semanal" -WorkingDirectory $root) `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Friday -At $HoraSemanal) `
  -Settings $settings `
  -Description "Gera, publica e divulga no grupo o resumo da semana (segunda a sexta)." | Out-Null
Write-Host "Agendada: $tarefaSemanal - sextas as $HoraSemanal"

# --- Mensal: dia 1o ---
# Register-ScheduledTask nao oferece gatilho mensal, e passar o comando por
# schtasks.exe esbarra no escape de aspas do PowerShell (caminhos com espaco
# viram argumentos separados). Gatilho diario + guarda --so-no-dia=1 no proprio
# script resolve com o mesmo caminho de codigo do semanal.
Remove-TarefaSeExistir $tarefaMensal
Register-ScheduledTask `
  -TaskName $tarefaMensal `
  -Action (New-ScheduledTaskAction -Execute $node `
            -Argument "`"$script`" --tipo=mensal --so-no-dia=1" -WorkingDirectory $root) `
  -Trigger (New-ScheduledTaskTrigger -Daily -At $HoraMensal) `
  -Settings $settings `
  -Description "Publica no dia 1o o resumo do mes anterior fechado; nos demais dias sai sem fazer nada." | Out-Null
Write-Host "Agendada: $tarefaMensal - diaria as $HoraMensal, publica so no dia 1o"

Write-Host ""
Write-Host "Conferir:  Get-ScheduledTask | Where-Object { `$_.TaskName -like '*Resumo*' }"
Write-Host "Testar sem publicar:  node scripts\publicar-resumo.mjs --tipo=semanal --seco"
