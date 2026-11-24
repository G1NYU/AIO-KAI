# Exercise the packaged server on loopback with isolated, disposable data.
# No user credentials, extension repositories, or third-party source requests.
param(
    [Parameter(Mandatory = $true)][string]$Runtime,
    [switch]$UpstreamLayout
)
$ErrorActionPreference = 'Stop'
$runtimeRoot = (Resolve-Path -LiteralPath $Runtime).Path
$java = Join-Path $runtimeRoot 'jre/bin/java.exe'
# Preserve the known-working upstream relative layout for both staging paths.
$jar = Join-Path $runtimeRoot 'bin/Suwayomi-Server.jar'
if (-not (Test-Path -LiteralPath $java -PathType Leaf) -or
    -not (Test-Path -LiteralPath $jar -PathType Leaf)) {
    throw 'Reading runtime is not packaged'
}
$archive = [IO.Compression.ZipFile]::OpenRead($jar)
try {
    $graphqlClasses = @($archive.Entries | Where-Object {
        $_.FullName -like 'suwayomi/tachidesk/graphql/*.class'
    }).Count
    Write-Host "Packaged GraphQL classes: $graphqlClasses"
    if ($graphqlClasses -eq 0) { throw 'No GraphQL classes in server JAR' }
} finally { $archive.Dispose() }
$data = Join-Path ([IO.Path]::GetTempPath()) ('tsugi-read-smoke-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $data | Out-Null
$process = $null
$listener = $null
$client = $null
function Write-ReadingStartupDiagnostics {
    # The fixture has no external source or user data. Still log only exception
    # class and code symbol names, never exception messages or full log lines.
    $logText = ((Get-Content -LiteralPath (Join-Path $data 'stdout.txt') -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath (Join-Path $data 'stderr.txt') -ErrorAction SilentlyContinue)) -join "`n"
    foreach ($marker in @('BindException', 'UnsupportedClassVersionError', 'NoClassDefFoundError', 'OutOfMemoryError', 'ConfigException', 'SQLException', 'ExceptionInInitializerError', 'Javalin started')) {
        if ($logText.Contains($marker)) { Write-Host "Reading startup marker: $marker" }
    }
    $types = [regex]::Matches($logText, '(?m)^\s*(?:Caused by:\s*|Exception in thread "[^"]+"\s+)?((?:java|javax|kotlin|org|com|suwayomi|xyz|io|net)\.[A-Za-z0-9_.$]+(?:Exception|Error))(?=[:\s]|$)')
    foreach ($type in ($types | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique -First 12)) {
        Write-Host "Reading startup exception type: $type"
    }
    $frames = [regex]::Matches($logText, '(?m)^\s*at\s+((?:java|javax|kotlin|org|com|suwayomi|xyz|io|net)\.[A-Za-z0-9_.$<>]+)\(')
    foreach ($frame in ($frames | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique -First 20)) {
        Write-Host "Reading startup frame: $frame"
    }
}
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
    $process = Start-Process -FilePath $java -ArgumentList $args -WorkingDirectory $runtimeRoot -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $data 'stdout.txt') `
        -RedirectStandardError (Join-Path $data 'stderr.txt')
    $url = "http://127.0.0.1:$port/api/graphql"
    # Use a direct, no-proxy HttpClient for this fixed loopback endpoint.
    # Avoid PowerShell web cmdlet auth policy and never follow redirects.
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $handler.AllowAutoRedirect = $false
    $handler.UseCookies = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(5)
    $auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${user}:$password"))
    $query = @{ query = 'query TsugiSmoke { aboutServer { version } sources(first: 1) { nodes { id name lang } } }' } | ConvertTo-Json -Compress
    function Invoke-ReadingProbe([bool]$Authenticated) {
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, $url)
        try {
            $request.Content = [Net.Http.StringContent]::new($query, [Text.Encoding]::UTF8, 'application/json')
            if ($Authenticated) {
                $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Basic', $auth)
            }
            $response = $client.SendAsync($request).GetAwaiter().GetResult()
            try {
                $status = [int]$response.StatusCode
                $body = $null
                if ($status -eq 200) {
                    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
                }
                return @{ Status = $status; Body = $body }
            } finally { $response.Dispose() }
        } finally { $request.Dispose() }
    }
    $deadline = [DateTime]::UtcNow.AddMinutes(3)
    $ready = $false
    $last = 'No HTTP response'
    $lastPrinted = ''
    while ([DateTime]::UtcNow -lt $deadline) {
        $process.Refresh()
        if ($process.HasExited) {
            Write-ReadingStartupDiagnostics
            throw "Reading server exited during startup (exit $($process.ExitCode))"
        }
        try {
            $result = Invoke-ReadingProbe $true
            $last = "HTTP $($result.Status)"
            if ($result.Status -eq 200) {
                $body = $result.Body
                if ($body.errors) {
                    $last += ': GraphQL errors (' + @($body.errors).Count + ')'
                } elseif ($body.data.aboutServer.version -and $null -ne $body.data.sources) {
                    $ready = $true
                    break
                } else {
                    $last += ': expected fields missing'
                }
            }
        } catch {
            $last = 'Probe exception: ' + $_.Exception.GetBaseException().GetType().Name
        }
        if ($last -ne $lastPrinted) {
            Write-Host "Reading startup: $last"
            $lastPrinted = $last
        }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) {
        $portBound = @(Get-NetTCPConnection -OwningProcess $process.Id -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq $port }).Count -gt 0
        Write-ReadingStartupDiagnostics
        throw "Authenticated reading GraphQL startup probe failed ($last; loopback port bound: $portBound)"
    }
    # Upstream getTachideskVersion() returns "v2.4.<commit count>".
    if ([string]$result.Body.data.aboutServer.version -cne 'v2.4.2373') {
        throw 'Unexpected reading server version'
    }
    Write-Host 'PASS: authenticated GraphQL query and exact upstream version v2.4.2373.'
    $unauthorized = Invoke-ReadingProbe $false
    if ($unauthorized.Status -eq 200) {
        if ($null -ne $unauthorized.Body.data.sources) { throw 'Protected source query accepted unauthenticated access' }
    } elseif ($unauthorized.Status -notin @(401, 403)) {
        throw 'Unexpected unauthenticated reading response'
    }
    $bound = @(Get-NetTCPConnection -OwningProcess $process.Id -State Listen -ErrorAction SilentlyContinue)
    if (-not ($bound | Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.LocalPort -eq $port }) -or
        ($bound | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') })) {
        throw 'Reading server did not bind exclusively to loopback'
    }
    Write-Host 'PASS: bundled Java, pinned Suwayomi version, authenticated GraphQL sources, anonymous rejection, loopback-only binding.'
} finally {
    if ($client) { $client.Dispose() }
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
