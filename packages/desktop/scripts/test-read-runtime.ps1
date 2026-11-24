# Exercise the packaged server on loopback with isolated, disposable data.
# No user credentials, extension repositories, or third-party source requests.
param([Parameter(Mandatory = $true)][string]$Runtime)
$ErrorActionPreference = 'Stop'
$runtimeRoot = (Resolve-Path -LiteralPath $Runtime).Path
$java = Join-Path $runtimeRoot 'jre/bin/java.exe'
$jar = Join-Path $runtimeRoot 'suwayomi.jar'
if (-not (Test-Path -LiteralPath $java -PathType Leaf) -or
    -not (Test-Path -LiteralPath $jar -PathType Leaf)) {
    throw 'Reading runtime is not packaged'
}
$data = Join-Path ([IO.Path]::GetTempPath()) ('tsugi-read-smoke-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $data | Out-Null
$process = $null
$listener = $null
try {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    $listener = $null
    $user = 'tsugi-smoke'
    $password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $config = @"
server.ip = "127.0.0.1"
server.port = $port
server.webUIEnabled = false
server.initialOpenInBrowserEnabled = false
server.systemTrayEnabled = false
server.kcefEnabled = false
server.authMode = "basic_auth"
server.authUsername = "$user"
server.authPassword = "$password"
server.extensionRepos = []
server.globalUpdateInterval = 0
"@
    $config | Set-Content -LiteralPath (Join-Path $data 'server.conf') -Encoding utf8
    $args = @(
        ('"-Dsuwayomi.tachidesk.config.server.rootDir=' + $data + '"'),
        '-Dsuwayomi.tachidesk.config.server.ip=127.0.0.1',
        "-Dsuwayomi.tachidesk.config.server.port=$port",
        '-Dsuwayomi.tachidesk.config.server.webUIEnabled=false',
        '-Dsuwayomi.tachidesk.config.server.initialOpenInBrowserEnabled=false',
        '-Dsuwayomi.tachidesk.config.server.systemTrayEnabled=false',
        '-Dsuwayomi.tachidesk.config.server.kcefEnabled=false',
        '-jar', ('"' + $jar + '"')
    )
    $process = Start-Process -FilePath $java -ArgumentList $args -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $data 'stdout.txt') `
        -RedirectStandardError (Join-Path $data 'stderr.txt')
    $url = "http://127.0.0.1:$port/api/graphql"
    $auth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${user}:$password"))
    $headers = @{ Authorization = $auth }
    $query = @{ query = 'query TsugiSmoke { aboutServer { version } sources(first: 1) { nodes { id name lang } } }' } | ConvertTo-Json -Compress
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    $ready = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        $process.Refresh()
        if ($process.HasExited) { throw 'Reading server exited during startup' }
        try {
            $result = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -ContentType 'application/json' -Body $query -TimeoutSec 3 -MaximumRedirection 0
            if ($result.data.aboutServer.version -and $null -ne $result.data.sources -and -not $result.errors) {
                $ready = $true
                break
            }
        } catch {
            # Startup probe only; never output raw responses, logs or credentials.
        }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'Authenticated reading GraphQL startup probe failed' }
    if ([string]$result.data.aboutServer.version -notmatch '^2\.4\.2373$') {
        throw 'Unexpected reading server version'
    }
    $unauthorized = Invoke-WebRequest -Uri $url -Method Post -ContentType 'application/json' -Body $query -TimeoutSec 5 -MaximumRedirection 0 -SkipHttpErrorCheck
    if ($unauthorized.StatusCode -eq 200) {
        $body = $unauthorized.Content | ConvertFrom-Json
        if ($null -ne $body.data.sources) { throw 'Protected source query accepted unauthenticated access' }
    } elseif ($unauthorized.StatusCode -notin @(401, 403)) {
        throw 'Unexpected unauthenticated reading response'
    }
    $bound = @(Get-NetTCPConnection -OwningProcess $process.Id -State Listen -ErrorAction SilentlyContinue)
    if (-not ($bound | Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq $port }) -or
        ($bound | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') })) {
        throw 'Reading server did not bind exclusively to loopback'
    }
    Write-Host 'PASS: bundled Java, pinned Suwayomi version, authenticated GraphQL sources, anonymous rejection, loopback-only binding.'
} finally {
    if ($listener) { $listener.Stop() }
    if ($process) {
        $process.Refresh()
        if (-not $process.HasExited) {
            $process.Kill($true)
            if (-not $process.WaitForExit(10000)) { throw 'Reading server failed to stop' }
        }
        $process.Dispose()
    }
    Remove-Item -LiteralPath $data -Recurse -Force
}
