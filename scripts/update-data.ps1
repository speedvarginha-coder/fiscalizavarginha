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
  Write-Host $line
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
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
      $lockAge = (Get-Date) - (Get-Item -LiteralPath $lockPath).LastWriteTime
      if ($lockAge.TotalHours -lt 3) {
        throw "Outra coleta parece estar em andamento. Lock: $lockPath"
      }
      Write-Log "Lock antigo detectado; tentando remover com seguranca."
      $staleStream = New-Object System.IO.FileStream($lockPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::DeleteOnClose)
      $staleStream.Dispose()
    }
  }
  throw "Nao foi possivel adquirir lock exclusivo: $lockPath"
}

if ($SkipPackage -and -not $SkipDeploy) {
  throw "Deploy bloqueado: -SkipPackage exige -SkipDeploy, pois somente pacote validado no mesmo ciclo pode ser publicado."
}

try {
  $lockToken = Acquire-Lock
} catch {
  Write-Log $_.Exception.Message
  exit 2
}

try {
  $collectionStatus = "EM_ANDAMENTO"
  Write-Log "Iniciando coleta automatica."
  Write-Log "Projeto: $root"
  Write-Log "Modo do coletor: $CollectorMode$(if ($SkipSlowAudits) { ' (vigia rapida — sem CEIS/CNEP/TSE/licitacoes)' })"

  # Alerta de operacao (canal privado, separado do WhatsApp publico): grava
  # batimento cardiaco e verifica se a automacao parou de disparar ou se
  # ninguem tem sucesso ha muito tempo. Roda ANTES do -OnlyIfChanged decidir
  # pular, para que ate um ciclo sem mudanca conte como "automacao viva".
  $tagTarefa = if ($SkipSlowAudits) { "vigia" } elseif ($OnlyIfChanged) { "hourly-legado" } else { "diaria" }
  Invoke-AndLog `
    -Label "Verificando saude operacional do pipeline (alerta privado)." `
    -FilePath "npm.cmd" `
    -Arguments @("run", "data:saude", "--", "--tarefa=$tagTarefa") `
    -WorkingDirectory $root

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

  # Backup automatico no GitHub (so com -GitSync e coleta validada com sucesso).
  # Commita apenas os diretorios de dados; push nao-fatal (nao derruba o ciclo).
  if ($GitSync -and $collectionStatus -eq "SUCESSO") {
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
