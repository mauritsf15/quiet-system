using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace QuietSystem.Telemetry.Networking;

public static class CommandSocketSession
{
    private const int MaxCommandLength = 8192;
    private const int MaxOutputCharacters = 1_000_000;

    public static async Task RunAsync(WebSocket socket, CancellationToken disconnected)
    {
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(disconnected);
        using var sendLock = new SemaphoreSlim(1, 1);
        var workingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrWhiteSpace(workingDirectory) || !Directory.Exists(workingDirectory))
            workingDirectory = Environment.CurrentDirectory;
        PseudoConsoleProcess? active = null;
        Channel<string>? inputQueue = null;
        string? activeId = null;
        CancellationTokenSource? commandCancellation = null;
        Task? activeTask = null;

        async Task SendAsync(object payload)
        {
            if (socket.State != WebSocketState.Open) return;
            var bytes = JsonSerializer.SerializeToUtf8Bytes(payload);
            try { await sendLock.WaitAsync(lifetime.Token); }
            catch (OperationCanceledException) { return; }
            try
            {
                if (socket.State == WebSocketState.Open)
                    await socket.SendAsync(bytes, WebSocketMessageType.Text, true, lifetime.Token);
            }
            catch (WebSocketException) { }
            catch (OperationCanceledException) { }
            finally { sendLock.Release(); }
        }

        async Task RunCommandAsync(string id, string command, int columns, int rows, Channel<string> queue, CancellationToken cancelled)
        {
            var outputCharacters = 0;
            var exitCode = -1;
            try
            {
                using var terminal = new PseudoConsoleProcess(command, workingDirectory, columns, rows);
                active = terminal;
                using var stop = cancelled.Register(terminal.Stop);
                // Start draining before publishing 'start': ConPTY may write during startup.
                var output = Task.Run(async () =>
                {
                    try
                    {
                        using var reader = new StreamReader(terminal.Output, Encoding.UTF8, false, 4096, leaveOpen: true);
                        var buffer = new char[2049];
                        int count;
                        while ((count = await reader.ReadAsync(buffer.AsMemory(0, 2048))) > 0)
                        {
                            // Never split a UTF-16 surrogate pair across JSON packets.
                            if (char.IsHighSurrogate(buffer[count - 1]))
                            {
                                var next = reader.Read();
                                if (next >= 0) buffer[count++] = (char)next;
                            }
                            outputCharacters += count;
                            if (outputCharacters > MaxOutputCharacters)
                            {
                                if (outputCharacters - count <= MaxOutputCharacters)
                                {
                                    terminal.Stop();
                                    await SendAsync(new { type = "error", id, message = "Output limit reached (1 million characters)." });
                                }
                                continue; // Keep draining so ClosePseudoConsole cannot deadlock.
                            }
                            await SendAsync(new { type = "stdout", id, text = new string(buffer, 0, count) });
                        }
                    }
                    catch (IOException) { terminal.Stop(); }
                });
                var writer = Task.Run(async () =>
                {
                    try
                    {
                        await foreach (var text in queue.Reader.ReadAllAsync(cancelled))
                        {
                            terminal.Input.Write(Encoding.UTF8.GetBytes(text));
                            terminal.Input.Flush();
                        }
                    }
                    catch (IOException) { }
                    catch (OperationCanceledException) { }
                });
                try
                {
                    await SendAsync(new { type = "start", id, cwd = workingDirectory });
                    await terminal.Process.WaitForExitAsync(cancelled);
                }
                catch (OperationCanceledException) { terminal.Stop(); }
                finally
                {
                    queue.Writer.TryComplete();
                    await Task.Run(terminal.CloseConsole);
                    await Task.WhenAll(output, writer);
                    active = null;
                }
                await terminal.Process.WaitForExitAsync();
                exitCode = terminal.Process.ExitCode;
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                await SendAsync(new { type = "error", id, message = error.Message });
            }
            finally { active = null; activeId = null; queue.Writer.TryComplete(); }
            // Release all resources and the busy state before notifying the client.
            await SendAsync(new { type = "exit", id, code = exitCode, cwd = workingDirectory });
        }

