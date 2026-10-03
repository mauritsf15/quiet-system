using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using QuietSystem.Telemetry.Services;

namespace QuietSystem.Telemetry.Networking;

public static class TelemetrySocketSession
{
    public static async Task RunAsync(WebSocket socket, TelemetrySnapshotStore snapshots, CancellationToken requestAborted)
    {
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
        var interval = new ClientInterval();
        var receive = ReceiveConfigurationAsync(socket, interval, cancellation);

        try
        {
            while (socket.State == WebSocketState.Open && !cancellation.IsCancellationRequested)
            {
                var payload = snapshots.Current;
                if (payload is not null)
                {
                    var bytes = Encoding.UTF8.GetBytes(payload);
                    await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellation.Token);
                }
                await Task.Delay(interval.Milliseconds, cancellation.Token);
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
        finally
        {
            await cancellation.CancelAsync();
            try { await receive; } catch { /* Connection is already ending. */ }
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "session complete", CancellationToken.None);
            }
            socket.Dispose();
        }
    }

    private static async Task ReceiveConfigurationAsync(WebSocket socket, ClientInterval interval, CancellationTokenSource cancellation)
    {
        var buffer = new byte[4096];
        try
        {
            while (socket.State == WebSocketState.Open && !cancellation.IsCancellationRequested)
            {
                var result = await socket.ReceiveAsync(buffer, cancellation.Token);
                if (result.MessageType == WebSocketMessageType.Close) break;
                if (result.MessageType != WebSocketMessageType.Text || !result.EndOfMessage) continue;
                using var message = JsonDocument.Parse(buffer.AsMemory(0, result.Count));
                if (message.RootElement.TryGetProperty("type", out var type) && type.GetString() == "configure" &&
                    message.RootElement.TryGetProperty("updateIntervalMs", out var requested))
                {
                    interval.Milliseconds = Math.Clamp(requested.GetInt32(), 500, 1000);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
        catch (JsonException) { }
        finally
        {
            await cancellation.CancelAsync();
        }
    }

    private sealed class ClientInterval
    {
        private int _milliseconds = 1000;
        public int Milliseconds
        {
            get => Volatile.Read(ref _milliseconds);
            set => Volatile.Write(ref _milliseconds, value);
        }
    }
}
