# Windows only: compile and run the disposable WebView2 integration probe.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'The cache probe requires Windows.' }
Push-Location (Join-Path $PSScriptRoot '..')
try {
    cargo run --locked -p aiostreams-desktop --example webview_cache_probe
    if ($LASTEXITCODE -ne 0) { throw "WebView2 cache probe failed: $LASTEXITCODE" }
} finally {
    Pop-Location
}
