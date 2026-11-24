# Fetch pinned, unmodified Windows x64 music tools for the portable build.
param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$dir = New-Item -ItemType Directory -Force $Destination
$dir = $dir.FullName
function Fetch-Verified($Url, $Path, $Hash) {
    Invoke-WebRequest $Url -OutFile $Path
    if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) {
        throw 'Music tool checksum mismatch'
    }
}
$yt = Join-Path $dir 'yt-dlp.exe'
Fetch-Verified 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.11.23/yt-dlp.exe' $yt '622ed48023cac1daa52a3bf3a6ac38f03514de214b5f0fa069389fd0f6d17e5c'
$archive = Join-Path $env:RUNNER_TEMP 'tsugi-deno.zip'
Fetch-Verified 'https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-pc-windows-msvc.zip' $archive 'cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf'
Expand-Archive -LiteralPath $archive -DestinationPath $dir -Force
Remove-Item -LiteralPath $archive
$deno = Join-Path $dir 'deno.exe'
if (-not (Test-Path -LiteralPath $deno -PathType Leaf)) { throw 'Deno executable missing' }
$version = & $yt --ignore-config --no-plugin-dirs --version
if ($LASTEXITCODE -ne 0 -or $version -ne '2026.11.23') { throw 'Unexpected yt-dlp version' }
$denoVersion = & $deno --version
if ($LASTEXITCODE -ne 0 -or $denoVersion[0] -notmatch '^deno 2\.9\.8\b') { throw 'Unexpected Deno runtime version' }
$denoVersion | Write-Host
Invoke-WebRequest 'https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.11.23/LICENSE' -OutFile (Join-Path $dir 'yt-dlp-LICENSE.txt')
Invoke-WebRequest 'https://www.gnu.org/licenses/gpl-3.0.txt' -OutFile (Join-Path $dir 'GPL-3.0.txt')
Invoke-WebRequest 'https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.11.23/THIRD_PARTY_LICENSES.txt' -OutFile (Join-Path $dir 'yt-dlp-THIRD_PARTY_LICENSES.txt')
Invoke-WebRequest 'https://raw.githubusercontent.com/denoland/deno/v2.9.8/LICENSE.md' -OutFile (Join-Path $dir 'deno-LICENSE.md')
@'
Separate upstream executable tools; see ../THIRD-PARTY.md.
yt-dlp Windows executable: GPL-3.0-or-later; source and build instructions:
https://github.com/yt-dlp/yt-dlp/tree/2026.11.23
https://github.com/yt-dlp/yt-dlp/releases/tag/2026.11.23
Deno: MIT; source and build instructions:
https://github.com/denoland/deno/tree/v2.9.8
https://github.com/denoland/deno/releases/tag/v2.9.8
'@ | Set-Content -Path (Join-Path $dir 'SOURCE.txt') -Encoding utf8
