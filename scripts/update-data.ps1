param(
  [switch]$SkipTests,
  [switch]$SkipPackage,
  [switch]$SkipDeploy,
  [switch]$SkipWhatsApp,
  [switch]$GitSync,
  [switch]$OnlyIfChanged,
  # Pula as 3 varreduras externas lentas (CEIS/CNEP, TSE, PNCP-licitacoes) —
  # dados de sancao/doacao/licitacao nao mudam de hora em hora, e cada uma
  # bate uma API externa por ~15-40min. Feito para a vigia frequente rodar
  # rapido SEM abrir mao de deploy+whatsapp (isso continua ativo aqui —
  # a vigia so pula o que e caro e raramente muda, nao o que o cidadao
  # espera ver atualizado ao longo do dia).
  [switch]$SkipSlowAudits,

  [ValidateSet("Full", "Sapl", "NoHeavy")]
  [string]$CollectorMode = "Full"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$painel = Join-Path $root "painel-cidadao"
$dataDir = Join-Path $painel "data"
$dataJs = Join-Path $painel "data.js"
$emendasDataDir = Join-Path $painel "emendas\data"
$logDir = Join-Path $root "private\logs"
$backupRoot = Join-Path $root "private\backups"
$lockPath = Join-Path $logDir "coleta.lock"
$logPath = Join-Path $logDir ("coleta-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
$backupPath = $null
$lockToken = $null
$collectionStatus = "NAO_INICIADA"
$deployStatus = "PULADO"
$whatsAppStatus = "PULADO"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] " + $Message
  # ORDEM IMPORTA: arquivo ANTES do console.
  # A tarefa roda com console visivel (Hidden=False, LogonType=Interactive) e o
  # console do Windows vem com QuickEdit ligado: um clique que selecione texto
  # BLOQUEIA a escrita e congela o processo inteiro. Em 22/07/2026 um ciclo
  # ficou 3h vivo com 0,4s de CPU, sem uma linha no log, travando todos os
  # ciclos seguintes (MultipleInstances=IgnoreNew) — e ficamos cegos justamente
  # porque o Write-Host vinha primeiro e nunca chegava no arquivo.
  # Gravando antes, um travamento passa a deixar rastro ate o ponto exato.
  # Gravar o log NUNCA pode derrubar a coleta. Se o arquivo estiver preso por
  # outro processo (antivirus, backup/sync em nuvem, visualizador de log, um
  # `tail` aberto), o Add-Content lanca IOException e, com
  # $ErrorActionPreference=Stop, isso mata o pipeline inteiro — e pior: sem
  # deixar rastro, porque a propria mensagem de erro nao consegue ser gravada.
  # Em 22/07/2026 foi exatamente isso: um `tail -F` no log derrubou o ciclo das
  # 13:24 (exit 1, zero linhas no arquivo, diagnostico as cegas).
  # Agora e melhor-esforco: tenta, espera um instante, tenta de novo e desiste
  # em silencio. O arquivo e a fonte de verdade do diagnostico.
  try {
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 -ErrorAction Stop
  } catch {
    Start-Sleep -Milliseconds 200
    try {
      Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 -ErrorAction Stop
    } catch {
      # Desiste: log e diagnostico, nao pre-requisito da coleta.
    }
  }
  Write-Host $line
}

