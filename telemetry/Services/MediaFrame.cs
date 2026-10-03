namespace QuietSystem.Telemetry.Services;

public sealed record MediaFrame(string State, string Title, string Artist, string Album,
    string Thumbnail, double? Position, double? Duration, bool Enabled = true,
    string TrackKey = "", string SessionId = "", string SourceAppId = "",
    string MediaType = "unknown", long CapturedAt = 0, double PlaybackRate = 1);

public static class MediaTiming
{
    public static double? Position(double position, double start, double? duration,
        DateTimeOffset updatedAt, DateTimeOffset capturedAt, bool playing, double rate)
    {
        if (!double.IsFinite(position) || !double.IsFinite(start)) return null;
        var relative = Math.Max(0, position - start);
        var elapsed = (capturedAt - updatedAt).TotalSeconds;
        // Uninitialized Windows timestamps must not extrapolate from the distant past.
        if (playing && double.IsFinite(rate) && rate > 0 && elapsed is >= 0 and < 86400)
            relative += elapsed * rate;
        return duration is > 0 ? Math.Clamp(relative, 0, duration.Value) : relative;
    }
}