        try
        {
            await SendAsync(new { type = "ready", protocol = 2, cwd = workingDirectory });
            var buffer = new byte[16_384];
            using var frame = new MemoryStream();
            while (socket.State == WebSocketState.Open && !lifetime.IsCancellationRequested)
            {
                var result = await socket.ReceiveAsync(buffer, lifetime.Token);
                if (result.MessageType == WebSocketMessageType.Close) break;
                if (result.MessageType != WebSocketMessageType.Text) break;
                if (frame.Length + result.Count > 65_536) break;
                frame.Write(buffer, 0, result.Count);
                if (!result.EndOfMessage) continue;
                using var message = JsonDocument.Parse(frame.GetBuffer().AsMemory(0, (int)frame.Length));
                frame.SetLength(0);
                var root = message.RootElement;
                if (root.ValueKind != JsonValueKind.Object) continue;
                var type = Text(root, "type");
                var id = Text(root, "id");
                if (type == "cancel")
                {
                    if (id == activeId)
                    {
                        inputQueue?.Writer.TryComplete();
                        commandCancellation?.Cancel();
                    }
                    continue;
                }
                if (type == "input" && id == activeId)
                {
                    var text = Text(root, "text");
                    if (text is { Length: > 0 and <= 4096 } && inputQueue is not null && !inputQueue.Writer.TryWrite(text))
                    {
                        commandCancellation?.Cancel();
                        await SendAsync(new { type = "error", id, message = "Input buffer full. Session stopped." });
                    }
                    continue;
                }
                if (type == "resize" && id == activeId)
                {
                    active?.Resize(Dimension(root, "cols", 80, 20, 300), Dimension(root, "rows", 18, 2, 100));
                    continue;
                }
                if (type != "run" || activeId is not null) continue;
                var command = Text(root, "command").Trim();
                if (id.Length is < 1 or > 64 || command.Length is < 1 or > MaxCommandLength) continue;
                if (!root.TryGetProperty("protocol", out var protocol) || protocol.ValueKind != JsonValueKind.Number || !protocol.TryGetInt32(out var version) || version != 2)
                {
                    await SendAsync(new { type = "stderr", id, text = "This terminal interface is out of date. Reload the wallpaper using http://127.0.0.1:9876/wallpaper/?role=commands&v=20261003b, then run your command again.\n" });
                    await SendAsync(new { type = "exit", id, code = -1, cwd = workingDirectory });
                    continue;
                }
                if (command.Equals("cd", StringComparison.OrdinalIgnoreCase) || command.StartsWith("cd ", StringComparison.OrdinalIgnoreCase))
                {
                    var path = command.Length == 2 ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) : command[3..].Trim().Trim('"', '\'');
                    if (string.IsNullOrWhiteSpace(path)) path = workingDirectory;
                    try
                    {
                        if (path == "~") path = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                        var target = Path.GetFullPath(Path.IsPathRooted(path) ? path : Path.Combine(workingDirectory, path));
                        if (Directory.Exists(target)) workingDirectory = target;
                        else await SendAsync(new { type = "stderr", id, text = $"Directory not found: {path}\n" });
                        await SendAsync(new { type = "exit", id, code = Directory.Exists(target) ? 0 : 1, cwd = workingDirectory });
                    }
                    catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException)
                    {
                        await SendAsync(new { type = "stderr", id, text = $"Invalid directory: {error.Message}\n" });
                        await SendAsync(new { type = "exit", id, code = 1, cwd = workingDirectory });
                    }
                    continue;
                }
                activeId = id;
                commandCancellation?.Dispose();
                commandCancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                inputQueue = Channel.CreateBounded<string>(new BoundedChannelOptions(256) { SingleReader = true, SingleWriter = true });
                var queue = inputQueue;
                var columns = Dimension(root, "cols", 80, 20, 300);
                var rows = Dimension(root, "rows", 18, 2, 100);
                var cancellation = commandCancellation.Token;
                activeTask = Task.Run(() => RunCommandAsync(id, command, columns, rows, queue, cancellation));
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
        catch (JsonException) { }
        finally
        {
            await lifetime.CancelAsync();
            inputQueue?.Writer.TryComplete();
            active?.Stop();
            if (activeTask is not null) try { await activeTask; } catch { }
            commandCancellation?.Dispose();
        }
    }

    private static int Dimension(JsonElement root, string name, int fallback, int minimum, int maximum) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)
            ? Math.Clamp(number, minimum, maximum) : fallback;

    private static string Text(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";
}
