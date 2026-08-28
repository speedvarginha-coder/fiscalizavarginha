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
    $_.Extension -in @(".html", ".css", ".js", ".svg", ".php") -or
      $_.Name -in @(".htaccess", "robots.txt", "sitemap.xml")
  } |
  ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage $_.Name) -Force
  }

New-Item -ItemType Directory -Force -Path (Join-Path $stage "modules") | Out-Null
@(
  "utils.js",
  "icons.js",
  "glossario.js",
  "categorias.js",
  "watchlist.js",
  "dossie.js",
  "dashboard.js",
  "home-cidadao.js",
  "relatorios.js",
  "diarias.js",
  "atualizacoes.js",
  "materia-cidada.js",
  "indice-relevancia.js",
  "onboarding.js",
  "chat-cidadao.js",
  "publicacoes.js"
) | ForEach-Object {
  Copy-IfExists (Join-Path $source "modules\$_") (Join-Path $stage "modules\$_")
}
# Cache-busting do service worker: sem bump da constante CACHE, visitantes
# antigos ficam com app.js/style.css velhos indefinidamente (o SW serve do
# cache). Cada pacote recebe uma versao unica por timestamp.
$carimbo = Get-Date -Format "yyyyMMddHHmm"
$swStage = Join-Path $stage "sw.js"
if (Test-Path -LiteralPath $swStage) {
  $swVersion = "fiscaliza-" + $carimbo
  (Get-Content -LiteralPath $swStage -Raw) -replace 'const CACHE = "[^"]+";', ('const CACHE = "' + $swVersion + '";') |
    Set-Content -LiteralPath $swStage -Encoding utf8
  Write-Host "sw.js: CACHE -> $swVersion"
}

# Cache-busting do CSS e do JS. Bumpar so o service worker nao basta: o
# .htaccess manda o navegador guardar CSS e JS por 7 dias, e as URLs sao fixas
# no HTML (style.css?v=..., data-loader.js?v=...) e no proprio data-loader
# (BUILD_VERSION, que versiona app.js e todos os modules/). Ate 27/08/2026 esses
# tres valores estavam parados em "20260730" — publicar entregava arquivo novo
# em URL velha, e quem ja tinha visitado o site continuava vendo a versao
# anterior por ate uma semana. Agora cada pacote carimba os tres.
# Recursivo e generico de proposito: pega style.css e data-loader.js da raiz e
# tambem os do portal /emendas (styles.css, app.js, data/*.js), sem precisar
# listar asset por asset — asset novo com ?v= entra sozinho.
$assetVersion = $carimbo
$htmlAlterados = 0
$refsAlteradas = 0
Get-ChildItem -LiteralPath $stage -Filter "*.html" -File -Recurse | ForEach-Object {
  $original = Get-Content -LiteralPath $_.FullName -Raw
  $refsAlteradas += ([regex]::Matches($original, '\.(?:css|js)\?v=[^"'']+')).Count
  $novo = $original -replace '(\.(?:css|js))\?v=[^"'']+', ('$1?v=' + $assetVersion)
  if ($novo -ne $original) {
    Set-Content -LiteralPath $_.FullName -Value $novo -Encoding utf8
    $htmlAlterados++
  }
}
Write-Host "cache-bust: $refsAlteradas referencia(s) em $htmlAlterados HTML -> ?v=$assetVersion"

$loaderStage = Join-Path $stage "data-loader.js"
if (Test-Path -LiteralPath $loaderStage) {
  (Get-Content -LiteralPath $loaderStage -Raw) `
    -replace 'const BUILD_VERSION = "[^"]+";', ('const BUILD_VERSION = "' + $assetVersion + '";') |
    Set-Content -LiteralPath $loaderStage -Encoding utf8
  Write-Host "data-loader.js: BUILD_VERSION -> $assetVersion"
}

Copy-IfExists (Join-Path $source "assets") (Join-Path $stage "assets")
Copy-IfExists (Join-Path $source "docs") (Join-Path $stage "docs")
Copy-IfExists (Join-Path $source "emendas") (Join-Path $stage "emendas")
$emendasStage = Join-Path $stage "emendas"
if (Test-Path $emendasStage) {
  Get-ChildItem -LiteralPath $emendasStage -Recurse -File -Filter "*.py" |
    Remove-Item -Force
  Get-ChildItem -LiteralPath $emendasStage -Recurse -Directory -Filter "__pycache__" |
    Remove-Item -Recurse -Force
}
Copy-IfExists (Join-Path $source "data\chunks") (Join-Path $stage "data\chunks")
# Gerado pelo avalie.php a partir dos votos privados do servidor.
# Republica-lo apagaria temporariamente o agregado real a cada deploy.
$avalieResumoStage = Join-Path $stage "data\chunks\avalie_resumo.json"
if (Test-Path -LiteralPath $avalieResumoStage) {
  Remove-Item -LiteralPath $avalieResumoStage -Force
}
Copy-IfExists (Join-Path $source "data\snapshots") (Join-Path $stage "data\snapshots")
Copy-IfExists (Join-Path $source "data\manifest.json") (Join-Path $stage "data\manifest.json")

$manifestStage = Join-Path $stage "data\manifest.json"
if (-not (Test-Path -LiteralPath $manifestStage)) {
  throw "Manifest obrigatorio ausente no pacote: $manifestStage"
}
$manifestHash = (Get-FileHash -LiteralPath $manifestStage -Algorithm SHA256).Hash.ToLowerInvariant()
$release = [ordered]@{
  schema = 1
  gerado_em = (Get-Date).ToUniversalTime().ToString("o")
  manifest_sha256 = $manifestHash
}
$releaseJson = $release | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $stage "release.json"), $releaseJson, (New-Object System.Text.UTF8Encoding($false)))

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -Force

Write-Host "Deploy limpo gerado em:"
Write-Host "  $stage"
Write-Host "Zip gerado em:"
Write-Host "  $zipPath"
