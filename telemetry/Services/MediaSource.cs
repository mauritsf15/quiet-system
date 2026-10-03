using Microsoft.Extensions.Hosting;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace QuietSystem.Telemetry.Services;

public sealed record MediaFrame(string State, string Title, string Artist, string Album,
    string Thumbnail, double? Position, double? Duration, bool Enabled = true);

public sealed class MediaSource : BackgroundService
{
    private MediaFrame _current = new("stopped", "", "", "", "", null, null);
    public MediaFrame Current => Volatile.Read(ref _current);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        GlobalSystemMediaTransportControlsSessionManager? manager = null;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                manager ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
                var session = manager.GetCurrentSession();
                if (session is null)
                {
                    Volatile.Write(ref _current, new MediaFrame("stopped", "", "", "", "", null, null));
                }
                else
                {
                    var properties = await session.TryGetMediaPropertiesAsync();
                    var playback = session.GetPlaybackInfo();
                    var timeline = session.GetTimelineProperties();
                    var state = playback.PlaybackStatus switch
                    {
                        GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing => "playing",
                        GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused => "paused",
                        _ => "stopped"
                    };
                    var thumbnail = await ReadArtworkAsync(properties.Thumbnail);
                    var position = timeline.Position.TotalSeconds;
                    var duration = (timeline.EndTime - timeline.StartTime).TotalSeconds;
                    Volatile.Write(ref _current, new MediaFrame(state, properties.Title ?? "", properties.Artist ?? "",
                        properties.AlbumTitle ?? "", thumbnail, position >= 0 ? position : null, duration > 0 ? duration : null));
                }
            }
            catch
            {
                manager = null;
                Volatile.Write(ref _current, new MediaFrame("stopped", "", "", "", "", null, null, false));
            }
            await Task.Delay(1000, stoppingToken);
        }
    }

    private static async Task<string> ReadArtworkAsync(IRandomAccessStreamReference? reference)
    {
        if (reference is null) return "";
        using var stream = await reference.OpenReadAsync();
        if (stream.Size is 0 or > 2_000_000) return "";
        using var reader = new DataReader(stream);
        var size = (uint)stream.Size;
        await reader.LoadAsync(size);
        var bytes = new byte[size];
        reader.ReadBytes(bytes);
        var mime = stream.ContentType;
        if (mime is not ("image/png" or "image/jpeg" or "image/webp" or "image/gif")) mime = "image/jpeg";
        return $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
    }
}
