$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
. (Join-Path $PSScriptRoot "lib\atomic-restore.ps1")

$testRoot = Join-Path $root ("private\restore-tests\" + [Guid]::NewGuid().ToString("N"))
$source = Join-Path $testRoot "backup\data"
$target = Join-Path $testRoot "publicado\data"

try {
  New-Item -ItemType Directory -Force -Path (Join-Path $source "chunks") | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $target "chunks") | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $source "chunks\novo.json"), '{"valor":104771249.39}', (New-Object System.Text.UTF8Encoding($false)))
  [System.IO.File]::WriteAllText((Join-Path $source "manifest.json"), '{"versao":"backup-validado"}', (New-Object System.Text.UTF8Encoding($false)))
  [System.IO.File]::WriteAllText((Join-Path $target "chunks\antigo.json"), '{"valor":"antigo"}', (New-Object System.Text.UTF8Encoding($false)))

  Restore-PathAtomically -Source $source -Target $target -Label "teste isolado"
  Assert-PathsMatch -Expected $source -Actual $target -Label "teste isolado final"
  if (Test-Path -LiteralPath (Join-Path $target "chunks\antigo.json")) {
    throw "O conteudo anterior permaneceu depois da troca atomica."
  }
  Write-Host "OK - restauracao atomica isolada e hashes conferidos."
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
