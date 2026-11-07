# Copies the ECHO PWA assets into local Android/iOS app folders.
# Run from repository root: powershell -ExecutionPolicy Bypass -File mobile/package-web.ps1
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$files = @(
  "index.html","style.css","features.css","executive-light.css","script.js","features.js","i18n.js",
  "accessibility.js","backup.js","recorder-worklet.js","mobile-voice.js",
  "sw.js","manifest.json","icon-192.png","icon-512.png","cover.png"
)
$dirs = @("fonts","locales")
$targets = @(
  (Join-Path $root "mobile/android/app/src/main/assets/www"),
  (Join-Path $root "mobile/ios/www")
)
foreach ($target in $targets) {
  New-Item -Force -ItemType Directory $target | Out-Null
  foreach ($file in $files) {
    $from = Join-Path $root $file
    if (!(Test-Path $from)) { throw "Missing asset: $file" }
    Copy-Item -LiteralPath $from -Destination (Join-Path $target $file) -Force
  }
  foreach ($dir in $dirs) {
    $from = Join-Path $root $dir
    if (!(Test-Path $from)) { throw "Missing folder: $dir" }
    Copy-Item -LiteralPath $from -Destination $target -Recurse -Force
  }
  Write-Host "Prepared offline UI: $target"
}
Write-Warning "Native PocketTTS engine and model are NOT included. Native voice status remains NOT READY."
