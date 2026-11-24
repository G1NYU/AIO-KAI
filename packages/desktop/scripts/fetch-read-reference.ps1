# Diagnostic only: compare the upstream Windows bundle with the separately
# pinned JAR/JRE without running its Electron UI, launcher, installer or extensions.
param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$root = (New-Item -ItemType Directory -Force $Destination).FullName
if (Get-ChildItem -LiteralPath $root -Force | Select-Object -First 1) {
    throw 'Reference runtime destination must be empty'
}
$archive = Join-Path ([IO.Path]::GetTempPath()) ('tsugi-read-reference-' + [Guid]::NewGuid().ToString('N') + '.zip')
try {
    Invoke-WebRequest 'https://github.com/Suwayomi/Suwayomi-Server/releases/download/v2.4.2373/Suwayomi-Server-v2.4.2373-windows-x64.zip' -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'a8f1c7cf45ca3666afc2e8a06c7f4a968e07cee7d668e8be7cf194273a672a15') {
        throw 'Official Windows bundle checksum mismatch'
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $root
    $matches = @(@(Get-Item -LiteralPath $root) + @(Get-ChildItem -LiteralPath $root -Directory) | Where-Object {
        (Test-Path -LiteralPath (Join-Path $_.FullName 'jre/bin/java.exe') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $_.FullName 'bin/Suwayomi-Server.jar') -PathType Leaf)
    })
    if ($matches.Count -ne 1) { throw 'Unexpected official Windows bundle layout' }
    $runtime = $matches[0].FullName
    $serverHash = (Get-FileHash -LiteralPath (Join-Path $runtime 'bin/Suwayomi-Server.jar') -Algorithm SHA256).Hash.ToLowerInvariant()
    Write-Host ("Official bundle JAR matches standalone release: " + ($serverHash -eq 'dd05d523cc785b7acf90c9feac0bc84c53d5fb3af5ab2a33653646e2076e5217'))
    $version = & (Join-Path $runtime 'jre/bin/java.exe') -version 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Official Java runtime failed version check' }
    Write-Host ($version -join "`n")
    & "$PSScriptRoot/test-read-runtime.ps1" -Runtime $runtime -UpstreamLayout
} finally {
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $root -Recurse -Force
}
