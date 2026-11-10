# Backup e restauracao do ciclo financeiro.
#
# Vive aqui, e nao dentro de update-financial-data.ps1, para poder ser
# dot-sourced por um teste sem disparar o ciclo inteiro. Mesmo padrao de
# lib\atomic-restore.ps1: apenas funcoes, sem efeito colateral na carga.

function New-FinancialBackupSet {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][string[]]$Files
  )

  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $manifest = @()
  foreach ($relative in $Files) {
    $source = Join-Path $Root $relative
    if (Test-Path -LiteralPath $source) {
      $safeName = $relative.Replace("\", "__")
      Copy-Item -LiteralPath $source -Destination (Join-Path $Destination $safeName) -Force
      $manifest += [pscustomobject]@{ relative = $relative; backup = $safeName; ausente = $false }
    } else {
      # Registrar a ausencia e o que permite desfazer a criacao: sem isso, um
      # arquivo que o ciclo cria do zero sobrevive ao rollback e fica
      # incompativel com o resto da base restaurada.
      $manifest += [pscustomobject]@{ relative = $relative; backup = $null; ausente = $true }
    }
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Destination "manifest.json") -Encoding UTF8
  return $Destination
}

# Devolve a lista de caminhos relativos efetivamente restaurados, para o
# chamador registrar quantos arquivos voltaram e o teste conferir a cobertura.
function Restore-FinancialBackupSet {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Backup
  )

  $manifestPath = Join-Path $Backup "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath)) { return @() }

  # O Windows PowerShell 5.1 emite um array JSON como UM unico objeto, sem
  # enumerar. Sem a variavel intermediaria, o @() em volta do pipeline recebe
  # esse objeto inteiro e devolve uma lista de um item; o foreach abaixo entao
  # trabalha com o Object[] no lugar de cada entrada, e Join-Path rejeita o
  # array. Foi esse o defeito que deixou a restauracao sem executar nenhuma vez.
  # Manter a atribuicao e o foreach no mesmo escopo: passar o resultado por
  # outra funcao esconderia o defeito, porque a saida de funcao enumera.
  $parsed = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  $manifest = @($parsed)

  $restaurados = @()
  foreach ($item in $manifest) {
    $target = Join-Path $Root $item.relative

    if ($item.ausente) {
      # Nao existia antes do ciclo: desfazer significa remover o que o ciclo
      # criou, nao deixar o arquivo orfao na base restaurada.
      if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Force
        $restaurados += $item.relative
      }
      continue
    }

    $source = Join-Path $Backup $item.backup
    if (Test-Path -LiteralPath $source) {
      # Copiar por cima falha quando um leitor tem o JSON mapeado em memoria.
      # Prepare um arquivo independente e troque o nome atomicamente.
      $staged = $target + '.restore-' + [guid]::NewGuid().ToString('N') + '.tmp'
      try {
        Copy-Item -LiteralPath $source -Destination $staged -Force -ErrorAction Stop
        if (Test-Path -LiteralPath $target) {
          [IO.File]::Replace($staged, $target, [NullString]::Value)
        } else {
          Move-Item -LiteralPath $staged -Destination $target -ErrorAction Stop
        }
      } finally {
        if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue }
      }
      $restaurados += $item.relative
    }
  }
  return $restaurados
}



