# Download the pinned, unmodified Windows x64 reading runtime.
param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$root = (New-Item -ItemType Directory -Force $Destination).FullName
if (Get-ChildItem -LiteralPath $root -Force | Select-Object -First 1) {
    throw 'Reading runtime destination must be empty'
}
$temp = Join-Path ([IO.Path]::GetTempPath()) ('tsugi-read-tools-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
function Fetch-Verified([string]$Url, [string]$Path, [string]$Hash) {
    Invoke-WebRequest -Uri $Url -OutFile $Path
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) {
        throw 'Reading runtime checksum mismatch'
    }
}
try {
    $jar = Join-Path $root 'suwayomi.jar'
    Fetch-Verified 'https://github.com/Suwayomi/Suwayomi-Server/releases/download/v2.4.2373/Suwayomi-Server-v2.4.2373.jar' $jar 'dd05d523cc785b7acf90c9feac0bc84c53d5fb3af5ab2a33653646e2076e5217'
    $archive = Join-Path $temp 'temurin.zip'
    Fetch-Verified 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5.1%2B2/OpenJDK25U-jre_x64_windows_hotspot_25.0.5.1_2.zip' $archive '3260a1b9899f30ac80d737daafc053042c525249f52d066101fbf81d78d73f25'
    $unpacked = Join-Path $temp 'unpacked'
    Expand-Archive -LiteralPath $archive -DestinationPath $unpacked
    $jres = @(Get-ChildItem -LiteralPath $unpacked -Directory | Where-Object {
        Test-Path -LiteralPath (Join-Path $_.FullName 'bin/java.exe') -PathType Leaf
    })
    if ($jres.Count -ne 1) { throw 'Expected exactly one packaged Java runtime' }
    Move-Item -LiteralPath $jres[0].FullName -Destination (Join-Path $root 'jre')
    $java = Join-Path $root 'jre/bin/java.exe'
    $version = & $java -version 2>&1
    if ($LASTEXITCODE -ne 0 -or ($version -join "`n") -notmatch '25\.0\.5\.1') {
        throw 'Unexpected bundled Java version'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'jre/legal') -PathType Container)) {
        throw 'Java legal notices missing'
    }
    Invoke-WebRequest 'https://raw.githubusercontent.com/Suwayomi/Suwayomi-Server/v2.4.2373/LICENSE' -OutFile (Join-Path $root 'Suwayomi-LICENSE.txt')
    @'
Separate unmodified upstream runtime components, not yet shipped in Tsugi.
Suwayomi Server v2.4.2373: MPL-2.0; source and build instructions:
https://github.com/Suwayomi/Suwayomi-Server/tree/v2.4.2373
https://github.com/Suwayomi/Suwayomi-Server/releases/tag/v2.4.2373
Eclipse Temurin JRE 25.0.5.1+2: GPL-2.0 with Classpath Exception;
the complete JRE legal directory and release file are retained.
https://github.com/adoptium/temurin25-binaries/releases/tag/jdk-25.0.5.1%2B2
https://github.com/adoptium/temurin25u
'@ | Set-Content -LiteralPath (Join-Path $root 'SOURCE.txt') -Encoding utf8
} catch {
    Get-ChildItem -LiteralPath $root -Force | Remove-Item -Recurse -Force
    throw
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force
}
