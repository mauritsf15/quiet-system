using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using QuietSystem.Telemetry.Networking;

using var socket = new TestSocket();
using var lifetime = new CancellationTokenSource(TimeSpan.FromMinutes(2));
var session = CommandSocketSession.RunAsync(socket, lifetime.Token);
try
{
    var ready = await socket.Next();
    Require(ready.GetProperty("type").GetString() == "ready", "Socket ready");
    await socket.Packet(new { type = "run", id = "legacy", command = "Write-Output 'legacy-should-not-run'" });
    var legacy = await socket.Next();
    Require(legacy.GetProperty("type").GetString() == "stderr" && legacy.GetProperty("text").GetString()!.Contains("out of date"), "Old interfaces receive a readable reload message");
    Require((await socket.Next()).GetProperty("type").GetString() == "exit", "Old interfaces cannot start interactive processes");
    var output = await Run("basic", "Write-Output 'console-ok café ☃'");
    Require(output.Contains("console-ok café ☃"), "Unicode output");

    output = await Run("failure", "Write-Error 'expected-error'");
    Require(output.Contains("expected-error"), "Errors appear in console output");

    var lineAnswered = false;
    output = await Run("line", "[Console]::Write('reply> '); $reply = [Console]::ReadLine(); Write-Output ('reply=' + $reply)", async text =>
    {
        if (!lineAnswered && text.Contains("reply> ")) { lineAnswered = true; await socket.Packet(new { type = "input", id = "line", text = "hello\r" }); }
    });
    Require(output.Contains("reply=hello"), "Interactive line input");

    const string dummySecret = "never-log-this-test-secret";
    var secretAnswered = false;
    output = await Run("secret", "[Console]::Write('secret> '); $secret = ''; while ($true) { $key = [Console]::ReadKey($true); if ($key.Key -eq 'Enter') { break }; $secret += $key.KeyChar }; Write-Output ('secret-length=' + $secret.Length)", async text =>
    {
        if (!secretAnswered && text.Contains("secret> ")) { secretAnswered = true; await socket.Packet(new { type = "input", id = "secret", text = dummySecret + "\r" }); }
    });
    Require(output.Contains($"secret-length={dummySecret.Length}") && !output.Contains(dummySecret), "Hidden console input is not echoed");

    var resizeAnswered = false;
    output = await Run("resize", "[Console]::Write('resize> '); [Console]::ReadLine() | Out-Null; Write-Output ('size=' + [Console]::WindowWidth + 'x' + [Console]::WindowHeight)", async text =>
    {
        if (resizeAnswered || !text.Contains("resize> ")) return;
        resizeAnswered = true;
        await socket.Packet(new { type = "resize", id = "stale-id", cols = 150, rows = 40 });
        await socket.Packet(new { type = "resize", id = "resize", cols = 100, rows = 25 });
        await socket.Packet(new { type = "input", id = "resize", text = "\r" });
    });
    Require(output.Contains("size=100x25"), "Live console resizing");

    await socket.Packet(new { type = "run", protocol = 2, id = "cancel", command = "Start-Sleep -Seconds 30" });
    await UntilStart();
    await socket.Packet(new { type = "cancel", id = "cancel" });
    var cancelled = await UntilExit();
    Require(cancelled.GetProperty("code").GetInt32() != 0, "STOP terminates process");
    output = await Run("after-cancel", "Write-Output 'after-cancel-ok'");
    Require(output.Contains("after-cancel-ok"), "Next command after cancellation");

    await socket.Packet(new { type = "run", protocol = 2, id = "early-cancel", command = "Start-Sleep -Seconds 30" });
    await socket.Packet(new { type = "cancel", id = "early-cancel" });
    cancelled = await UntilExit();
    Require(cancelled.GetProperty("code").GetInt32() != 0, "STOP during startup");

    await socket.Packet(new { type = "run", protocol = 2, id = "cd", command = "cd .." }, fragmented: true);
    var directory = await UntilExit();
    Require(directory.GetProperty("code").GetInt32() == 0 && directory.GetProperty("cwd").GetString() != ready.GetProperty("cwd").GetString(), "Directory changes and fragmented messages");

    using var fixture = new Process { StartInfo = new ProcessStartInfo("node", "tests/ssh-fixture.cjs") { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true } };
    fixture.Start();
    try
    {
        var line = await fixture.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10));
        Require(int.TryParse(line, out var port), "Local SSH fixture starts");
        bool hostAnswered = false, passwordAnswered = false, shellUsed = false, interrupted = false, exitSent = false;
        output = await Run("ssh", $"ssh -o UserKnownHostsFile=NUL -o StrictHostKeyChecking=ask -o PreferredAuthentications=password -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1 -p {port} quiet-test@127.0.0.1", async text =>
        {
            if (!hostAnswered && text.Contains("Are you sure you want to continue connecting"))
            {
                hostAnswered = true;
                await socket.Packet(new { type = "input", id = "ssh", text = "yes\r" });
            }
            if (!passwordAnswered && text.Contains("password:"))
            {
                passwordAnswered = true;
                await socket.Packet(new { type = "input", id = "ssh", text = "quiet-dummy-password\r" });
            }
            if (!shellUsed && text.Contains("ssh-shell-ready"))
            {
                shellUsed = true;
                await socket.Packet(new { type = "input", id = "ssh", text = "\u0003" });
            }
            if (!interrupted && text.Contains("ssh-interrupted"))
            {
                interrupted = true;
                await socket.Packet(new { type = "input", id = "ssh", text = "echo remote-ok\r" });
            }
            if (!exitSent && text.Contains("remote-ok")) { exitSent = true; await socket.Packet(new { type = "input", id = "ssh", text = "exit\r" }); }
        });
        Require(hostAnswered && passwordAnswered && shellUsed && interrupted && output.Contains("remote-ok"), "SSH host confirmation, password authentication, Ctrl+C, shell input, and exit");
        Require(!output.Contains("quiet-dummy-password"), "SSH password is not echoed");
    }
    finally { if (!fixture.HasExited) fixture.Kill(entireProcessTree: true); }

    await socket.Packet(new { type = "run", protocol = 2, id = "disconnect", command = "Start-Sleep -Seconds 30" });
    await UntilStart();
    lifetime.Cancel();
    await session.WaitAsync(TimeSpan.FromSeconds(10));
    Console.WriteLine("PASS Disconnect cleans up interactive process and console pipes");
}
finally { lifetime.Cancel(); await session.WaitAsync(TimeSpan.FromSeconds(10)); }

