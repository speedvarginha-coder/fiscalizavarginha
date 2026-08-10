$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$bridge = Join-Path $root "painel-cidadao\whatsapp-bridge"
$state = Join-Path $root "private\state"
$stdout = Join-Path $state "whatsapp-bridge-service.log"
$stderr = Join-Path $state "whatsapp-bridge-service-error.log"

New-Item -ItemType Directory -Path $state -Force | Out-Null
$env:LOCAL_DASHBOARD_NO_AUTH = "1"

Push-Location $bridge
try {
  # A ponte e um servico permanente. Erros transitórios do WhatsApp (como 503)
  # podem encerrar o processo Node mesmo depois de uma reconexao aparente. O
  # Agendador reinicia a tarefa apenas algumas vezes; este supervisor mantem a
  # ponte viva e aplica espera progressiva quando o processo cai repetidamente.
  $falhasRapidas = 0
  while ($true) {
    $inicio = Get-Date
    # No Windows PowerShell 5.1, qualquer linha escrita por um executavel em
    # stderr vira NativeCommandError quando a preferencia e Stop, mesmo que o
    # processo continue saudavel. O Baileys usa stderr para avisos normais.
    $preferenciaAnterior = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      & node.exe server.js 1>> $stdout 2>> $stderr
      $codigo = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $preferenciaAnterior
    }
    $duracao = ((Get-Date) - $inicio).TotalSeconds

    if ($duracao -ge 300) {
      $falhasRapidas = 0
    } else {
      $falhasRapidas++
    }

    $espera = [Math]::Min(60, [Math]::Max(5, 5 * [Math]::Pow(2, [Math]::Min($falhasRapidas - 1, 4))))
    $linha = "[{0}] Processo da ponte encerrou com codigo {1} apos {2:N0}s; reiniciando em {3:N0}s." -f `
      (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $codigo, $duracao, $espera
    Add-Content -LiteralPath $stderr -Value $linha -Encoding UTF8
    Start-Sleep -Seconds $espera
  }
} finally {
  Pop-Location
}
