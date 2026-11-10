param(
  [switch]$SkipFederal,
  [switch]$SkipState,
  [switch]$SkipTesouro,
  [switch]$SkipDiarias
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$painel = Join-Path $root "painel-cidadao"
$emendas = Join-Path $painel "emendas"
$logDir = Join-Path $root "private\logs"
$backupRoot = Join-Path $root "private\backups"
$stateDir = Join-Path $root "private\state"
$lockPath = Join-Path $logDir "coleta.lock"
$logPath = Join-Path $logDir ("financeiro-" + (Get-Date -Format "yyyy-MM-dd") + ".log")
$lockToken = $null
$backupPath = $null
$sourceStatus = [ordered]@{ federal = "pulado"; documentos_cgu = "pulado"; tesouro = "pulado"; estadual = "pulado"; diarias = "pulado"; reconciliacao = "pulado"; cruzamento_municipal = "pulado"; documentos_contratos = "pulado" }

. (Join-Path $PSScriptRoot "lib\financial-backup.ps1")

# Inventario do que o ciclo financeiro pode reescrever. Arquivo fora daqui nao
# volta no rollback, entao cada entrada esta amarrada a quem grava:
#
#   coletor.py --so-diarias .................. chunks\diarias.json, data\diarias.json
#   coletor_federal.py ....................... chunks\federal.json, data\federal.json
#   coletor_emendas_federais.py + normalizar . emendas_federais.js
#   coletor_emendas_tesouro.py ............... emendas_tesouro.js
#   coletor_emendas_estaduais.py ............. emendas_estaduais_normalizadas.js
#   coletor_emendas_prefeitura.py ............ chunks\emendas_prefeitura.json
#   npm run data:chat ........................ chunks\chat_context.json
#   npm run data:bundle ...................... chunks\home_resumo.json,
#                                              chunks\prefeitura_painel.json,
#                                              data.js, data\manifest.json
#
# Os espelhos em data\ sao legado (o painel le de data\chunks\), mas os
# coletores continuam gravando os dois caminhos; sem eles no inventario, uma
# falha deixa os pares divergentes.
$financialBackupFiles = @(
  "painel-cidadao\data\chunks\prefeitura.json",
  "painel-cidadao\data\chunks\camara_betha.json",
  "painel-cidadao\data\chunks\licitacoes_resultados.json",
  "painel-cidadao\data\prefeitura.json",
  "painel-cidadao\data\camara_betha.json",
  "painel-cidadao\data\chunks\contratos_documentos.json",
  "painel-cidadao\data\chunks\contratos_historico_prefeitura.json",
  "painel-cidadao\data\chunks\contratos_historico_camara.json",
  "painel-cidadao\data\chunks\diarias.json",
  "painel-cidadao\data\chunks\federal.json",
  "painel-cidadao\data\chunks\chat_context.json",
  "painel-cidadao\data\chunks\emendas_prefeitura.json",
  "painel-cidadao\data\chunks\home_resumo.json",
  "painel-cidadao\data\chunks\prefeitura_painel.json",
  "painel-cidadao\data\chunks\prefeitura_frota.json",
  "painel-cidadao\data\chunks\auditoria_dados.json",
  "painel-cidadao\data\chunks\status_fontes.json",
  "painel-cidadao\data\chunks\fiscalizacao_cidada.json",
  "painel-cidadao\data\diarias.json",
  "painel-cidadao\data\federal.json",
  "painel-cidadao\data\manifest.json",
  "painel-cidadao\data.js",
  "painel-cidadao\emendas\data\emendas_federais.js",
  "painel-cidadao\emendas\data\documentos_cgu.json",
  "painel-cidadao\emendas\data\documentos_cgu_status.json",
  "painel-cidadao\emendas\data\emendas_tesouro.js",
  "painel-cidadao\emendas\data\emendas_estaduais_normalizadas.js"
)

New-Item -ItemType Directory -Force -Path $logDir,$backupRoot,$stateDir | Out-Null

function Write-FinancialLog {
  param([string]$Message)
  $line = "[" + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + "] " + $Message
  try { Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 } catch {}
  Write-Host $line
}

function Acquire-FinancialLock {
  if (Test-Path -LiteralPath $lockPath) {
    $parts = ([System.IO.File]::ReadAllText($lockPath, [System.Text.Encoding]::UTF8)) -split "\|"
    $ownerPid = 0
    $ownerAlive = $parts.Count -ge 2 -and [int]::TryParse($parts[0], [ref]$ownerPid) -and
      $parts[1] -eq $env:COMPUTERNAME -and $null -ne (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)
    if ($ownerAlive) {
      Write-FinancialLog "Outra coleta esta em andamento; ciclo financeiro pulado sem alterar dados."
      return $null
    }
    Write-FinancialLog "Lock orfao removido antes do ciclo financeiro."
    Remove-Item -LiteralPath $lockPath -Force
  }
  $token = "{0}|{1}|{2}|{3}" -f $PID, $env:COMPUTERNAME, (Get-Date).ToUniversalTime().ToString("o"), ([guid]::NewGuid())
  $stream = New-Object System.IO.FileStream($lockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($token)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  } finally {
    $stream.Dispose()
  }
  return $token
}

function Invoke-FinancialStep {
  param(
    [string]$Label,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory,
    [int[]]$AcceptedExitCodes = @(0),
    [int]$TimeoutSeconds = 900
  )
  Write-FinancialLog $Label
  # Arquivos .cmd dependem de um shell; redirecionamento usa execucao direta.
  # Use a CLI instalada do npm via node, sem montar comandos de shell.
  if ($FilePath -ieq 'npm.cmd') {
    $npmDirectory = Split-Path -Parent (Get-Command npm.cmd -ErrorAction Stop).Source
    $npmCli = Join-Path $npmDirectory 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $npmCli)) { throw 'CLI instalada do npm nao localizada.' }
    $FilePath = (Get-Command node -ErrorAction Stop).Source
    $Arguments = @('"' + $npmCli + '"') + $Arguments
  }
  $id = "{0}-{1}" -f $PID, ([guid]::NewGuid().ToString("N"))
  $stdoutPath = Join-Path $logDir ("financial-step-" + $id + ".out.log")
  $stderrPath = Join-Path $logDir ("financial-step-" + $id + ".err.log")
  $proc = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
  $processHandle = $proc.Handle
  if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
    Write-FinancialLog "$Label excedeu ${TimeoutSeconds}s; encerrando somente a arvore do processo iniciado $($proc.Id)."
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & taskkill.exe /PID $proc.Id /T /F 2>&1 | ForEach-Object { Write-FinancialLog "$_" } }
    finally { $ErrorActionPreference = $previousPreference }
    # Ambientes restritos podem negar taskkill mesmo para um processo filho.
    # O handle retido permite encerrar o processo que esta funcao iniciou.
    if (-not $proc.HasExited) { $proc.Kill() }
    if (-not $proc.WaitForExit(5000)) { throw "$Label nao encerrou apos timeout; ciclo interrompido por seguranca." }
    $code = if ($AcceptedExitCodes -contains 2) { 2 } else { 124 }
  } else {
    $proc.WaitForExit(); $proc.Refresh()
    if ($null -eq $proc.ExitCode) { throw "$Label terminou sem codigo verificavel." }
    $code = [int]$proc.ExitCode
  }
  foreach ($path in @($stdoutPath, $stderrPath)) {
    if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path | ForEach-Object { Write-FinancialLog "$_" } }
  }
  if ($AcceptedExitCodes -notcontains $code) { throw "$Label falhou com codigo $code" }
  return $code
}