function Invoke-AndLog {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [int]$Retries = 0
  )

  # PS 5.1: com $ErrorActionPreference=Stop, QUALQUER linha de stderr de um exe
  # nativo vira ErrorRecord terminante e mata o script no meio do pipeline
  # (foi assim que o aviso do libuv derrubava o vigia). Aqui stderr só loga;
  # falha de verdade é decidida pelo exit code.
  $tentativa = 0
  while ($true) {
    $tentativa++
    Write-Log $Label
    Push-Location $WorkingDirectory
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      & $FilePath @Arguments 2>&1 | ForEach-Object { Write-Log "$_" }
      $code = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $prevEAP
      Pop-Location
    }
    if ($code -eq 0) { return }
    if ($tentativa -le $Retries) {
      Write-Log "$Label falhou com codigo $code; nova tentativa ($tentativa/$Retries) em 15s (falhas transitorias de arquivo/rede passam na segunda)."
      Start-Sleep -Seconds 15
      continue
    }
    throw "$Label falhou com codigo $code"
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
  if (Test-Path $emendasDataDir) {
    Copy-Item -LiteralPath $emendasDataDir -Destination (Join-Path $dest "emendas-data") -Recurse -Force
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

  # Antes de restaurar, preserva a coleta rejeitada em quarentena: o rollback
  # deixa de DESTRUIR dados novos (em 08/07 uma falha transitoria do audit
  # descartou uma coleta boa inteira). A quarentena permite inspecionar/reaproveitar.
  try {
    $qStamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $quarentena = Join-Path $backupRoot ("rejeitada-" + $qStamp)
    New-Item -ItemType Directory -Force -Path $quarentena | Out-Null
    if (Test-Path $dataDir) {
      Copy-Item -LiteralPath $dataDir -Destination (Join-Path $quarentena "data") -Recurse -Force
    }
    if (Test-Path $dataJs) {
      Copy-Item -LiteralPath $dataJs -Destination (Join-Path $quarentena "data.js") -Force
    }
    if (Test-Path $emendasDataDir) {
      Copy-Item -LiteralPath $emendasDataDir -Destination (Join-Path $quarentena "emendas-data") -Recurse -Force
    }
    Write-Log "Coleta rejeitada preservada em quarentena: $quarentena"
  } catch {
    # Quarentena e melhor-esforco: se falhar, o rollback abaixo continua valendo.
    Write-Log "Aviso: nao foi possivel preservar a coleta rejeitada: $_"
  }

  $backupData = Join-Path $Backup "data"
  $backupDataJs = Join-Path $Backup "data.js"
  $backupEmendasData = Join-Path $Backup "emendas-data"

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
  if (Test-Path $backupEmendasData) {
    if (Test-Path $emendasDataDir) {
      Remove-Item -LiteralPath $emendasDataDir -Recurse -Force
    }
    Copy-Item -LiteralPath $backupEmendasData -Destination $emendasDataDir -Recurse -Force
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

  # Mesmo cuidado do Invoke-AndLog: o node do probe às vezes crasha NA SAÍDA
  # (assertion libuv async.c) depois de já ter impresso o resultado. O texto do
  # crash vai para stderr e não pode abortar o vigia — só o exit code decide,
  # e exit != 0 já cai no caminho seguro "seguir com coleta".
  Push-Location $root
  $prevEAP = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $probeStart = Get-Date
    & node @args 2>&1 | ForEach-Object { Write-Log "$_" }
    $exitCode = $LASTEXITCODE

    # O crash de teardown corrompe o exit code DEPOIS do trabalho pronto.
    # Se o probe gravou probe-result.json nesta execucao, o arquivo e a
    # verdade; o exit code vira mero fallback.
    if (-not $Record) {
      $resultPath = Join-Path $root "private\state\probe-result.json"
      if (Test-Path $resultPath) {
        $item = Get-Item $resultPath
        if ($item.LastWriteTime -ge $probeStart) {
          try {
            $result = Get-Content $resultPath -Raw | ConvertFrom-Json
            if ($null -ne $result.needs_update) {
              if ($exitCode -ne 0 -and $exitCode -ne 10) {
                Write-Log "Probe crashou na saida (codigo $exitCode), mas o resultado foi gravado; usando needs_update=$($result.needs_update)."
              }
              if ($result.needs_update) { return 10 } else { return 0 }
            }
          } catch {
            Write-Log "Falha ao ler probe-result.json: $_ — usando exit code $exitCode."
          }
        }
      }
    }
    return $exitCode
  } finally {
    $ErrorActionPreference = $prevEAP
    Pop-Location
  }
}

