# Stage only the server and Java from the pinned official Windows bundle.
# Never run or redistribute the upstream launcher/Electron UI here.
param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$root = (New-Item -ItemType Directory -Force $Destination).FullName
if (Get-ChildItem -LiteralPath $root -Force | Select-Object -First 1) {
    throw 'Reading runtime destination must be empty'
}
$temp = Join-Path ([IO.Path]::GetTempPath()) ('tsugi-read-tools-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    $archive = Join-Path $temp 'upstream.zip'
    Invoke-WebRequest -UseBasicParsing 'https://github.com/Suwayomi/Suwayomi-Server/releases/download/v2.4.2373/Suwayomi-Server-v2.4.2373-windows-x64.zip' -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'a8f1c7cf45ca3666afc2e8a06c7f4a968e07cee7d668e8be7cf194273a672a15') {
        throw 'Official Windows bundle checksum mismatch'
    }
    $unpacked = Join-Path $temp 'unpacked'
    Expand-Archive -LiteralPath $archive -DestinationPath $unpacked
    $matches = @(@(Get-Item -LiteralPath $unpacked) + @(Get-ChildItem -LiteralPath $unpacked -Directory) | Where-Object {
        (Test-Path -LiteralPath (Join-Path $_.FullName 'jre/bin/java.exe') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $_.FullName 'bin/Suwayomi-Server.jar') -PathType Leaf)
    })
    if ($matches.Count -ne 1) { throw 'Unexpected official Windows bundle layout' }
    $runtime = $matches[0].FullName
    $jar = Join-Path $runtime 'bin/Suwayomi-Server.jar'
    if ((Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'dd05d523cc785b7acf90c9feac0bc84c53d5fb3af5ab2a33653646e2076e5217') {
        throw 'Official server JAR checksum mismatch'
    }
    New-Item -ItemType Directory -Path (Join-Path $root 'bin') | Out-Null
    Move-Item -LiteralPath $jar -Destination (Join-Path $root 'bin/Suwayomi-Server.jar')
    Move-Item -LiteralPath (Join-Path $runtime 'jre') -Destination (Join-Path $root 'jre')
    $version = & (Join-Path $root 'jre/bin/java.exe') -version 2>&1
    if ($LASTEXITCODE -ne 0 -or ($version -join "`n") -notmatch '25\.0\.5\.1' -or ($version -join "`n") -notmatch 'Zulu25\.38\+201-CA') {
        throw 'Unexpected bundled Java version'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'jre/legal') -PathType Container)) {
        throw 'Java legal notices missing'
    }
    Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Suwayomi/Suwayomi-Server/v2.4.2373/LICENSE' -OutFile (Join-Path $root 'Suwayomi-LICENSE.txt')
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
