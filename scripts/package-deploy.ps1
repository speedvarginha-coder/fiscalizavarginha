param(
  [string]$OutputDir = "dist",
  [string]$ZipName = "fiscaliza-varginha-painel.zip"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$source = Join-Path $root "painel-cidadao"
$dist = Join-Path $root $OutputDir
$stage = Join-Path $dist "painel-cidadao"
$zipPath = Join-Path $dist $ZipName

if (-not (Test-Path $source)) {
  throw "Pasta painel-cidadao nao encontrada: $source"
}

if (Test-Path $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage "data") | Out-Null

function Copy-IfExists {
  param([string]$From, [string]$To)
  if (Test-Path $From) {
    Copy-Item -LiteralPath $From -Destination $To -Recurse -Force
  }
}

Get-ChildItem -LiteralPath $source -File |
  Where-Object {
    $_.Extension -in @(".html", ".css", ".js", ".svg") -or $_.Name -eq ".htaccess"
  } |
  ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage $_.Name) -Force
  }

Copy-IfExists (Join-Path $source "modules") (Join-Path $stage "modules")
Copy-IfExists (Join-Path $source "assets") (Join-Path $stage "assets")
Copy-IfExists (Join-Path $source "data\chunks") (Join-Path $stage "data\chunks")
Copy-IfExists (Join-Path $source "data\snapshots") (Join-Path $stage "data\snapshots")
Copy-IfExists (Join-Path $source "data\manifest.json") (Join-Path $stage "data\manifest.json")

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -Force

Write-Host "Deploy limpo gerado em:"
Write-Host "  $stage"
Write-Host "Zip gerado em:"
Write-Host "  $zipPath"