function Test-LockOrfao {
  # Decide se o lock ficou orfao — dono morreu sem liberar.
  # Checar apenas "o PID existe" NAO basta: o Windows RECICLA numeros de PID.
  # Em 22/07/2026 o PID gravado no lock aparecia vivo, mas era um
  # "node ./mcp/server.mjs" iniciado 1h36 DEPOIS do lock — o dono real ja tinha
  # morrido. O teste confiavel compara o INICIO DO PROCESSO com o nascimento do
  # lock: quem criou o lock necessariamente comecou antes dele.
  # Retorna $false em qualquer duvida (nao da para ler, outra maquina, sem
  # permissao) — ai vale a regra de idade, que continua como rede de seguranca.
  param([string]$Caminho, [datetime]$Nascimento)

  try {
    $conteudo = (Get-Content -LiteralPath $Caminho -Raw -ErrorAction Stop).Trim()
  } catch {
    return $false
  }
  $partes = $conteudo -split '\|'
  if ($partes.Count -lt 2) { return $false }

  $donoPid = 0
  if (-not [int]::TryParse($partes[0], [ref]$donoPid)) { return $false }

  # Lock de outra maquina: nao da para inspecionar o processo daqui.
  if ($partes[1] -and $partes[1] -ne $env:COMPUTERNAME) { return $false }

  $proc = Get-Process -Id $donoPid -ErrorAction SilentlyContinue
  if (-not $proc) { return $true }   # dono morreu -> orfao

  try {
    # Margem de 5s cobre granularidade de relogio/arquivo.
    if ($proc.StartTime -gt $Nascimento.AddSeconds(5)) { return $true }  # PID reciclado
  } catch {
    return $false   # sem permissao para ler StartTime
  }
  return $false   # dono vivo e legitimo: respeitar
}

function Acquire-Lock {
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    $token = "{0}|{1}|{2}|{3}" -f $PID, $env:COMPUTERNAME, (Get-Date).ToUniversalTime().ToString("o"), ([guid]::NewGuid())
    try {
      $stream = New-Object System.IO.FileStream($lockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
      try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($token)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
      } finally {
        $stream.Dispose()
      }
      return $token
    } catch [System.IO.IOException] {
      if (-not (Test-Path -LiteralPath $lockPath)) { continue }
      $nascimento = (Get-Item -LiteralPath $lockPath).LastWriteTime
      $lockAge = (Get-Date) - $nascimento

      # Duas portas para assumir o lock:
      #  1) IDENTIDADE (imediata): o dono morreu ou o PID foi reciclado. Resolve
      #     em segundos, sem esperar horas com o pipeline parado.
      #  2) IDADE (rede de seguranca): quando a identidade e indeterminavel
      #     (nao deu para ler o lock, outra maquina, sem permissao).
      # Em 22/07/2026 um ciclo morreu sem liberar o lock e, so pela regra de
      # idade, o pipeline ficaria travado por ate 4h — a vigia dispara no minuto
      # :24 e o lock vencia 15s depois, entao ela pulava mais uma vez.
      $orfao = Test-LockOrfao -Caminho $lockPath -Nascimento $nascimento
      if (-not $orfao -and $lockAge.TotalHours -lt 3) {
        throw "Outra coleta parece estar em andamento. Lock: $lockPath"
      }
      if ($orfao) {
        Write-Log "Lock orfao detectado (dono morto ou PID reciclado); assumindo."
      } else {
        Write-Log "Lock antigo detectado (mais de 3h); tentando remover com seguranca."
      }
      $staleStream = New-Object System.IO.FileStream($lockPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::DeleteOnClose)
      $staleStream.Dispose()
    }
  }
  throw "Nao foi possivel adquirir lock exclusivo: $lockPath"
}

