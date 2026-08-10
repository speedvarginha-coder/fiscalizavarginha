param(
  [switch]$SkipTests,
  [switch]$SkipPackage,
  [switch]$SkipDeploy,
  [switch]$SkipWhatsApp,
  [switch]$GitSync,
  [switch]$OnlyIfChanged,
  [switch]$SkipSlowAudits,
  [ValidateSet("Full", "Sapl", "NoHeavy")]
  [string]$CollectorMode = "Full"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$updateScript = Join-Path $root "scripts\update-data.ps1"
$arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $updateScript)

if ($SkipTests) { $arguments += "-SkipTests" }
if ($SkipPackage) { $arguments += "-SkipPackage" }
if ($SkipDeploy) { $arguments += "-SkipDeploy" }
if ($SkipWhatsApp) { $arguments += "-SkipWhatsApp" }
if ($GitSync) { $arguments += "-GitSync" }
if ($OnlyIfChanged) { $arguments += "-OnlyIfChanged" }
if ($SkipSlowAudits) { $arguments += "-SkipSlowAudits" }
if ($CollectorMode -ne "Full") { $arguments += @("-CollectorMode", $CollectorMode) }

& powershell.exe @arguments
$code = $LASTEXITCODE

# O pipeline usa 4 para informar que somente o WhatsApp falhou. Isso deve
# continuar visivel no monitor, mas nao deve fazer o Agendador repetir uma
# coleta completa e possivelmente duplicar trabalho. Falhas reais seguem com
# codigo 1 e podem acionar a politica de reinicio da tarefa.
if ($code -eq 4) { exit 0 }
exit $code
