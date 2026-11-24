# Runs the identical live test binary on the user's own network.
# No install, credentials, admin rights, URL output or app modification.
param(
    [Parameter(Mandatory = $true)]
    [string]$MpvDll,
    [ValidatePattern('^[A-Za-z0-9_-]{11}$')]
    [string]$VideoId = 'YE7VzlLtp-4',
    [string]$ReferenceResolver
)
$ErrorActionPreference = 'Stop'
$env:TSUGI_TEST_MPV = (Resolve-Path -LiteralPath $MpvDll).Path
$env:TSUGI_TEST_VIDEO_ID = $VideoId
$test = 'music_stream::tests::headless_live_playback'
if ($ReferenceResolver) {
    $env:TSUGI_TEST_YTDLP = (Resolve-Path -LiteralPath $ReferenceResolver).Path
    $test = 'music_stream::tests::headless_reference_playback'
}
& (Join-Path $PSScriptRoot 'tsugi-music-smoke.exe') $test --ignored --nocapture
exit $LASTEXITCODE
