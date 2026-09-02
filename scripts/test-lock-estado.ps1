# Trava do dono do lock de coleta.
#
# Em 20/08/2026 a vigia das 22:34 assumiu o lock de um ciclo completo que rodava
# desde as 17:25 e estava saudavel: a regra de idade (3h) nao distinguia "dono
# vivo" de "nao sei quem e o dono". Os dois ciclos passaram a escrever os mesmos
# chunks e o publicacoes_diario.json salvo as 20:40 desapareceu.
#
# Um ciclo completo passa de 5h, entao a regra de idade sozinha atropelaria
# TODA coleta completa. Aqui se cobra: dono vivo nunca e classificado como
# assumivel, por mais velho que o lock esteja.
$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$fonte = Get-Content -LiteralPath (Join-Path $root "scripts\update-data.ps1") -Raw

# update-data.ps1 executa a coleta ao ser carregado; extrai so as funcoes puras.
# Invoke-Expression dentro de function definiria as funcoes no escopo da
# function, nao no do script — por isso o texto e montado aqui e avaliado uma
# vez so, no nivel do script.
function Get-TextoFuncao {
  param([string]$Assinatura, [string]$Fonte)
  $inicio = $Fonte.IndexOf($Assinatura)
  if ($inicio -lt 0) { throw "$Assinatura nao encontrada em update-data.ps1" }
  $fim = $Fonte.IndexOf("`nfunction ", $inicio + 10)
  if ($fim -lt 0) { throw "nao achei o fim de $Assinatura" }
  return $Fonte.Substring($inicio, $fim - $inicio)
}
$puras = @(
  (Get-TextoFuncao -Assinatura "function Test-PodeSincronizarGit {" -Fonte $fonte),
  (Get-TextoFuncao -Assinatura "function Test-PodeAssumirLock {" -Fonte $fonte),
  (Get-TextoFuncao -Assinatura "function Get-LockEstado {" -Fonte $fonte)
) -join "`n"
Invoke-Expression $puras

$dir = Join-Path $root ("private\lock-tests\" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$lock = Join-Path $dir "coleta.lock"
$falhas = 0

function Assert-Estado {
  param([string]$Conteudo, [datetime]$Nascimento, [string]$Esperado, [string]$Caso)
  [System.IO.File]::WriteAllText($script:lock, $Conteudo, (New-Object System.Text.UTF8Encoding($false)))
  $obtido = Get-LockEstado -Caminho $script:lock -Nascimento $Nascimento
  if ($obtido -ne $Esperado) {
    Write-Output "FALHOU $Caso : esperado '$Esperado', obtido '$obtido'"
    $script:falhas++
  } else {
    Write-Output "ok  $Caso -> $obtido"
  }
}

try {
  $agora = Get-Date
  $meuProc = Get-Process -Id $PID

  # Dono vivo: este proprio processo, com lock nascido DEPOIS do inicio dele.
  Assert-Estado -Conteudo "$PID|$env:COMPUTERNAME|$($agora.ToUniversalTime().ToString('o'))|guid" `
    -Nascimento $agora -Esperado "vivo" -Caso "dono vivo com lock recente"

  # PID que nao existe: dono morreu.
  $pidMorto = 999999
  while (Get-Process -Id $pidMorto -ErrorAction SilentlyContinue) { $pidMorto-- }
  Assert-Estado -Conteudo "$pidMorto|$env:COMPUTERNAME|$($agora.ToUniversalTime().ToString('o'))|guid" `
    -Nascimento $agora -Esperado "orfao" -Caso "dono morto"

  # PID reciclado: processo comecou DEPOIS do lock nascer.
  Assert-Estado -Conteudo "$PID|$env:COMPUTERNAME|$($agora.ToUniversalTime().ToString('o'))|guid" `
    -Nascimento $meuProc.StartTime.AddMinutes(-30) -Esperado "orfao" -Caso "PID reciclado"

  # Outra maquina: nao da para inspecionar daqui.
  Assert-Estado -Conteudo "$PID|OUTRA-MAQUINA|$($agora.ToUniversalTime().ToString('o'))|guid" `
    -Nascimento $agora -Esperado "indeterminado" -Caso "lock de outra maquina"

  # Lock ilegivel.
  Assert-Estado -Conteudo "conteudo-sem-formato" `
    -Nascimento $agora -Esperado "indeterminado" -Caso "lock ilegivel"

  # ---- A decisao: e aqui que estava o bug de 20/08/2026 ----
  # A idade so pode autorizar a tomada quando o dono e indeterminado.
  $decisoes = @(
    @{ Estado = "vivo";          Idade = 0.1;  Esperado = $false; Caso = "vivo recente nao e assumido" },
    @{ Estado = "vivo";          Idade = 5.6;  Esperado = $false; Caso = "vivo ha 5h36 (ciclo completo) nao e assumido" },
    @{ Estado = "vivo";          Idade = 48.0; Esperado = $false; Caso = "vivo ha 48h ainda nao e assumido" },
    @{ Estado = "orfao";         Idade = 0.0;  Esperado = $true;  Caso = "orfao e assumido na hora" },
    @{ Estado = "indeterminado"; Idade = 2.9;  Esperado = $false; Caso = "indeterminado com menos de 3h espera" },
    @{ Estado = "indeterminado"; Idade = 3.1;  Esperado = $true;  Caso = "indeterminado com mais de 3h e assumido" }
  )
  foreach ($d in $decisoes) {
    $obtido = Test-PodeAssumirLock -Estado $d.Estado -IdadeHoras $d.Idade
    if ($obtido -ne $d.Esperado) {
      Write-Output "FALHOU $($d.Caso) : esperado $($d.Esperado), obtido $obtido"
      $falhas++
    } else {
      Write-Output "ok  $($d.Caso)"
    }
  }

  $syncs = @(
    @{ Branch = "master"; Ahead = 0;     Allow = $false; Esperado = $true;  Caso = "master sincronizada pode enviar dados" },
    @{ Branch = "master"; Ahead = 30;    Allow = $false; Esperado = $false; Caso = "commits pendentes bloqueiam push automatico" },
    @{ Branch = "master"; Ahead = 30;    Allow = $true;  Esperado = $true;  Caso = "override deliberado libera commits pendentes" },
    @{ Branch = "feature"; Ahead = 0;    Allow = $true;  Esperado = $false; Caso = "branch diferente nunca empurra master" },
    @{ Branch = "master"; Ahead = $null; Allow = $false; Esperado = $false; Caso = "estado remoto desconhecido falha fechado" }
  )
  foreach ($s in $syncs) {
    $obtido = Test-PodeSincronizarGit `
      -Branch $s.Branch `
      -CommitsPendentes $s.Ahead `
      -PermitirPendentes $s.Allow
    if ($obtido -ne $s.Esperado) {
      Write-Output "FALHOU $($s.Caso) : esperado $($s.Esperado), obtido $obtido"
      $falhas++
    } else {
      Write-Output "ok  $($s.Caso)"
    }
  }

  if ($falhas -gt 0) {
    throw "$falhas caso(s) do lock falharam."
  }
  Write-Output "`nOK - dono vivo do lock nunca e assumido, independente da idade."
} finally {
  Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}
