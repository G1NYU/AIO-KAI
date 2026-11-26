# Read-only acceptance against the immutable v0.1.0 asset selected from the official release.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'The package verifier requires Windows.' }
$bytes = 173235714
$digest = 'e26fb604d39a1b6a13c6e976f2f820bc6338ee044a21d5c8451d1ed68fa2cd65'
$commit = 'e8e7140fe20ae265ffae4e559a45f939dd5b243b'
$root = Join-Path ([IO.Path]::GetTempPath()) ('tsugi-package-probe-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$zip = Join-Path $root 'Tsugi-windows-x64.zip'
try {
    Invoke-WebRequest -Uri 'https://github.com/G1NYU/TSUGI/releases/download/v0.1.0/Tsugi-windows-x64.zip' -OutFile $zip -TimeoutSec 180
    if ((Get-Item -LiteralPath $zip).Length -ne $bytes) { throw 'Published package size mismatch' }
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $digest) { throw 'Published package checksum mismatch' }
    Push-Location (Join-Path $PSScriptRoot '..')
    try {
        cargo run --locked -p aiostreams-desktop-core --example verify_tsugi_package -- $zip $bytes $digest $commit
        if ($LASTEXITCODE -ne 0) { throw 'Published package verification failed' }
    } finally {
        Pop-Location
    }
} finally {
    if (Test-Path -LiteralPath $zip -PathType Leaf) { Remove-Item -LiteralPath $zip -Force }
    Remove-Item -LiteralPath $root
}
