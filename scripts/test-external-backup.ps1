$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$statePath = Join-Path $root "private\state\external_backup.json"
if (-not (Test-Path -LiteralPath $statePath)) { throw "Estado do backup externo ausente." }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ($state.status -ne "ok") { throw "Ultimo backup externo nao esta saudavel: $($state.status)" }

$zipPath = Join-Path $state.destination $state.file
if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) { throw "ZIP externo ausente: $zipPath" }
$actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne $state.sha256) { throw "SHA-256 do ZIP externo diverge do estado registrado." }

$testRoot = Join-Path $root ("private\restore-tests\external-" + [Guid]::NewGuid().ToString("N"))
try {
  New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
  Expand-Archive -LiteralPath $zipPath -DestinationPath $testRoot -Force
  $manifest = Join-Path $testRoot "data\manifest.json"
  $chunks = Join-Path $testRoot "data\chunks"
  if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "Manifest ausente depois da extracao." }
  $parsed = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
  $chunkFiles = @(Get-ChildItem -LiteralPath $chunks -File -Filter "*.json" -ErrorAction Stop)
  if ($chunkFiles.Count -lt 20) { throw "Restauracao externa incompleta: $($chunkFiles.Count) chunks." }
  if (-not $parsed.chunks -or @($parsed.chunks.PSObject.Properties).Count -lt 20) {
    throw "Manifest restaurado nao descreve os chunks esperados."
  }
  Write-Host "OK - ZIP externo extraido e validado ($($chunkFiles.Count) chunks, SHA-256 $actualHash)."
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
