# Compile only the validated application payload. No source compilation here.
param(
    [Parameter(Mandatory)][string]$PortableZip,
    [Parameter(Mandatory)][string]$OutputDir,
    [Parameter(Mandatory)][string]$Compiler,
    [Parameter(Mandatory)][ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+$')][string]$Version
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$zip = (Resolve-Path -LiteralPath $PortableZip).Path
$compilerPath = (Resolve-Path -LiteralPath $Compiler).Path
$out = (New-Item -ItemType Directory -Path $OutputDir -Force).FullName
if (Get-ChildItem -LiteralPath $out -Force | Select-Object -First 1) { throw 'Installer output directory must be empty' }
$stage = Join-Path ([IO.Path]::GetTempPath()) ('tsugi-installer-' + [Guid]::NewGuid().ToString('N'))
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $stage)
    $identity = Get-Content -LiteralPath (Join-Path $stage 'BUILD-INFO.json') -Raw | ConvertFrom-Json
    if ($identity.repository -cne $env:GITHUB_REPOSITORY -or $identity.commit -cne $env:GITHUB_SHA -or $identity.run_id -cne $env:GITHUB_RUN_ID -or $identity.run_attempt -cne $env:GITHUB_RUN_ATTEMPT -or $identity.ref -cne $env:GITHUB_REF -or $identity.architecture -cne 'windows-x64' -or $identity.package_format -ne 1) {
        throw 'Installer payload does not match the validated build'
    }
    foreach ($name in @('current/Tsugi.exe','current/web/index.html','current/read-launcher/fetch-read-tools.ps1','current/read-launcher/TsugiReadLauncher.class','current/vault-tools/aria2-next.exe','current/media-tools/ffmpeg.exe','current/media-tools/ffprobe.exe','LICENSE','BUILD-INFO.json','.portable')) {
        if (-not (Test-Path -LiteralPath (Join-Path $stage $name) -PathType Leaf)) { throw "Missing validated payload file $name" }
    }
    if (Test-Path -LiteralPath (Join-Path $stage 'current/read-tools')) { throw 'Unexpected upstream reading runtime in distributable payload' }
    [IO.File]::WriteAllText((Join-Path $stage '.tsugi-installed'), "TSUGI-INSTALLATION-1" + [char]10, [Text.UTF8Encoding]::new($false))
    @'
TSUGI WINDOWS INSTALLATION

Launch TSUGI from the Start menu. The selected installation folder contains
the application and its bundled tools. Preferences, libraries, history,
backups and default downloads are under %LOCALAPPDATA%\TSUGI.
The Vault download folder can be changed from the application.

The first Read setup downloads the pinned Java/server runtime from upstream
into the selected installation's current/read-tools directory. Internet
access and sufficient free space are required. This runtime is not shipped
inside the installer. The application is installed for your Windows account;
choose a writable local folder on any drive.

Upgrading in the same folder preserves user data. Uninstall from Windows
Settings or the Start menu. The uninstaller leaves user data and downloads
alone. The separately downloaded Java/server program runtime is removed with
the application, not the personal reading data.
To move the program to another drive, uninstall the program first, then
reinstall in the new folder; your user data stays in its original location.

Previous portable builds keep their own data folders. This installer does
not copy or delete them. Retain the original and use the supported backup/
restore features to migrate data you want to keep.

The executable and installer are unsigned. Verify the published SHA-256.
'@ | Set-Content -LiteralPath (Join-Path $stage 'README-INSTALL.txt') -Encoding utf8
    $script = (Resolve-Path (Join-Path $PSScriptRoot '../installer/tsugi.iss')).Path
    & $compilerPath "/DStageDir=$stage" "/DOutputDir=$out" "/DAppVersion=$Version" $script
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup compiler failed: $LASTEXITCODE" }
    $exe = Join-Path $out 'Tsugi-windows-x64-setup.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'No installer output' }
    $hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  Tsugi-windows-x64-setup.exe" | Set-Content -LiteralPath (Join-Path $out 'SHA256SUMS.txt') -Encoding ascii
    [ordered]@{
        repository = $identity.repository
        commit = $identity.commit
        run_id = $identity.run_id
        run_attempt = $identity.run_attempt
        tag = "v$Version"
        architecture = 'windows-x64'
        portable_payload_sha256 = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
        installer_sha256 = $hash
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'INSTALLER-INFO.json') -Encoding utf8
    Write-Host "PASS: compiled installer for exact validated payload. SHA256=$hash"
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