function Clear-StaleGitLock {
  # Um git commit/push que morre (ex.: crash libuv) deixa .git/index.lock, que
  # trava TODAS as rodadas seguintes ate intervencao manual (foi o que causou
  # ~10h de pipeline parado). Remove o lock apenas quando e seguro: nenhum
  # processo git ativo E o lock nao e recente (evita atropelar um git em curso).
  $gitLock = Join-Path $root ".git\index.lock"
  if (-not (Test-Path -LiteralPath $gitLock)) { return }
  $gitAtivo = Get-Process -Name git -ErrorAction SilentlyContinue
  if ($gitAtivo) {
    Write-Log "Aviso: .git/index.lock presente com git ativo; nao removido."
    return
  }
  $idadeMin = ((Get-Date) - (Get-Item -LiteralPath $gitLock).LastWriteTime).TotalMinutes
  if ($idadeMin -ge 5) {
    Write-Log ("Auto-heal: removendo .git/index.lock orfao (idade {0}min, nenhum git ativo)." -f [math]::Round($idadeMin))
    Remove-Item -LiteralPath $gitLock -Force -ErrorAction SilentlyContinue
  } else {
    Write-Log ("Aviso: .git/index.lock recente ({0}min) sem git ativo; aguardando proxima rodada." -f [math]::Round($idadeMin))
  }
}

function Restore-DeletedTrackedData {
  # Auto-cura: recupera arquivos versionados de dados que um ciclo anterior
  # deixou apagados (ex.: crash no meio do rollback Remove->Copy, que apagou 9
  # arquivos em 21/07). Restaura APENAS delecoes de arquivos rastreados (nao
  # mexe em modificados nem em novos), e roda sob o lock exclusivo de coleta.
  try {
    $deleted = & git -C $root ls-files --deleted -- painel-cidadao/data painel-cidadao/emendas/data 2>$null
    $lista = @($deleted | Where-Object { $_ -and $_.Trim() })
    if ($lista.Count -gt 0) {
      Write-Log ("Auto-heal: restaurando {0} arquivo(s) de dados apagados por ciclo anterior." -f $lista.Count)
      & git -C $root checkout HEAD -- $lista 2>&1 | Out-Null
    }
  } catch {
    Write-Log "Aviso: auto-heal de dados apagados falhou: $_"
  }
}

if ($SkipPackage -and -not $SkipDeploy) {
  throw "Deploy bloqueado: -SkipPackage exige -SkipDeploy, pois somente pacote validado no mesmo ciclo pode ser publicado."
}

# Alerta de operacao (canal privado, separado do WhatsApp publico): grava o
# batimento cardiaco e verifica a saude do pipeline.
# Roda ANTES do Acquire-Lock DE PROPOSITO: um ciclo barrado pelo lock precisa
# registrar batimento e conseguir alertar. Antes ficava depois do lock, entao
# um ciclo pendurado segurando o lock bloqueava todos os seguintes EM SILENCIO
# (22/07/2026: vigia das 09:24 travou com 0,4s de CPU e parou o pipeline por 3h,
# sem nenhum alerta, porque os ciclos seguintes morriam antes do health check).
# Falha aqui nunca bloqueia a coleta — e diagnostico, nao pre-requisito.
$tagTarefa = if ($SkipSlowAudits) { "vigia" } elseif ($OnlyIfChanged) { "hourly-legado" } else { "diaria" }
try {
  Invoke-AndLog `
    -Label "Verificando saude operacional do pipeline (alerta privado)." `
    -FilePath "npm.cmd" `
    -Arguments @("run", "data:saude", "--", "--tarefa=$tagTarefa") `
    -WorkingDirectory $root
} catch {
  Write-Log "Aviso: health check falhou e nao bloqueia o ciclo: $($_.Exception.Message)"
}

try {
  $lockToken = Acquire-Lock
} catch {
  Write-Log $_.Exception.Message
  # Sobreposicao esperada entre vigia e coleta diaria: o lock protege os
  # dados e a proxima execucao retomara o trabalho. Nao marca a tarefa como
  # falha operacional quando outro ciclo legitimo ja esta cuidando da base.
  if ($_.Exception.Message -like "Outra coleta parece estar em andamento*") {
    Write-Log "Ciclo pulado com seguranca por sobreposicao; nenhuma base foi alterada."
    exit 0
  }
  exit 2
}

