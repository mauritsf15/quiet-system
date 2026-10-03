using Microsoft.Extensions.Hosting;

namespace QuietSystem.Telemetry.Services;

public sealed class LyricsSource(MediaSource media, LyricsClient client) : BackgroundService
{
    private LyricsFrame _current = new("", false, Array.Empty<LyricLine>());
    private readonly SemaphoreSlim _wake = new(0, 1);
    public LyricsFrame Current => Volatile.Read(ref _current);

    private void Signal()
    {
        try { _wake.Release(); } catch (SemaphoreFullException) { }
    }

    public static bool CanLookup(MediaFrame frame) => frame.Enabled
        && frame.State is "playing" or "paused" && frame.MediaType is not ("video" or "image")
        && frame.Position is not null && frame.Duration is > 0 && frame.TrackKey.Length > 0
        && !string.IsNullOrWhiteSpace(frame.Title) && !string.IsNullOrWhiteSpace(frame.Artist)
        && !frame.Title.Equals("Untitled", StringComparison.OrdinalIgnoreCase)
        && !frame.Artist.Equals("Unknown artist", StringComparison.OrdinalIgnoreCase);

    private void Publish(LyricsFrame frame)
    {
        var current = Current;
        if (current.TrackKey == frame.TrackKey && current.Available == frame.Available && current.Lines.SequenceEqual(frame.Lines)) return;
        Volatile.Write(ref _current, frame);
    }

    private async Task FetchAsync(MediaFrame frame, CancellationToken cancellation)
    {
        try
        {
            var lines = await client.GetAsync(frame, cancellation);
            // Check again after the asynchronous lookup: the selected player may have changed.
            if (!cancellation.IsCancellationRequested && media.Current.TrackKey == frame.TrackKey && CanLookup(media.Current))
                Publish(new(frame.TrackKey, lines.Any(line => line.Text.Length > 0), lines));
        }
        catch (OperationCanceledException) { }
        catch { /* Lyrics failures never interrupt playback, telemetry, or the UI. */ }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        CancellationTokenSource? request = null;
        Task? pending = null;
        var tasks = new List<Task>();
        var trackKey = "";
        var retryAt = DateTimeOffset.MinValue;
        media.FrameChanged += Signal;
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                var frame = media.Current;
                var key = CanLookup(frame) ? frame.TrackKey : "";
                if (key != trackKey)
                {
                    request?.Cancel();
                    request?.Dispose();
                    request = null;
                    trackKey = key;
                    pending = null;
                    retryAt = DateTimeOffset.MinValue;
                    Publish(new(key, false, Array.Empty<LyricLine>()));
                }
                if (key.Length > 0 && !Current.Available && (pending is null || pending.IsCompleted) && DateTimeOffset.UtcNow >= retryAt)
                {
                    request?.Dispose();
                    request = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                    pending = FetchAsync(frame, request.Token);
                    tasks.RemoveAll(task => task.IsCompleted);
                    tasks.Add(pending);
                    retryAt = DateTimeOffset.UtcNow.AddMinutes(1);
                }
                await _wake.WaitAsync(TimeSpan.FromSeconds(1), stoppingToken);
            }
        }
        finally
        {
            media.FrameChanged -= Signal;
            request?.Cancel();
            await Task.WhenAll(tasks);
            request?.Dispose();
        }
    }
}