async Task<string> Run(string id, string command, Func<string, Task>? respond = null)
{
    await socket.Packet(new { type = "run", protocol = 2, id, command, cols = 80, rows = 18 });
    var text = "";
    while (true)
    {
        var packet = await socket.Next();
        var kind = packet.GetProperty("type").GetString();
        if (kind == "stdout")
        {
            text += packet.GetProperty("text").GetString();
            // A real terminal answers cursor queries; emulate that here.
            if (packet.GetProperty("text").GetString()!.Contains("\u001b[6n"))
                await socket.Packet(new { type = "input", id, text = "\u001b[1;1R" });
            if (respond is not null) await respond(PlainText(text));
        }
        if (kind == "error") throw new Exception(packet.GetProperty("message").GetString());
        if (kind == "exit")
        {
            Require(packet.GetProperty("code").GetInt32() == 0 || id == "failure", $"{id} exits successfully");
            return PlainText(text);
        }
    }
}

async Task UntilStart()
{
    while ((await socket.Next()).GetProperty("type").GetString() != "start") { }
}

async Task<JsonElement> UntilExit()
{
    while (true) { var packet = await socket.Next(); if (packet.GetProperty("type").GetString() == "exit") return packet; }
}

static void Require(bool condition, string message)
{
    if (!condition) throw new Exception("FAIL " + message);
    Console.WriteLine("PASS " + message);
}

static string PlainText(string text)
{
    text = Regex.Replace(text, @"\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)", "");
    text = Regex.Replace(text, @"\x1b\[(\d+)C", match => new string(' ', int.Parse(match.Groups[1].Value)));
    return Regex.Replace(text, @"\x1b\[[0-?]*[ -/]*[@-~]", "");
}

sealed class TestSocket : WebSocket
{
    private readonly Channel<(byte[] Bytes, bool End)> incoming = Channel.CreateUnbounded<(byte[], bool)>();
    private readonly Channel<JsonElement> outgoing = Channel.CreateUnbounded<JsonElement>();
    public override WebSocketCloseStatus? CloseStatus => null;
    public override string? CloseStatusDescription => null;
    public override WebSocketState State => WebSocketState.Open;
    public override string? SubProtocol => null;
    public override void Abort() { }
    public override void Dispose() { }
    public override Task CloseAsync(WebSocketCloseStatus status, string? description, CancellationToken token) => Task.CompletedTask;
    public override Task CloseOutputAsync(WebSocketCloseStatus status, string? description, CancellationToken token) => Task.CompletedTask;
    public async Task Packet(object packet, bool fragmented = false)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(packet);
        if (fragmented) { await incoming.Writer.WriteAsync((bytes[..10], false)); await incoming.Writer.WriteAsync((bytes[10..], true)); }
        else await incoming.Writer.WriteAsync((bytes, true));
    }
    public async Task<JsonElement> Next() => await outgoing.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(15));
    public override async Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer, CancellationToken token)
    {
        var frame = await incoming.Reader.ReadAsync(token);
        frame.Bytes.AsSpan().CopyTo(buffer.AsSpan());
        return new WebSocketReceiveResult(frame.Bytes.Length, WebSocketMessageType.Text, frame.End);
    }
    public override Task SendAsync(ArraySegment<byte> buffer, WebSocketMessageType type, bool end, CancellationToken token)
    {
        using var document = JsonDocument.Parse(buffer.AsMemory());
        return outgoing.Writer.WriteAsync(document.RootElement.Clone(), token).AsTask();
    }
}
