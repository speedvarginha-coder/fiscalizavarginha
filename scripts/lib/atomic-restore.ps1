function Get-PathVerificationManifest {
  param([string]$Path)

  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    $item = Get-Item -LiteralPath $Path
    return @("FILE|$($item.Length)|$((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash)")
  }

  if (Test-Path -LiteralPath $Path -PathType Container) {
    $rootPath = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
    return @(
      Get-ChildItem -LiteralPath $Path -Recurse -File |
        ForEach-Object {
          $relative = $_.FullName.Substring($rootPath.Length).TrimStart('\')
          "$relative|$($_.Length)|$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
        } |
        Sort-Object
    )
  }

  throw "Caminho ausente para verificacao: $Path"
}

function Assert-PathsMatch {
  param(
    [string]$Expected,
    [string]$Actual,
    [string]$Label
  )

  $expectedManifest = @(Get-PathVerificationManifest -Path $Expected)
  $actualManifest = @(Get-PathVerificationManifest -Path $Actual)
  $difference = Compare-Object -ReferenceObject $expectedManifest -DifferenceObject $actualManifest
  if ($difference) {
    throw "Verificacao do rollback falhou para $Label`: backup e copia divergem."
  }
}

function Restore-PathAtomically {
  param(
    [string]$Source,
    [string]$Target,
    [string]$Label
  )

  if (-not (Test-Path -LiteralPath $Source)) { return }

  $targetFull = [System.IO.Path]::GetFullPath($Target)
  $targetParent = [System.IO.Path]::GetDirectoryName($targetFull)
  $targetName = [System.IO.Path]::GetFileName($targetFull)
  $token = [Guid]::NewGuid().ToString("N")
  $stage = Join-Path $targetParent (".$targetName.rollback-novo-$token")
  $old = Join-Path $targetParent (".$targetName.rollback-anterior-$token")
  $targetMoved = $false

  foreach ($candidate in @($stage, $old)) {
    $candidateFull = [System.IO.Path]::GetFullPath($candidate)
    if ([System.IO.Path]::GetDirectoryName($candidateFull) -ne $targetParent) {
      throw "Rollback recusado: caminho temporario fora do diretorio esperado."
    }
  }

  try {
    if (Test-Path -LiteralPath $Source -PathType Container) {
      Copy-Item -LiteralPath $Source -Destination $stage -Recurse -Force
    } else {
      Copy-Item -LiteralPath $Source -Destination $stage -Force
    }
    Assert-PathsMatch -Expected $Source -Actual $stage -Label "$Label (preparacao)"

    if (Test-Path -LiteralPath $Target) {
      Move-Item -LiteralPath $Target -Destination $old
      $targetMoved = $true
    }

    try {
      Move-Item -LiteralPath $stage -Destination $Target
      Assert-PathsMatch -Expected $Source -Actual $Target -Label $Label
    } catch {
      if (Test-Path -LiteralPath $Target) {
        Remove-Item -LiteralPath $Target -Recurse -Force
      }
      if ($targetMoved -and (Test-Path -LiteralPath $old)) {
        Move-Item -LiteralPath $old -Destination $Target
        $targetMoved = $false
      }
      throw
    }

    if ($targetMoved -and (Test-Path -LiteralPath $old)) {
      Remove-Item -LiteralPath $old -Recurse -Force
      $targetMoved = $false
    }
  } finally {
    if (Test-Path -LiteralPath $stage) {
      Remove-Item -LiteralPath $stage -Recurse -Force
    }
    if (-not $targetMoved -and (Test-Path -LiteralPath $old)) {
      Remove-Item -LiteralPath $old -Recurse -Force
    }
  }
}