try {
  $collectionStatus = "EM_ANDAMENTO"
  Write-Log "Iniciando coleta automatica."

  # Auto-cura de sujeira deixada por um ciclo anterior que crashou (sob lock
  # exclusivo, entao e seguro): 1) remove .git/index.lock orfao; 2) recupera
  # arquivos de dados que ficaram apagados. Ordem importa — a restauracao usa
  # git, que falharia se o index.lock orfao ainda estivesse presente.
  Clear-StaleGitLock
  Restore-DeletedTrackedData

  Write-Log "Projeto: $root"
  Write-Log "Modo do coletor: $CollectorMode$(if ($SkipSlowAudits) { ' (vigia rapida — sem CEIS/CNEP/TSE/licitacoes)' })"

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

  # Os chunks estruturados alimentam o feed cidadão e o WhatsApp, mas são
  # gerados por coletores próprios. Ambos operam de forma incremental: itens
  # antigos enriquecidos são reutilizados e apenas novidades usam IA.
  Invoke-AndLog `
    -Label "Atualizando publicacoes estruturadas da Camara (incremental)." `
    -FilePath "python" `
    -Arguments @("-u", "coletor_publicacoes.py") `
    -WorkingDirectory $painel

  if ($CollectorMode -ne "Sapl") {
    Invoke-AndLog `
      -Label "Atualizando publicacoes estruturadas do Diario Oficial (incremental)." `
      -FilePath "python" `
      -Arguments @("-u", "coletor_diario.py", "--edicoes", "3") `
      -WorkingDirectory $painel
  }

  Invoke-AndLog `
    -Label "Enriquecendo valores de materias financeiras com anexos oficiais do SAPL." `
    -FilePath "python" `
    -Arguments @("-u", "scripts/backfill-publication-values.py") `
    -WorkingDirectory $root

  Invoke-AndLog `
    -Label "Regenerando emendas municipais com proveniencia SAPL." `
    -FilePath "python" `
    -Arguments @("-u", "gerar_municipais_atuais.py") `
    -WorkingDirectory (Join-Path $painel "emendas")

  Invoke-AndLog `
    -Label "Normalizando e auditando emendas estaduais." `
    -FilePath "python" `
    -Arguments @("-u", "normalizar_emendas_estaduais.py") `
    -WorkingDirectory (Join-Path $painel "emendas")

  if ($CollectorMode -eq "Full") {
    Invoke-AndLog `
      -Label "Atualizando emendas federais destinadas a Varginha." `
      -FilePath "python" `
      -Arguments @("-u", "coletor_emendas_federais.py") `
      -WorkingDirectory (Join-Path $painel "emendas")
  }

  Invoke-AndLog `
    -Label "Normalizando taxonomia e evidências das emendas federais." `
    -FilePath "python" `
    -Arguments @("-u", "normalizar_emendas_federais.py") `
    -WorkingDirectory (Join-Path $painel "emendas")

  Invoke-AndLog `
    -Label "Auditando consistencia das emendas parlamentares." `
    -FilePath "python" `
    -Arguments @("-u", "audit_emendas.py") `
    -WorkingDirectory (Join-Path $painel "emendas")

  # Cruzamentos externos (best effort: preservam o chunk anterior em falha).
  # Pulados na vigia rapida (-SkipSlowAudits): sancao/doacao/licitacao nao
  # mudam de hora em hora, e juntas essas 3 chamadas levam ~1h so de API
  # externa — o motivo real das colisoes de ciclo em 20/07/2026.
  if (-not $SkipSlowAudits) {
    Invoke-AndLog `
      -Label "Cruzando fornecedores com CEIS/CNEP (empresas sancionadas)." `
      -FilePath "python" `
      -Arguments @("-u", "coletor_sancoes.py") `
      -WorkingDirectory $painel

    Invoke-AndLog `
      -Label "Cruzando doadores de campanha (TSE) com fornecedores e QSA." `
      -FilePath "python" `
      -Arguments @("-u", "coletor_tse.py") `
      -WorkingDirectory $painel

    Invoke-AndLog `
      -Label "Coletando resultados de licitacao (vencedores) no PNCP." `
      -FilePath "python" `
      -Arguments @("-u", "coletor_resultados_licitacao.py") `
      -WorkingDirectory $painel
  } else {
    Write-Log "Vigia rapida: pulando CEIS/CNEP, TSE e licitacoes-resultados (rodam so no ciclo diario)."
  }

  Push-Location $root
  try {
    # Monitor primeiro: gera monitoramento_coletas.json. O indice roda por ultimo
    # porque ele reescreve o manifest com sha256 — precisa capturar TODOS os chunks
    # ja finalizados (senao o hash do monitoramento_coletas fica divergente).
    Invoke-AndLog `
      -Label "Atualizando painel de monitoramento das coletas." `
      -FilePath "npm.cmd" `
      -Arguments @("run", "data:monitor") `
      -WorkingDirectory $root

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
      -WorkingDirectory $root `
      -Retries 1

    if ($previousChunks) {
      Remove-Item Env:\FISCALIZA_PREVIOUS_CHUNKS -ErrorAction SilentlyContinue
    }

    # Gate rápido de integridade dos dados — roda SEMPRE, mesmo com -SkipTests,
    # para que o vigia (watch) nunca publique chunks com formato/cálculo quebrado.
    Invoke-AndLog `
      -Label "Gate rápido de dados (sintaxe + cálculos)." `
      -FilePath "npm.cmd" `
      -Arguments @("run", "test:data") `
      -WorkingDirectory $root `
      -Retries 1

    if (-not $SkipTests) {
      Invoke-AndLog `
        -Label "Rodando testes Playwright (suíte completa)." `
        -FilePath "npm.cmd" `
        -Arguments @("test") `
        -WorkingDirectory $root
    }

    # Neste ponto os dados e os testes passaram. Registra o sucesso validado
    # antes de empacotar para que o monitor publico nao fique preso na falha
    # anterior. Deploy/WhatsApp continuam pendentes e serao registrados no
    # estado privado ao final do ciclo.
    Invoke-AndLog `
      -Label "Registrando coleta validada e atualizando monitor publico." `
      -FilePath "node" `
      -Arguments @("scripts/record-pipeline-state.mjs", "--coleta=SUCESSO", "--deploy=PENDENTE", "--whatsapp=PENDENTE", "--fase=validada") `
      -WorkingDirectory $root
    Invoke-AndLog `
      -Label "Atualizando monitor com o ultimo sucesso validado." `
      -FilePath "npm.cmd" `
      -Arguments @("run", "data:monitor") `
      -WorkingDirectory $root
    Invoke-AndLog `
      -Label "Sincronizando monitor e manifesto apos validacao." `
      -FilePath "npm.cmd" `
      -Arguments @("run", "data:bundle") `
      -WorkingDirectory $root

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

      $packageValidated = $true
    }
  } finally {
    Pop-Location
  }

  if ($SkipDeploy) {
    Write-Log "Deploy automatico pulado por -SkipDeploy."
  } else {
    if (-not $packageValidated) { throw "Deploy bloqueado: pacote nao validado neste ciclo." }
    Write-Log "Iniciando deploy automatico para o servidor de producao (Hostinger)..."
    try {
      Invoke-AndLog `
        -Label "Publicando exclusivamente dist/painel-cidadao e executando health check." `
        -FilePath "python" `
        -Arguments @((Join-Path $root "private\deploy_completo.py")) `
        -WorkingDirectory $root
      $deployStatus = "SUCESSO"
    } catch {
      $deployStatus = "FALHA"
      Write-Log "ERRO de deploy: $_"
      throw $_
    }
  }

  if ($deployStatus -eq "SUCESSO" -or $SkipDeploy) {
    Write-Log "Registrando assinaturas atuais das fontes."
    $recordCode = Invoke-SourceProbe -Record
    if ($recordCode -ne 0) {
      Write-Log "Aviso: registro de assinaturas retornou codigo $recordCode."
    }
  } else {
    Write-Log "Assinaturas das fontes NAO registradas devido a falha no deploy. O proximo ciclo tentara novamente."
  }

  $collectionStatus = "SUCESSO"
  if ($SkipWhatsApp) {
    Write-Log "Disparo de WhatsApp pulado por -SkipWhatsApp."
  } else {
    Write-Log "Disparando alertas automatizados para o WhatsApp."
    try {
      Invoke-AndLog `
        -Label "Enviando alertas do WhatsApp." `
        -FilePath "python" `
        -Arguments @((Join-Path $painel "alertar_whatsapp.py")) `
        -WorkingDirectory $painel
      $whatsAppStatus = "SUCESSO"
    } catch {
      $whatsAppStatus = "FALHA"
      Write-Log "ERRO de WhatsApp: $_"
    }
  }

  Invoke-AndLog `
    -Label "Registrando resultado final do pipeline." `
    -FilePath "node" `
    -Arguments @("scripts/record-pipeline-state.mjs", "--coleta=$collectionStatus", "--deploy=$deployStatus", "--whatsapp=$whatsAppStatus", "--fase=final") `
    -WorkingDirectory $root

  # Backup automatico no GitHub (so com -GitSync e coleta validada com sucesso).
  # Commita apenas os diretorios de dados; push nao-fatal (nao derruba o ciclo).
  if ($GitSync -and $collectionStatus -eq "SUCESSO") {
    # O git normaliza fim de linha (LF->CRLF) e emite aviso no stderr sempre
    # que ha arquivo pendente com fim de linha misto — o que e a norma neste
    # projeto. Com $ErrorActionPreference=Stop (setado no topo do script),
    # PowerShell 5.1 embrulha ESSE AVISO como excecao terminante mesmo com
    # "2>&1 | Out-Null", derrubando o try ANTES do commit/push rodarem —
    # GitSync silenciosamente nunca sincronizava de verdade. Mesmo padrao
    # de Continue-e-restaura ja usado em Invoke-SourceProbe/Acquire-Lock.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      Write-Log "Sincronizando dados com o GitHub (commit + push)."
      & git -C $root add -- painel-cidadao/data painel-cidadao/emendas/data 2>&1 | Out-Null
      $pendentes = & git -C $root status --porcelain -- painel-cidadao/data painel-cidadao/emendas/data
      if ($pendentes) {
        $carimbo = Get-Date -Format "dd/MM/yyyy HH:mm"
        & git -C $root commit -q -m "chore(dados): coleta diaria automatica $carimbo" 2>&1 | Out-Null
        & git -C $root push origin master 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Log "GitHub sincronizado (dados commitados e enviados)." }
        else { Write-Log "AVISO: push para o GitHub falhou (commit local feito; nao bloqueia)." }
      } else {
        Write-Log "Sem mudancas de dados para commitar."
      }
    } catch {
      Write-Log "AVISO: sync com GitHub falhou (nao bloqueia o ciclo): $_"
    } finally {
      $ErrorActionPreference = $prevEAP
    }
  }

  Remove-OldBackups
  Write-Log "RESUMO: coleta=$collectionStatus deploy=$deployStatus whatsapp=$whatsAppStatus"
  if ($deployStatus -eq "FALHA" -or $whatsAppStatus -eq "FALHA") { exit 1 }
  exit 0
} catch {
  $collectionStatus = "FALHA"
  Write-Log ("ERRO: " + $_.Exception.Message)
  Restore-PublishedDataBackup -Backup $backupPath
  try {
    & node (Join-Path $root "scripts\record-pipeline-state.mjs") "--coleta=FALHA" "--deploy=$deployStatus" "--whatsapp=$whatsAppStatus" "--fase=final" 2>&1 | ForEach-Object { Write-Log "$_" }
  } catch {
    Write-Log "Aviso: nao foi possivel registrar o estado final de falha: $_"
  }
  Write-Log "RESUMO: coleta=$collectionStatus deploy=$deployStatus whatsapp=$whatsAppStatus"
  exit 1
} finally {
  if ($lockToken -and (Test-Path -LiteralPath $lockPath)) {
    $currentToken = [System.IO.File]::ReadAllText($lockPath, [System.Text.Encoding]::UTF8)
    if ($currentToken -eq $lockToken) {
      Remove-Item -LiteralPath $lockPath -Force
    }
  }
}
