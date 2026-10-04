namespace QuietSystem.Telemetry.Services;

// Only the Windows session boundary is replaced; the real lyrics worker runs in these tests.
public sealed class MediaSource
{
    private MediaFrame _current = new("stopped", "", "", "", "", null, null);
    public MediaFrame Current => Volatile.Read(ref _current);
    public event Action? FrameChanged;
    public void Set(MediaFrame frame) { Volatile.Write(ref _current, frame); FrameChanged?.Invoke(); }
    public Func<MediaControl, CancellationToken, Task>? ControlHandler { get; set; }
    public Task ControlAsync(MediaControl control, CancellationToken cancellation) =>
        ControlHandler?.Invoke(control, cancellation) ?? Task.FromException(new MediaControlException(503, "Media controls unavailable"));
}
