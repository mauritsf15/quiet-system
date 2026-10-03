$ErrorActionPreference = 'Stop'
$endpoint = 'http://127.0.0.1:9876'
$token = (Invoke-RestMethod "$endpoint/api/session").token

function Connect-Socket([string]$origin) {
    $client = [System.Net.WebSockets.ClientWebSocket]::new()
    $client.Options.SetRequestHeader('Origin', $origin)
    $client.ConnectAsync([uri]("ws://127.0.0.1:9876/commands?token=$token"), [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
    return $client
}

function Send-Packet($client, $packet) {
    $bytes = [Text.Encoding]::UTF8.GetBytes(($packet | ConvertTo-Json -Compress))
    $client.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
}

function Read-Packet($client) {
    $bytes = [byte[]]::new(16384)
    $timeout = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(12))
    try {
        $result = $client.ReceiveAsync([ArraySegment[byte]]::new($bytes), $timeout.Token).GetAwaiter().GetResult()
        if ($result.MessageType -ne [Net.WebSockets.WebSocketMessageType]::Text) { throw 'Unexpected socket frame.' }
        return [Text.Encoding]::UTF8.GetString($bytes, 0, $result.Count) | ConvertFrom-Json
    }
    finally { $timeout.Dispose() }
}

function Run-Command($client, [string]$id, [string]$command) {
    Send-Packet $client @{ type = 'run'; protocol = 2; id = $id; command = $command }
    $output = ''
    $errors = ''
    do {
        $packet = Read-Packet $client
        if ($packet.type -eq 'stdout') { $output += $packet.text }
        if ($packet.type -eq 'stderr') { $errors += $packet.text }
    } until ($packet.type -eq 'exit')
    return @{ exit = $packet; output = $output; errors = $errors }
}

$socket = Connect-Socket 'http://127.0.0.1:9876'
try {
    $ready = Read-Packet $socket
    if ($ready.type -ne 'ready') { throw 'Command socket did not become ready.' }

    $success = Run-Command $socket 'success' "Write-Output 'quiet-system-ok'"
    if ($success.exit.code -ne 0 -or $success.output -notmatch 'quiet-system-ok') { throw 'PowerShell output failed.' }

    $original = $success.exit.cwd
    $directory = Run-Command $socket 'directory' 'cd ..'
    if ($directory.exit.code -ne 0 -or $directory.exit.cwd -eq $original) { throw 'Working directory did not change.' }

    $failure = Run-Command $socket 'failure' "Write-Error 'expected-error'"
    if (($failure.output + $failure.errors) -notmatch 'expected-error') { throw 'Error output was not streamed.' }

    Send-Packet $socket @{ type = 'run'; protocol = 2; id = 'cancel'; command = 'Start-Sleep -Seconds 30' }
    do { $packet = Read-Packet $socket } until ($packet.type -eq 'start')
    Send-Packet $socket @{ type = 'cancel'; id = 'cancel' }
    do { $packet = Read-Packet $socket } until ($packet.type -eq 'exit')
    if ($packet.code -eq 0) { throw 'Cancelled command returned success.' }
}
finally { $socket.Dispose() }

$rejected = $false
$unauthorized = [System.Net.WebSockets.ClientWebSocket]::new()
try {
    $unauthorized.Options.SetRequestHeader('Origin', 'https://example.invalid')
    $unauthorized.ConnectAsync([uri]("ws://127.0.0.1:9876/commands?token=$token"), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
}
catch { $rejected = $true }
finally { $unauthorized.Dispose() }
if (-not $rejected) { throw 'Nonlocal origin was accepted.' }

$wrongToken = [System.Net.WebSockets.ClientWebSocket]::new()
$rejected = $false
try {
    $wrongToken.Options.SetRequestHeader('Origin', 'http://127.0.0.1:9876')
    $wrongToken.ConnectAsync([uri]'ws://127.0.0.1:9876/commands?token=invalid', [Threading.CancellationToken]::None).GetAwaiter().GetResult()
}
catch { $rejected = $true }
finally { $wrongToken.Dispose() }
if (-not $rejected) { throw 'Invalid command token was accepted.' }

Write-Host 'Command service: output, cd, console errors, cancellation, origin, and token checks passed.'
