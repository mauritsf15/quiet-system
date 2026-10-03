using System.Net.WebSockets;
using System.Text.Json;
using QuietSystem.Telemetry.Services;

namespace QuietSystem.Telemetry.Networking;

public static class LiveSocketSession
{
    public static async Task RunAsync(WebSocket socket, MediaSource media, AudioSource audio, CancellationToken disconnected)
    {
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(disconnected);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var tick = 0;
        try
        {
            while (socket.State == WebSocketState.Open && !cancellation.IsCancellationRequested)
            {
                var audioPayload = JsonSerializer.SerializeToUtf8Bytes(new { type = "audio", levels = audio.Current, available = audio.Available }, options);
                await socket.SendAsync(audioPayload, WebSocketMessageType.Text, true, cancellation.Token);
                if (tick++ % 10 == 0)
                {
                    var mediaPayload = JsonSerializer.SerializeToUtf8Bytes(new { type = "media", data = media.Current }, options);
                    await socket.SendAsync(mediaPayload, WebSocketMessageType.Text, true, cancellation.Token);
                }
                await Task.Delay(100, cancellation.Token);
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
    }
}
