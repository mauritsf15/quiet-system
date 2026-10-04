namespace QuietSystem.Telemetry.Services;

public sealed record MediaControl(string SessionId, string TrackKey, string Action, double? PositionSeconds = null);

public sealed class MediaControlException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
}

// Keep validation and dispatch independent of WinRT so races and failures can be tested.
public static class MediaControlExecutor
{
    public static void Validate(MediaControl control)
    {
        if (string.IsNullOrWhiteSpace(control.SessionId) || string.IsNullOrWhiteSpace(control.TrackKey) ||
            control.Action is not ("play" or "pause" or "previous" or "next" or "seek") ||
            (control.Action == "seek" && (control.PositionSeconds is not double position || !double.IsFinite(position) || position < 0)) ||
            (control.Action != "seek" && control.PositionSeconds is not null))
            throw new MediaControlException(400, "Invalid media control");
    }

    public static async Task ExecuteAsync(MediaControl control, MediaFrame frame, long startTicks,
        Func<string, long?, CancellationToken, Task<bool>> dispatch, CancellationToken cancellation)
    {
        Validate(control);
        if (!frame.Enabled) throw new MediaControlException(503, "Media controls unavailable");
        if (frame.SessionId != control.SessionId || frame.TrackKey != control.TrackKey ||
            frame.State is not ("playing" or "paused"))
            throw new MediaControlException(409, "The media changed. Try again.");
        var capabilities = frame.Capabilities ?? new();
        var supported = control.Action switch
        {
            "play" => capabilities.Play,
            "pause" => capabilities.Pause,
            "previous" => capabilities.Previous,
            "next" => capabilities.Next,
            "seek" => capabilities.Seek,
            _ => false
        };
        if (!supported) throw new MediaControlException(409, "This player does not support that control");
        long? ticks = null;
        if (control.Action == "seek")
        {
            if (frame.SeekMin is not double min || frame.SeekMax is not double max ||
                !double.IsFinite(min) || !double.IsFinite(max) || min < 0 || max <= min)
                throw new MediaControlException(409, "Seeking is unavailable for this track");
            var relative = Math.Clamp(control.PositionSeconds!.Value, min, max);
            try { ticks = checked(startTicks + checked((long)Math.Round(relative * TimeSpan.TicksPerSecond))); }
            catch (OverflowException) { throw new MediaControlException(400, "Invalid seek position"); }
        }
        cancellation.ThrowIfCancellationRequested();
        if (!await dispatch(control.Action, ticks, cancellation))
            throw new MediaControlException(409, "The player could not apply that control. Try again.");
    }
}
