# Stage only the server and Java from the pinned official Windows bundle.
# Never run or redistribute the upstream launcher/Electron UI here.
param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Use framework primitives so Windows PowerShell 5.1 does not depend on
# module discovery inherited from a PowerShell 7 or custom environment.
function Get-ReadingSha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
        } finally { $sha.Dispose() }
    } finally { $stream.Dispose() }
}

function Get-ReadingDownload([string]$Url, [string]$Path) {
    # Use the Windows-supplied curl, not a PATH replacement, when available.
    # This avoids Windows PowerShell's slow progress rendering on large ZIPs.
    $curl = Join-Path $env:SystemRoot 'System32/curl.exe'
    if (Test-Path -LiteralPath $curl -PathType Leaf) {
        & $curl --fail --location --silent --show-error --retry 2 --connect-timeout 30 --max-time 600 --proto '=https' --proto-redir '=https' --output $Path -- $Url
        if ($LASTEXITCODE -ne 0) { throw 'Reading runtime download failed' }
    } else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Path -TimeoutSec 600
    }
}
$root = (New-Item -ItemType Directory -Force $Destination).FullName
if (Get-ChildItem -LiteralPath $root -Force | Select-Object -First 1) {
    throw 'Reading runtime destination must be empty'
}
$temp = Join-Path ([IO.Path]::GetTempPath()) ('tsugi-read-tools-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    $archive = Join-Path $temp 'upstream.zip'
    Get-ReadingDownload 'https://github.com/Suwayomi/Suwayomi-Server/releases/download/v2.4.2373/Suwayomi-Server-v2.4.2373-windows-x64.zip' $archive
    if ((Get-ReadingSha256 $archive) -ne 'a8f1c7cf45ca3666afc2e8a06c7f4a968e07cee7d668e8be7cf194273a672a15') {
        throw 'Official Windows bundle checksum mismatch'
    }
    $unpacked = Join-Path $temp 'unpacked'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $unpacked)
    $matches = @(@(Get-Item -LiteralPath $unpacked) + @(Get-ChildItem -LiteralPath $unpacked -Directory) | Where-Object {
        (Test-Path -LiteralPath (Join-Path $_.FullName 'jre/bin/java.exe') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $_.FullName 'bin/Suwayomi-Server.jar') -PathType Leaf)
    })
    if ($matches.Count -ne 1) { throw 'Unexpected official Windows bundle layout' }
    $runtime = $matches[0].FullName
    $jar = Join-Path $runtime 'bin/Suwayomi-Server.jar'
    if ((Get-ReadingSha256 $jar) -ne 'dd05d523cc785b7acf90c9feac0bc84c53d5fb3af5ab2a33653646e2076e5217') {
        throw 'Official server JAR checksum mismatch'
    }
    New-Item -ItemType Directory -Path (Join-Path $root 'bin') | Out-Null
    Move-Item -LiteralPath $jar -Destination (Join-Path $root 'bin/Suwayomi-Server.jar')
    Move-Item -LiteralPath (Join-Path $runtime 'jre') -Destination (Join-Path $root 'jre')
    # java -version writes to stderr even on success. Windows PowerShell
    # 5.1 can turn redirected native stderr into a terminating ErrorRecord.
    $stdout = Join-Path $temp 'java-version-stdout.txt'
    $stderr = Join-Path $temp 'java-version-stderr.txt'
    $probe = Start-Process -FilePath (Join-Path $root 'jre/bin/java.exe') -ArgumentList '-version' -NoNewWindow -Wait -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $version = (Get-Content -LiteralPath $stdout -Raw) + (Get-Content -LiteralPath $stderr -Raw)
    if ($probe.ExitCode -ne 0 -or $version -notmatch '25\.0\.5\.1' -or $version -notmatch 'Zulu25\.38\+201-CA') {
        throw 'Unexpected bundled Java version'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'jre/legal') -PathType Container)) {
        throw 'Java legal notices missing'
    }
    Get-ReadingDownload 'https://raw.githubusercontent.com/Suwayomi/Suwayomi-Server/v2.4.2373/LICENSE' (Join-Path $root 'Suwayomi-LICENSE.txt')
    @'
Separate unmodified upstream runtime components prepared directly from upstream.
Suwayomi Server v2.4.2373: MPL-2.0; source and build instructions:
https://github.com/Suwayomi/Suwayomi-Server/tree/v2.4.2373
https://github.com/Suwayomi/Suwayomi-Server/releases/tag/v2.4.2373
Azul Zulu OpenJDK JRE 25.0.5.1+2 (Zulu25.38+201-CA), from the official
Suwayomi Windows bundle; GPL-2.0 with Classpath Exception. The complete JRE
legal directory and release file are retained. Before public redistribution,
verify corresponding-source obligations and availability for this exact build.
https://www.azul.com/downloads/
https://docs.azul.com/core/tpls/november-2026/zulu25_jdk_tpl.html
https://github.com/openjdk/jdk25u
'@ | Set-Content -LiteralPath (Join-Path $root 'SOURCE.txt') -Encoding utf8
} catch {
    Get-ChildItem -LiteralPath $root -Force | Remove-Item -Recurse -Force
    throw
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force
}
