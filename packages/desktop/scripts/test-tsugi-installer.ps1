# Exercise install, in-place upgrade and uninstall using a selected path.
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$PortableZip,
    [Parameter(Mandatory)][string]$Version
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
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\G1NYU.TSUGI.Windows_is1'
$programs = [Environment]::GetFolderPath('Programs')
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shortcut = Join-Path $programs 'TSUGI\TSUGI.lnk'
$desktopShortcut = Join-Path $desktop 'TSUGI.lnk'
$data = Join-Path $env:LOCALAPPDATA 'TSUGI'
$sentinel = Join-Path $data "installer-smoke-$id.txt"
$createdDataDir = -not (Test-Path -LiteralPath $data)
if (Test-Path $registry) { throw 'Installer smoke requires a clean runner account' }
if ((Test-Path $shortcut) -or (Test-Path $desktopShortcut)) { throw 'Installer smoke requires fresh shortcuts' }
function Install-Test([string]$Destination) {
    $arguments = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /TASKS=desktopicon /DIR="' + $Destination + '"'
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
    Install-Test $target
    Assert-Payload
    New-Item -ItemType Directory -Path $data -Force | Out-Null
    'Preserve personal data' | Set-Content -LiteralPath $sentinel -Encoding ascii
    Install-Test $target
    Assert-Payload
    if ((Get-Content -LiteralPath $sentinel -Raw).Trim() -cne 'Preserve personal data') { throw 'Upgrade modified user data' }
    Remove-TestInstall
    if ((Test-Path -LiteralPath (Join-Path $target 'current/Tsugi.exe')) -or (Test-Path -LiteralPath (Join-Path $target '.tsugi-installed')) -or (Test-Path $registry) -or (Test-Path $shortcut) -or (Test-Path $desktopShortcut)) { throw 'Uninstaller left registered program files or shortcuts' }
    if ((Get-Content -LiteralPath $sentinel -Raw).Trim() -cne 'Preserve personal data') { throw 'Uninstall modified user data' }
    Write-Host "PASS: selectable install folder ($target), exact program files, native probes, shortcuts, upgrade and uninstall with preserved personal data."
} finally {
    if (Test-Path -LiteralPath $sentinel) { Remove-Item -LiteralPath $sentinel -Force }
    if ($createdDataDir -and (Test-Path -LiteralPath $data) -and -not (Get-ChildItem -LiteralPath $data -Force | Select-Object -First 1)) { Remove-Item -LiteralPath $data }
    if (Test-Path -LiteralPath (Join-Path $target 'current/Tsugi.exe')) {
        try { Remove-TestInstall } catch { Write-Warning 'Test uninstaller cleanup failed.' }
    }
    if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