function New-FinancialBackup {
  $destination = Join-Path $backupRoot ("financeiro-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  return (New-FinancialBackupSet -Root $root -Destination $destination -Files $financialBackupFiles)
}

function Restore-FinancialBackup {
  param([string]$Backup)
  $restaurados = @(Restore-FinancialBackupSet -Root $root -Backup $Backup)
  Write-FinancialLog ("Dados financeiros restaurados do backup " + $Backup + " (" + $restaurados.Count + " arquivos).")
  return $restaurados
}

try {
  $lockToken = Acquire-FinancialLock
  if (-not $lockToken) { exit 0 }
  $backupPath = New-FinancialBackup

  if (-not $SkipDiarias) {
    # Codigo 2 = a fonte nao respondeu (ou veio vazia); a base anterior foi
    # preservada e o ciclo NAO deve desfazer as demais fontes por isso.
    $code = Invoke-FinancialStep "Atualizando diarias da Prefeitura e da Camara." "python" @("-u", "coletor.py", "--so-diarias") $painel @(0, 2)
    $sourceStatus.diarias = if ($code -eq 0) { "ok" } else { "preservado" }
  }
  if (-not $SkipFederal) {
    $code = Invoke-FinancialStep "Atualizando emendas federais CGU e Transferegov." "python" @("-u", "coletor_emendas_federais.py") $emendas @(0, 2)
    $sourceStatus.federal = if ($code -eq 0) { "ok" } else { "preservado" }
    try {
      Invoke-FinancialStep "Normalizando emendas federais." "python" @("-u", "normalizar_emendas_federais.py") $emendas | Out-Null
    } catch {
      Write-FinancialLog "Normalizacao falhou; nova tentativa em 15 segundos."
      Start-Sleep -Seconds 15
      Invoke-FinancialStep "Repetindo normalizacao de emendas federais." "python" @("-u", "normalizar_emendas_federais.py") $emendas | Out-Null
    }
    $code = Invoke-FinancialStep "Atualizando documentos federais de emendas da CGU." "python" @("-u", "scripts/coletar-documentos-emendas-cgu.py") $root @(0, 2) -TimeoutSeconds 300
    $sourceStatus.documentos_cgu = if ($code -eq 0) { "ok" } else { "preservado" }
    Invoke-FinancialStep "Sincronizando resumo federal, convenios e Transferegov." "python" @("-u", "coletor_federal.py") $painel | Out-Null
  }
  if (-not $SkipTesouro) {
    $code = Invoke-FinancialStep "Atualizando ordens bancarias federais do Tesouro Transparente." "python" @("-u", "coletor_emendas_tesouro.py") $emendas @(0, 2)
    $sourceStatus.tesouro = if ($code -eq 0) { "ok" } else { "preservado" }
  }
  if (-not $SkipState) {
    $code = Invoke-FinancialStep "Atualizando emendas estaduais oficiais." "python" @("-u", "coletor_emendas_estaduais.py") $emendas @(0, 2) -TimeoutSeconds 180
    $sourceStatus.estadual = if ($code -eq 0) { "ok" } else { "preservado" }
  }

  # Reconciliacao com o registro contabil da propria Prefeitura. Roda depois das
  # tres bases porque compara com elas. Codigo 2 = fonte indisponivel ou sem
  # relatorio: preserva a base anterior e NAO derruba o ciclo, porque as outras
  # bases ja foram coletadas e nao podem ser descartadas por isso. Divergencia
  # registrada (codigo 0) continua sendo o produto util.
  $code = Invoke-FinancialStep "Reconciliando com o registro da Prefeitura (Betha)." "python" @("-u", "coletor_emendas_prefeitura.py") $emendas @(0, 2) -TimeoutSeconds 240
  $sourceStatus.reconciliacao = if ($code -eq 0) { "ok" } else { "preservado" }

  $code = Invoke-FinancialStep "Recalculando cruzamento municipal pelo exercicio documental." "python" @("-u", "scripts/reconcile-emenda-payments.py") $root @(0, 2) -TimeoutSeconds 900
  $sourceStatus.cruzamento_municipal = if ($code -eq 0) { "ok" } else { "preservado" }
  if ($code -ne 0) {
    Invoke-FinancialStep "Retirando correspondencias legadas nao reconfirmadas." "python" @("scripts/reconcile-emenda-payments.py", "--invalidar-legado") $root | Out-Null
  }

  Invoke-FinancialStep "Auditando emendas federais e estaduais." "python" @("-u", "audit_emendas.py") $emendas | Out-Null
  Invoke-FinancialStep "Atualizando cobertura e validando o dominio financeiro." "npm.cmd" @("run", "data:audit", "--", "--scope=financial") $root | Out-Null
  Invoke-FinancialStep "Regenerando contexto factual do site." "npm.cmd" @("run", "data:chat") $root | Out-Null
  $code = Invoke-FinancialStep "Atualizando histórico e conferência documental dos contratos." "python" @("-u", "scripts/auditar-documentos-contratos.py", "--historico", "--limit", "500", "--pdf-limit", "50") $root @(0, 2) -TimeoutSeconds 180
  $sourceStatus.documentos_contratos = if ($code -eq 0) { "ok" } else { "preservado" }
  Invoke-FinancialStep "Reconciliando fichas oficiais por identidade contratual." "python" @("scripts/reconcile-contract-sources.py") $root | Out-Null
  Invoke-FinancialStep "Conferindo execução contábil dos empenhos vinculados." "python" @("scripts/conferir-execucao-contratos.py", "--limit", "10") $root @(0, 1, 2) -TimeoutSeconds 180 | Out-Null
  $code = Invoke-FinancialStep "Consultando arquivos e termos do PNCP." "python" @("-u", "scripts/coletar-documentos-pncp.py", "--limit", "15") $root @(0, 1, 2) -TimeoutSeconds 180
  $sourceStatus.documentos_pncp = "preservado"
  if ($code -eq 0) {
    try {
      $pncpStatus = Get-Content (Join-Path $stateDir "documentos-pncp.json") -Raw | ConvertFrom-Json
      if ($pncpStatus.status -eq "ok") { $sourceStatus.documentos_pncp = "ok" }
    } catch { Write-FinancialLog "Estado documental PNCP indisponível; resultado preservado." }
  }
  Invoke-FinancialStep "Conferindo amostra dos arquivos PNCP." "python" @("scripts/conferir-documentos-pncp.py", "--limit", "5", "--ocr") $root @(0, 1, 2) -TimeoutSeconds 300 | Out-Null
  Invoke-FinancialStep "Identificando extratos candidatos no Diário Oficial." "python" @("scripts/reconciliar-diario-contratos.py") $root | Out-Null
  Invoke-FinancialStep "Conferindo texto integral de edições do Diário Oficial." "python" @("scripts/extrair-diario-contratos.py", "--limit", "5") $root @(0, 1, 2) -TimeoutSeconds 180 | Out-Null
  Invoke-FinancialStep "Protegendo documentos pessoais nos resultados de licitação." "python" @("painel-cidadao/coletor_resultados_licitacao.py", "--sanitizar-local") $root | Out-Null
  # A cada sete dias, compara amostras com as fontes sem substituir registros.
  $samplePath = Join-Path $stateDir "conferencia-amostral.json"
  $sampleDue = $true
  if (Test-Path -LiteralPath $samplePath) {
    try {
      $sample = Get-Content -LiteralPath $samplePath -Raw | ConvertFrom-Json
      $sampleDate = [DateTimeOffset]::Parse($sample.executado_em)
      $sampleFailed = @($sample.conjuntos.PSObject.Properties | Where-Object { $_.Value.status -in @('inconclusivo','indisponivel') }).Count -gt 0
      $sampleInterval = if ($sampleFailed) { 1 } else { 7 }
      $sampleDue = ([DateTimeOffset]::UtcNow - $sampleDate).TotalDays -ge $sampleInterval
    } catch { $sampleDue = $true }
  }
  if ($sampleDue) {
    $code = Invoke-FinancialStep "Conferindo amostras nas fontes oficiais, sem alterar dados." "python" @("-u", "scripts/conferir-amostras-fontes.py") $root @(0, 1, 2) -TimeoutSeconds 240
    if ($code -ne 0) { Write-FinancialLog "Amostragem não concluída; resultado anterior preservado." }
  }
  Invoke-FinancialStep "Atualizando cobertura documental e amostras." "python" @("scripts/gerar-cobertura-documental.py") $root | Out-Null
  Invoke-FinancialStep "Sincronizando bundle e manifesto." "npm.cmd" @("run", "data:bundle") $root | Out-Null
  Invoke-FinancialStep "Validando schemas financeiros." "npm.cmd" @("run", "data:schema") $root | Out-Null
  Invoke-FinancialStep "Conferindo numeros publicados." "npm.cmd" @("run", "test:numeros") $root | Out-Null

  $state = [ordered]@{
    executado_em = (Get-Date).ToString("o")
    status = if ($sourceStatus.Values -contains "preservado") { "parcial" } else { "sucesso" }
    fontes = $sourceStatus
    whatsapp = "fora_do_escopo"
  }
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stateDir "financial-update.json") -Encoding UTF8
  # A cobertura inclui a conclusão desta rotina, distinta da data da base.
  Invoke-FinancialStep "Sincronizando a tentativa financeira e validando o manifesto." "npm.cmd" @("run", "data:bundle") $root | Out-Null
  Invoke-FinancialStep "Validando schemas após atualizar a cobertura." "npm.cmd" @("run", "data:schema") $root | Out-Null
  Write-FinancialLog ("Ciclo financeiro concluido: " + (($sourceStatus.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ", "))
  exit 0
} catch {
  # O $_ do catch interno sobrescreve o externo; guardar a mensagem do ciclo
  # antes de tentar restaurar, senao o estado registra o erro errado.
  $erroCiclo = $_.Exception.Message
  Write-FinancialLog ("ERRO: " + $erroCiclo)

  $restauracao = "sem backup"
  if ($backupPath) {
    # Uma falha aqui nao pode impedir o registro do estado: era isso que fazia
    # o financial-update.json continuar marcando "sucesso" depois de um ciclo
    # que falhou.
    try {
      Restore-FinancialBackup -Backup $backupPath | Out-Null
      $restauracao = "restaurado"
    } catch {
      $restauracao = "falhou: " + $_.Exception.Message
      Write-FinancialLog ("ERRO: restauracao do backup financeiro falhou: " + $_.Exception.Message)
    }
  }

  $state = [ordered]@{
    executado_em = (Get-Date).ToString("o")
    status = "falha"
    erro = $erroCiclo
    restauracao = $restauracao
    backup = $backupPath
    fontes = $sourceStatus
  }
  $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stateDir "financial-update.json") -Encoding UTF8
  exit 1
} finally {
  if ($lockToken -and (Test-Path -LiteralPath $lockPath)) {
    $currentToken = [System.IO.File]::ReadAllText($lockPath, [System.Text.Encoding]::UTF8)
    if ($currentToken -eq $lockToken) {
      Remove-Item -LiteralPath $lockPath -Force
    }
  }
}
