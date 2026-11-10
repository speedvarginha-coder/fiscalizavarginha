# Regressao da restauracao do ciclo financeiro.
#
# Motivo: em 05/09 e 08/09/2026 o ciclo financeiro falhou no passo de
# reconciliacao com a Betha, a restauracao nao rodou e a arvore ficou com
# diarias.json e federal.json a frente do manifesto. A causa era o
# ConvertFrom-Json do PowerShell 5.1 devolver o array como um objeto so, o que
# fazia Join-Path receber um Object[] e derrubar o script dentro do catch.
#
# Este teste roda inteiro em pasta isolada; nao toca em dados de producao.

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
. (Join-Path $PSScriptRoot "lib\financial-backup.ps1")

$testRoot = Join-Path $root ("private\restore-tests\financeiro-" + [Guid]::NewGuid().ToString("N"))
$testRoot = [IO.Path]::GetFullPath($testRoot)
$testParent = [IO.Path]::GetFullPath((Join-Path $root "private\restore-tests")).TrimEnd('\')
if (-not $testRoot.StartsWith($testParent + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Destino de teste fora da área permitida" }
$arvore = Join-Path $testRoot "arvore"
$backups = Join-Path $testRoot "backups"

function Write-TestFile {
  param([string]$Path, [string]$Content)
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-Sha {
  param([string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

try {
  # Le o inventario real do ciclo em vez de repetir a lista: se alguem incluir
  # um arquivo novo em update-financial-data.ps1, o teste passa a cobri-lo
  # sozinho; se remover um, o teste nao continua validando o que sumiu.
  $cicloFonte = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "update-financial-data.ps1")
  $bloco = [regex]::Match($cicloFonte, '(?s)\$financialBackupFiles\s*=\s*@\((.*?)\n\)')
  if (-not $bloco.Success) {
    throw "Nao foi possivel ler `$financialBackupFiles em update-financial-data.ps1; o teste ficaria vazio sem perceber."
  }
  $arquivos = @([regex]::Matches($bloco.Groups[1].Value, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
  if ($arquivos.Count -lt 8) {
    throw "Inventario do ciclo financeiro tem apenas $($arquivos.Count) arquivos; esperado ao menos 8."
  }

  # O caso de varios itens e o que quebrava: ConvertTo-Json grava um array e o
  # ConvertFrom-Json do 5.1 devolve tudo como um objeto so.
  $original = @{}
  foreach ($relative in $arquivos) {
    $caminho = Join-Path $arvore $relative
    Write-TestFile -Path $caminho -Content ('{"origem":"base valida","arquivo":"' + $relative.Replace("\", "/") + '"}')
    $original[$relative] = Get-Sha $caminho
  }

  $backup = New-FinancialBackupSet -Root $arvore -Destination (Join-Path $backups "financeiro-teste") -Files $arquivos

  # Simula o ciclo que escreveu parte dos chunks e falhou depois: dois arquivos
  # alterados, um apagado. Foi exatamente esse estado que ficou publicado
  # localmente em 08/09.
  Write-TestFile -Path (Join-Path $arvore "painel-cidadao\data\chunks\diarias.json") -Content '{"origem":"ciclo abortado"}'
  Write-TestFile -Path (Join-Path $arvore "painel-cidadao\data\chunks\federal.json") -Content '{"origem":"ciclo abortado","atualizado_em":"2026-09-08T09:41:07"}'
  Remove-Item -LiteralPath (Join-Path $arvore "painel-cidadao\data\manifest.json") -Force

  $restaurados = @(Restore-FinancialBackupSet -Root $arvore -Backup $backup)

  if ($restaurados.Count -ne $arquivos.Count) {
    throw "A restauracao devolveu $($restaurados.Count) arquivos; esperados $($arquivos.Count). O foreach provavelmente voltou a receber o array inteiro como um item so."
  }

  foreach ($relative in $arquivos) {
    $caminho = Join-Path $arvore $relative
    if (-not (Test-Path -LiteralPath $caminho)) {
      throw "Arquivo nao voltou na restauracao: $relative"
    }
    $atual = Get-Sha $caminho
    if ($atual -ne $original[$relative]) {
      throw "Conteudo divergente depois da restauracao em $relative (esperado $($original[$relative]), obtido $atual)."
    }
  }

  # Arquivo que nao existia antes do ciclo e foi criado por ele precisa sumir
  # no rollback; se sobreviver, fica incompativel com a base restaurada.
  $arvoreCriado = Join-Path $testRoot "arvore-criado"
  $existente = "painel-cidadao\data\chunks\diarias.json"
  $criado = "painel-cidadao\data\chunks\emendas_prefeitura.json"
  Write-TestFile -Path (Join-Path $arvoreCriado $existente) -Content '{"origem":"base valida"}'
  $shaExistente = Get-Sha (Join-Path $arvoreCriado $existente)
  $backupCriado = New-FinancialBackupSet -Root $arvoreCriado -Destination (Join-Path $backups "financeiro-criado") -Files @($existente, $criado)

  Write-TestFile -Path (Join-Path $arvoreCriado $criado) -Content '{"origem":"ciclo abortado criou este arquivo"}'
  Write-TestFile -Path (Join-Path $arvoreCriado $existente) -Content '{"origem":"ciclo abortado"}'

  $restauradosCriado = @(Restore-FinancialBackupSet -Root $arvoreCriado -Backup $backupCriado)
  if (Test-Path -LiteralPath (Join-Path $arvoreCriado $criado)) {
    throw "Arquivo criado durante o ciclo sobreviveu ao rollback: $criado"
  }
  if ((Get-Sha (Join-Path $arvoreCriado $existente)) -ne $shaExistente) {
    throw "Arquivo preexistente nao voltou ao conteudo anterior no caso de arquivo criado."
  }
  if ($restauradosCriado.Count -ne 2) {
    throw "Esperados 2 desfazimentos (1 restaurado + 1 removido); obtidos $($restauradosCriado.Count)."
  }

  # Inventario de um item so: ConvertTo-Json grava um objeto, nao um array.
  # E a outra metade da mesma armadilha e precisa continuar funcionando.
  $arvoreUnica = Join-Path $testRoot "arvore-unica"
  $unico = @("painel-cidadao\data\chunks\federal.json")
  Write-TestFile -Path (Join-Path $arvoreUnica $unico[0]) -Content '{"origem":"base valida"}'
  $shaUnico = Get-Sha (Join-Path $arvoreUnica $unico[0])
  $backupUnico = New-FinancialBackupSet -Root $arvoreUnica -Destination (Join-Path $backups "financeiro-unico") -Files $unico
  Write-TestFile -Path (Join-Path $arvoreUnica $unico[0]) -Content '{"origem":"ciclo abortado"}'
  $restauradosUnico = @(Restore-FinancialBackupSet -Root $arvoreUnica -Backup $backupUnico)
  if ($restauradosUnico.Count -ne 1) {
    throw "Inventario de um item devolveu $($restauradosUnico.Count) arquivos; esperado 1."
  }
  if ((Get-Sha (Join-Path $arvoreUnica $unico[0])) -ne $shaUnico) {
    throw "Inventario de um item nao restaurou o conteudo anterior."
  }

  # Backup inexistente nao pode derrubar o ciclo: o catch precisa seguir e
  # gravar o estado de falha.
  $vazio = @(Restore-FinancialBackupSet -Root $arvore -Backup (Join-Path $backups "inexistente"))
  if ($vazio.Count -ne 0) {
    throw "Backup inexistente deveria restaurar zero arquivos."
  }

  Write-Host ("OK - restauracao financeira: " + $arquivos.Count + " arquivos do inventario real conferidos por SHA-256, arquivo criado no ciclo removido, inventario unitario e backup ausente.")
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
