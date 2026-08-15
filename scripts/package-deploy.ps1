param(
  [string]$OutputDir = "dist",
  [string]$ZipName = "fiscaliza-varginha-painel.zip",
  # Publica mesmo com codigo nao commitado. Existe para emergencia; o uso fica
  # registrado no release.json, entao a excecao nao vira habito silencioso.
  [switch]$AllowDirty
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
$swStage = Join-Path $stage "sw.js"
if (Test-Path -LiteralPath $swStage) {
  $swVersion = "fiscaliza-" + (Get-Date -Format "yyyyMMddHHmm")
  (Get-Content -LiteralPath $swStage -Raw) -replace 'const CACHE = "[^"]+";', ('const CACHE = "' + $swVersion + '";') |
    Set-Content -LiteralPath $swStage -Encoding utf8
  Write-Host "sw.js: CACHE -> $swVersion"
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

# --- procedencia: que codigo exatamente esta neste pacote ---
$commit = ""
$branch = ""
$sujos = @()
try {
  $commit = (& git -C $root rev-parse HEAD 2>$null | Select-Object -First 1)
  $branch = (& git -C $root rev-parse --abbrev-ref HEAD 2>$null | Select-Object -First 1)
  $porcelain = & git -C $root status --porcelain 2>$null
  if ($porcelain) {
    foreach ($linha in $porcelain) {
      if ([string]::IsNullOrWhiteSpace($linha)) { continue }
      # formato: XY <caminho>. Renomeacao vem como "orig -> novo".
      $caminho = ($linha.Substring(2)).Trim().Trim('"')
      if ($caminho -match '->') { $caminho = ($caminho -split '->')[-1].Trim().Trim('"') }
      $sujos += $caminho
    }
  }
} catch {
  Write-Warning "Nao foi possivel ler o estado do git: $_"
}

# Os dados sao commitados DEPOIS do deploy no ciclo diario: sujeira em
# painel-cidadao/data e esperada durante o empacotamento e nao pode barrar nada.
# Arquivo nao rastreado tambem nao entra: ele nao altera o que ja existe.
$dadosPendentes = @($sujos | Where-Object {
  $_ -like 'painel-cidadao/data/*' -or $_ -like 'painel-cidadao/emendas/data/*'
})
$naoRastreados = @()
if ($porcelain) {
  # StartsWith, nao -like: em PowerShell '?' e curinga de um caractere, entao
  # -like '??*' casa QUALQUER linha e classificaria todo arquivo como nao
  # rastreado — desarmando a trava inteira.
  $naoRastreados = @($porcelain | Where-Object { $_.StartsWith('??') } | ForEach-Object {
    ($_.Substring(2)).Trim().Trim('"')
  })
}
$codigoSujo = @($sujos | Where-Object {
  $dadosPendentes -notcontains $_ -and $naoRastreados -notcontains $_
})

if ($codigoSujo.Count -gt 0 -and -not $AllowDirty) {
  $lista = ($codigoSujo | Select-Object -First 20) -join "`n  - "
  throw @"
Empacotamento bloqueado: $($codigoSujo.Count) arquivo(s) de codigo com alteracao nao commitada.

  - $lista

O pacote e montado a partir da arvore de trabalho, entao esses arquivos iriam
ao ar sem estar no historico — e depois nao haveria como saber o que foi
publicado. Commite as alteracoes, ou reexecute com -AllowDirty se a publicacao
for deliberada (o uso fica registrado no release.json).
"@
}

$release = [ordered]@{
  schema = 2
  gerado_em = (Get-Date).ToUniversalTime().ToString("o")
  manifest_sha256 = $manifestHash
  commit = $commit
  branch = $branch
  # Sujeira de dados e rotina do ciclo diario; a de codigo so aparece aqui se
  # -AllowDirty foi usado, e entao precisa ficar visivel no pacote publicado.
  dados_pendentes = @($dadosPendentes)
  codigo_nao_commitado = @($codigoSujo)
  publicado_com_codigo_sujo = ($codigoSujo.Count -gt 0)
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
