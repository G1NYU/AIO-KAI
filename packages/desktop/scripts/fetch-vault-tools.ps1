# Bundle the pinned independent upstream transfer engine in the Windows test ZIP.
param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$dir = (New-Item -ItemType Directory -Force $Destination).FullName
$binary = Join-Path $dir 'aria2-next.exe'
Invoke-WebRequest -Uri 'https://github.com/AnInsomniacy/aria2-next/releases/download/v3.1.2/aria2-next-3.1.2-windows-x86_64.exe' -OutFile $binary
if ((Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant() -ne '94edc284cd84dec26a16ae9431378c5ab9e5cde8011482566483f4f0cb20c03f') {
    Remove-Item -LiteralPath $binary -Force
    throw 'Aria2 Next binary checksum mismatch'
}
$version = & $binary --version
if ($LASTEXITCODE -ne 0 -or ($version -join " ") -notmatch '\b3\.1\.2\b') { throw 'Unexpected engine version' }
@'
Aria2 Next v3.1.2 (unmodified independent executable)
Copyright and license: source/AUTHORS and source/COPYING.
Corresponding source, including vendored dependencies, notices and build scripts:
source/aria2-next-3.1.2-source.tar.gz (SHA-256 in source/SOURCE.sha256).
Exact upstream revision: 2a13a664edb5314d86bfd7d488305266be6688e8
https://github.com/AnInsomniacy/aria2-next/tree/2a13a664edb5314d86bfd7d488305266be6688e8
https://github.com/AnInsomniacy/aria2-next/releases/tag/v3.1.2
Independent process, GPLv2; see source for individual dependency licenses.
'@ | Set-Content -Path (Join-Path $dir 'SOURCE.txt') -Encoding utf8
