# First launch fetches the exact upstream reading runtime directly.
# Does not require Java, a separate server installation, administrator access,
# or changes to the system PowerShell execution policy.
param([switch]$PrepareOnly)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$current = Join-Path $root 'current'
$exe = Join-Path $current 'Tsugi.exe'
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
# Verify the actual packaged executable accepts the exact bundled setup.
$probe = Start-Process -FilePath $exe -ArgumentList '--check-reading-setup' -WorkingDirectory $current -Wait -PassThru
if ($probe.ExitCode -ne 0) {
    throw "Tsugi cannot detect its prepared reading runtime (code $($probe.ExitCode)). Close all Tsugi windows, extract the complete ZIP into a new folder, and check that no custom web-directory override is set."
}
Write-Host 'Tsugi reading runtime ready.'
if (-not $PrepareOnly) {
    # If this exact executable is already running, its immutable bridge may
    # still advertise its old capability. Require a restart, never kill it.
    $running = @(Get-Process -Name 'Tsugi' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
    if ($running.Count -gt 0) { throw 'Close the running Tsugi window, then run Start Tsugi again.' }
    Start-Process -FilePath $exe -WorkingDirectory $current
}
