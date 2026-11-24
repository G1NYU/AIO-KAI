# First launch fetches the exact upstream reading runtime directly.
# Does not require Java, a separate server installation, administrator access,
# or changes to the system PowerShell execution policy.
param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$current = Join-Path $root 'current'
$exe = Join-Path $current 'aiostreams-desktop.exe'
$runtime = Join-Path $current 'read-tools'
$launcher = Join-Path $current 'read-launcher/TsugiReadLauncher.class'
$fetch = Join-Path $current 'read-launcher/fetch-read-tools.ps1'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Extract the entire Tsugi ZIP before running this launcher.' }
function Test-Runtime([string]$Path) {
    foreach ($file in @('jre/bin/java.exe', 'bin/Suwayomi-Server.jar', 'launcher/TsugiReadLauncher.class')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Path $file) -PathType Leaf)) { return $false }
    }
    return $true
}
if (-not (Test-Runtime $runtime)) {
    if (Test-Path -LiteralPath $runtime) {
        throw 'Incomplete read-tools folder. Close Tsugi, remove only current/read-tools, and run Start Tsugi again. Do not remove data.'
    }
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf) -or -not (Test-Path -LiteralPath $fetch -PathType Leaf)) {
        throw 'Reading setup files are missing. Re-extract the original ZIP.'
    }
    $temp = Join-Path $current ('read-tools-setup-' + [Guid]::NewGuid().ToString('N'))
    try {
        Write-Host 'Preparing Tsugi reading runtime (one-time, verified upstream download)...'
        & $fetch -Destination $temp
        $classDir = Join-Path $temp 'launcher'
        New-Item -ItemType Directory -Path $classDir | Out-Null
        Copy-Item -LiteralPath $launcher -Destination $classDir
        if (-not (Test-Runtime $temp)) { throw 'Reading runtime setup did not complete.' }
        # Atomic sibling directory rename: never overwrite an existing runtime.
        [IO.Directory]::Move($temp, $runtime)
    } finally {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
    }
}
if (-not $PrepareOnly) {
    Start-Process -FilePath $exe -WorkingDirectory $current
}
