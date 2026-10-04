using System.Net.WebSockets;
using System.Text.Json;
using QuietSystem.Telemetry.Services;

namespace QuietSystem.Telemetry.Networking;

public static class LiveSocketSession
{
    public static async Task RunAsync(WebSocket socket, MediaSource media, LyricsSource lyrics, AudioSource audio, CancellationToken disconnected)
    {
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(disconnected);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var tick = 0;
        MediaFrame? lastMedia = null;
        LyricsFrame? lastLyrics = null;
        try
        {
            while (socket.State == WebSocketState.Open && !cancellation.IsCancellationRequested)
            {
                var audioPayload = JsonSerializer.SerializeToUtf8Bytes(new { type = "audio", levels = audio.Current, available = audio.Available }, options);
                await socket.SendAsync(audioPayload, WebSocketMessageType.Text, true, cancellation.Token);
                var currentMedia = media.Current;
                if (tick++ % 25 == 0 || !ReferenceEquals(currentMedia, lastMedia))
                {
                    var mediaPayload = JsonSerializer.SerializeToUtf8Bytes(new { type = "media", data = currentMedia }, options);
                    await socket.SendAsync(mediaPayload, WebSocketMessageType.Text, true, cancellation.Token);
                    lastMedia = currentMedia;
                }
                var currentLyrics = lyrics.Current;
                if (!ReferenceEquals(currentLyrics, lastLyrics))
                {
                    var lyricsPayload = JsonSerializer.SerializeToUtf8Bytes(new { type = "lyrics", data = currentLyrics }, options);
                    await socket.SendAsync(lyricsPayload, WebSocketMessageType.Text, true, cancellation.Token);
                    lastLyrics = currentLyrics;
                }
                await Task.Delay(40, cancellation.Token);
            }
        }
        catch (OperationCanceledException) { }
        catch (WebSocketException) { }
    }
}
