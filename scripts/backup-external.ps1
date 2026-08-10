param(
  [string]$Destination = "L:\Meu Drive\Fiscaliza Varginha\Backups Externos",
  [int]$Retention = 14
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$backupRoot = Join-Path $root "private\backups"
$workRoot = Join-Path $root "private\backup-export"
$statePath = Join-Path $root "private\state\external_backup.json"

function Write-State {
  param([string]$Status, [string]$Detail, [string]$File = "", [string]$Hash = "")
  $payload = [ordered]@{
    schema = 1
    checked_at = (Get-Date).ToUniversalTime().ToString("o")
    status = $Status
    detail = $Detail
    destination = $Destination
    file = $File
    sha256 = $Hash
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $statePath) | Out-Null
  [System.IO.File]::WriteAllText($statePath, ($payload | ConvertTo-Json) + "`n", (New-Object System.Text.UTF8Encoding($false)))
}

try {
  if ($Retention -lt 3) { throw "Retencao minima: 3 backups." }
  $destinationFull = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\')
  $driveRoot = [System.IO.Path]::GetPathRoot($destinationFull).TrimEnd('\')
  if ($destinationFull -eq $driveRoot -or $destinationFull.Split('\').Count -lt 4) {
    throw "Destino externo recusado por ser amplo demais: $destinationFull"
  }

  $latest = Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction Stop |
    Where-Object { $_.Name -like "coleta-*" -and (Test-Path (Join-Path $_.FullName "data\manifest.json")) } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $latest) { throw "Nenhum backup completo de coleta foi encontrado." }

  $chunks = Join-Path $latest.FullName "data\chunks"
  $chunkCount = @(Get-ChildItem -LiteralPath $chunks -File -Filter "*.json" -ErrorAction Stop).Count
  if ($chunkCount -lt 20) { throw "Backup recusado: somente $chunkCount chunks JSON." }

  New-Item -ItemType Directory -Force -Path $workRoot | Out-Null
  New-Item -ItemType Directory -Force -Path $destinationFull | Out-Null
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $fileName = "fiscaliza-dados-$stamp.zip"
  $localZip = Join-Path $workRoot $fileName
  $partial = Join-Path $destinationFull (".$fileName.partial")
  $remoteZip = Join-Path $destinationFull $fileName
  $hashFile = "$remoteZip.sha256"

  if (Test-Path $localZip) { Remove-Item -LiteralPath $localZip -Force }
  Compress-Archive -Path (Join-Path $latest.FullName "*") -DestinationPath $localZip -CompressionLevel Optimal -Force
  $localHash = (Get-FileHash -LiteralPath $localZip -Algorithm SHA256).Hash.ToLowerInvariant()
  Copy-Item -LiteralPath $localZip -Destination $partial -Force
  $externalHash = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($externalHash -ne $localHash) { throw "Hash da copia externa diverge do arquivo local." }
  Move-Item -LiteralPath $partial -Destination $remoteZip -Force
  [System.IO.File]::WriteAllText($hashFile, "$localHash  $fileName`n", (New-Object System.Text.UTF8Encoding($false)))

  $old = @(Get-ChildItem -LiteralPath $destinationFull -File -Filter "fiscaliza-dados-*.zip" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Retention)
  foreach ($item in $old) {
    $itemFull = [System.IO.Path]::GetFullPath($item.FullName)
    if (-not $itemFull.StartsWith($destinationFull + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Retencao recusou caminho fora do destino: $itemFull"
    }
    Remove-Item -LiteralPath $itemFull -Force
    Remove-Item -LiteralPath ($itemFull + ".sha256") -Force -ErrorAction SilentlyContinue
  }

  Remove-Item -LiteralPath $localZip -Force
  Write-State -Status "ok" -Detail "$chunkCount chunks copiados e verificados." -File $fileName -Hash $localHash
  Write-Host "OK - backup externo verificado: $remoteZip"
} catch {
  Write-State -Status "falha" -Detail $_.Exception.Message
  throw
}
