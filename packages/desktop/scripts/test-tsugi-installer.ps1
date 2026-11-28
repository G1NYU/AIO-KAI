# Exercise install, in-place upgrade and uninstall using a selected path.
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$PortableZip,
    [Parameter(Mandatory)][string]$Version,
    [switch]$AllUsers
)
$ErrorActionPreference = 'Stop'
$setup = (Resolve-Path -LiteralPath $Installer).Path
$zip = (Resolve-Path -LiteralPath $PortableZip).Path
$id = [Guid]::NewGuid().ToString('N')
$root = Join-Path $env:RUNNER_TEMP "tsugi-install-smoke-$id"
$other = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Where-Object { $_.DeviceID -ne $env:SystemDrive -and $_.FreeSpace -gt 3GB } | Select-Object -First 1)
if ($other.Count -eq 1) {
    $candidate = Join-Path ($other[0].DeviceID + '\') "tsugi-install-smoke-$id"
    try { New-Item -ItemType Directory -Path $candidate | Out-Null; $root = $candidate } catch { Write-Host 'Alternate drive not writable; using temporary test root.' }
}
New-Item -ItemType Directory -Path $root -Force | Out-Null
$target = Join-Path $root 'Custom TSUGI folder'
$expected = Join-Path $root 'expected'
$mode = '/CURRENTUSER'
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\G1NYU.TSUGI.Windows_is1'
$otherRegistry = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\G1NYU.TSUGI.Windows_is1'
$programs = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
if ($AllUsers) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'All-users installer smoke requires an elevated Windows runner'
    }
    $mode = '/ALLUSERS'
    $target = Join-Path $env:ProgramFiles "TSUGI Installer Smoke $id"
    $registry = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\G1NYU.TSUGI.Windows_is1'
    $otherRegistry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\G1NYU.TSUGI.Windows_is1'
    $programs = [Environment]::GetFolderPath('CommonPrograms')
    $desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
}
$shortcut = Join-Path $programs 'TSUGI\TSUGI.lnk'
$desktopShortcut = Join-Path $desktop 'TSUGI.lnk'
$data = Join-Path $env:LOCALAPPDATA 'TSUGI'
$sentinel = Join-Path $data "installer-smoke-$id.txt"
$createdDataDir = -not (Test-Path -LiteralPath $data)
$runtime = Join-Path $data 'read-tools'
$runtimeCreated = $false
if ((Test-Path $registry) -or (Test-Path $otherRegistry) -or (Test-Path -LiteralPath $target) -or (Test-Path -LiteralPath $runtime)) { throw 'Installer smoke requires a clean runner account and installation/runtime location' }
if ((Test-Path $shortcut) -or (Test-Path $desktopShortcut)) { throw 'Installer smoke requires fresh shortcuts' }
function Install-Test([string]$Destination) {
    $arguments = "$mode /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /TASKS=desktopicon /DIR=" + '"' + $Destination + '"'
    $result = Start-Process -FilePath $setup -ArgumentList $arguments -PassThru -Wait
    if ($result.ExitCode -ne 0) { throw "Installer returned $($result.ExitCode)" }
}
function Assert-Payload {
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $expected 'current') -File -Recurse -Force) {
        $relative = [IO.Path]::GetRelativePath($expected, $file.FullName)
        $installed = Join-Path $target $relative
        if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) { throw "Installed payload missing $relative" }
        if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -cne (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash) { throw "Installed payload differs: $relative" }
    }
    foreach ($name in @('BUILD-INFO.json','LICENSE')) {
        if ((Get-FileHash -LiteralPath (Join-Path $expected $name) -Algorithm SHA256).Hash -cne (Get-FileHash -LiteralPath (Join-Path $target $name) -Algorithm SHA256).Hash) { throw "Installed identity differs: $name" }
    }
    if (Test-Path -LiteralPath (Join-Path $target '.portable')) { throw 'Installed copy incorrectly marked portable' }
    $exe = Join-Path $target 'current/Tsugi.exe'
    foreach ($probe in @(@('--check-tsugi-installation',0),@('--check-vault-engine',0),@('--check-media-tools',0),@('--check-reading-setup',2))) {
        $result = Start-Process -FilePath $exe -ArgumentList $probe[0] -PassThru -Wait
        if ($result.ExitCode -ne $probe[1]) { throw "Installed probe $($probe[0]) returned $($result.ExitCode), expected $($probe[1])" }
    }
    $entry = Get-ItemProperty -LiteralPath $registry
    if (Test-Path $otherRegistry) { throw 'Installer registered the wrong or duplicate scope' }
    if ($entry.DisplayName -notlike 'TSUGI*' -or $entry.DisplayVersion -cne $Version -or $entry.InstallLocation.TrimEnd('\') -ne $target.TrimEnd('\')) { throw 'Installed application registration mismatch' }
    $shell = New-Object -ComObject WScript.Shell
    foreach ($link in @($shortcut,$desktopShortcut)) {
        if (-not (Test-Path -LiteralPath $link -PathType Leaf)) { throw "Missing shortcut $link" }
        if ($shell.CreateShortcut($link).TargetPath -ne $exe) { throw 'Shortcut target mismatch' }
    }
}
function Remove-TestInstall {
    $uninstaller = @(Get-ChildItem -LiteralPath $target -Filter 'unins*.exe' -File -ErrorAction SilentlyContinue)
    if ($uninstaller.Count -ne 1) { throw 'Expected one uninstaller in the test folder' }
    $result = Start-Process -FilePath $uninstaller[0].FullName -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -PassThru -Wait
    if ($result.ExitCode -ne 0) { throw "Uninstaller returned $($result.ExitCode)" }
}
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $expected)
    $portableFixture = Join-Path $root 'Protected portable folder'
    New-Item -ItemType Directory -Path $portableFixture | Out-Null
    'Portable fixture, do not overwrite' | Set-Content -LiteralPath (Join-Path $portableFixture '.portable') -Encoding ascii
    $blockedArgs = "$mode /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR=" + '"' + $portableFixture + '"'
    $blocked = Start-Process -FilePath $setup -ArgumentList $blockedArgs -PassThru -Wait
    if ($blocked.ExitCode -eq 0 -or (Test-Path -LiteralPath (Join-Path $portableFixture 'current/Tsugi.exe')) -or (Test-Path $registry)) { throw 'Setup did not protect an existing portable folder' }
    if ((Get-Content -LiteralPath (Join-Path $portableFixture '.portable') -Raw).Trim() -cne 'Portable fixture, do not overwrite') { throw 'Portable marker changed' }
    Install-Test $target
    Assert-Payload
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    'Preserve personal data' | Set-Content -LiteralPath $sentinel -Encoding ascii
    Install-Test $target
    Assert-Payload
    if ((Get-Content -LiteralPath $sentinel -Raw).Trim() -cne 'Preserve personal data') { throw 'Upgrade modified user data' }
    if ($AllUsers) {
        # Exercise the actual first-time Reader setup in Program Files, not
        # merely a successful installer copy. Downloads must stay per-user.
        $runtimeCreated = $true
        $exe = Join-Path $target 'current/Tsugi.exe'
        $prepare = Start-Process -FilePath $exe -ArgumentList '--prepare-reading' -PassThru -Wait
        if ($prepare.ExitCode -ne 0) { throw "Installed Reader preparation failed: $($prepare.ExitCode)" }
        foreach ($name in @('jre/bin/java.exe','bin/Suwayomi-Server.jar','launcher/TsugiReadLauncher.class')) {
            if (-not (Test-Path -LiteralPath (Join-Path $runtime $name) -PathType Leaf)) { throw "Per-user runtime missing $name" }
        }
        $ready = Start-Process -FilePath $exe -ArgumentList '--check-reading-setup' -PassThru -Wait
        if ($ready.ExitCode -ne 0) { throw 'Installed Reader runtime not detected after preparation' }
        if (Test-Path -LiteralPath (Join-Path $target 'current/read-tools')) { throw 'Reader wrote into Program Files' }
    }
    Remove-TestInstall
    if ($AllUsers -and -not (Test-Path -LiteralPath (Join-Path $runtime 'bin/Suwayomi-Server.jar'))) { throw 'Uninstall deleted per-user Reader runtime' }
    if ((Test-Path -LiteralPath (Join-Path $target 'current/Tsugi.exe')) -or (Test-Path -LiteralPath (Join-Path $target '.tsugi-installed')) -or (Test-Path $registry) -or (Test-Path $shortcut) -or (Test-Path $desktopShortcut)) { throw 'Uninstaller left registered program files or shortcuts' }
    if ((Get-Content -LiteralPath $sentinel -Raw).Trim() -cne 'Preserve personal data') { throw 'Uninstall modified user data' }
    Write-Host "PASS: $mode selectable install folder ($target), exact program files, native probes, shortcuts, upgrade and uninstall with preserved personal data."
} finally {
    if (Test-Path -LiteralPath $sentinel) { Remove-Item -LiteralPath $sentinel -Force }
    if ($runtimeCreated -and (Test-Path -LiteralPath $runtime)) { Remove-Item -LiteralPath $runtime -Recurse -Force }
    if ($createdDataDir -and (Test-Path -LiteralPath $data) -and -not (Get-ChildItem -LiteralPath $data -Force | Select-Object -First 1)) { Remove-Item -LiteralPath $data }
    if (Test-Path -LiteralPath (Join-Path $target 'current/Tsugi.exe')) {
        try { Remove-TestInstall } catch { Write-Warning 'Test uninstaller cleanup failed.' }
    }
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
