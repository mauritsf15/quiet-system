using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Hosting;
using Windows.Media.Control;
using Windows.Storage.Streams;

namespace QuietSystem.Telemetry.Services;

public sealed class MediaSource : BackgroundService
{
    private MediaFrame _current = new("stopped", "", "", "", "", null, null);
    private readonly SemaphoreSlim _wake = new(0, 1);
    private readonly SemaphoreSlim _sessionGate = new(1, 1);
    private readonly Dictionary<GlobalSystemMediaTransportControlsSession, string> _sessions = new();
    private string? _selectedSessionId;
    private string _artTrackKey = "";
    private string _artwork = "";
    private volatile bool _artDirty = true;
    public MediaFrame Current => Volatile.Read(ref _current);
    public event Action? FrameChanged;

    public async Task ControlAsync(MediaControl control, CancellationToken cancellation)
    {
        MediaControlExecutor.Validate(control);
        await _sessionGate.WaitAsync(cancellation);
        try
        {
            var selected = _sessions.FirstOrDefault(pair => pair.Value == _selectedSessionId).Key;
            if (selected is null || _selectedSessionId != control.SessionId)
                throw new MediaControlException(409, "The media changed. Try again.");
            // Re-read metadata before checking the track key: live packets may be out of date.
            var candidate = new MediaCandidate(control.SessionId, selected.SourceAppUserModelId, State(selected.GetPlaybackInfo()));
            await CaptureAsync(selected, candidate, cancellation);
            var timeline = selected.GetTimelineProperties();
            await MediaControlExecutor.ExecuteAsync(control, Current, timeline.StartTime.Ticks,
                (action, ticks, token) => action switch
                {
                    "play" => selected.TryPlayAsync().AsTask(token),
                    "pause" => selected.TryPauseAsync().AsTask(token),
                    "previous" => selected.TrySkipPreviousAsync().AsTask(token),
                    "next" => selected.TrySkipNextAsync().AsTask(token),
                    "seek" => selected.TryChangePlaybackPositionAsync(ticks!.Value).AsTask(token),
                    _ => Task.FromResult(false)
                }, cancellation);
            await CaptureAsync(selected, candidate, cancellation);
        }
        finally { _sessionGate.Release(); Signal(); }
    }

    private void Signal()
    {
        try { _wake.Release(); } catch (SemaphoreFullException) { }
    }

    private void ManagerChanged(GlobalSystemMediaTransportControlsSessionManager sender, object args) => Signal();
    private void SessionChanged(GlobalSystemMediaTransportControlsSession sender, object args) => Signal();
    private void PropertiesChanged(GlobalSystemMediaTransportControlsSession sender, object args)
    {
        _artDirty = true;
        Signal();
    }

    private void Unsubscribe(GlobalSystemMediaTransportControlsSession session)
    {
        session.PlaybackInfoChanged -= SessionChanged;
        session.TimelinePropertiesChanged -= SessionChanged;
        session.MediaPropertiesChanged -= PropertiesChanged;
    }

    private void ReconcileSessions(IReadOnlyList<GlobalSystemMediaTransportControlsSession> available)
    {
        foreach (var removed in _sessions.Keys.Where(session => !available.Contains(session)).ToArray())
        {
            Unsubscribe(removed);
            _sessions.Remove(removed);
        }
        foreach (var session in available)
        {
            if (_sessions.ContainsKey(session)) continue;
            _sessions[session] = Guid.NewGuid().ToString("N");
            session.PlaybackInfoChanged += SessionChanged;
            session.TimelinePropertiesChanged += SessionChanged;
            session.MediaPropertiesChanged += PropertiesChanged;
        }
    }

    private static string State(GlobalSystemMediaTransportControlsSessionPlaybackInfo playback) => playback.PlaybackStatus switch
    {
        GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing => "playing",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused => "paused",
        _ => "stopped"
    };

    private void Publish(MediaFrame frame)
    {
        Volatile.Write(ref _current, frame);
        FrameChanged?.Invoke();
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        GlobalSystemMediaTransportControlsSessionManager? manager = null;
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await _sessionGate.WaitAsync(stoppingToken);
                try
                {
                    if (manager is null)
                    {
                        manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
                        manager.SessionsChanged += ManagerChanged;
                        manager.CurrentSessionChanged += ManagerChanged;
                    }
                    var available = manager.GetSessions();
                    ReconcileSessions(available);
                    var candidates = new List<MediaCandidate>();
                    foreach (var session in available)
                    {
                        try { candidates.Add(new(_sessions[session], session.SourceAppUserModelId, State(session.GetPlaybackInfo()))); }
                        catch { /* A closed/broken player must not hide other sessions. */ }
                    }
                    var windowsSession = manager.GetCurrentSession();
                    var windowsId = windowsSession is not null && _sessions.TryGetValue(windowsSession, out var id) ? id : null;
                    _selectedSessionId = MediaSelection.Select(candidates, _selectedSessionId, windowsId);
                    var selected = _sessions.FirstOrDefault(pair => pair.Value == _selectedSessionId).Key;
                    if (selected is null)
                        Publish(new("stopped", "", "", "", "", null, null));
                    else
                        await CaptureAsync(selected, candidates.First(candidate => candidate.SessionId == _selectedSessionId), stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch
                {
                    if (manager is not null)
                    {
                        manager.SessionsChanged -= ManagerChanged;
                        manager.CurrentSessionChanged -= ManagerChanged;
                    }
                    manager = null;
                    foreach (var session in _sessions.Keys) Unsubscribe(session);
                    _sessions.Clear();
                    _selectedSessionId = null;
                    Publish(new("stopped", "", "", "", "", null, null, false));
                }
                finally { _sessionGate.Release(); }
                await _wake.WaitAsync(TimeSpan.FromSeconds(1), stoppingToken);
            }
        }
        finally
        {
            if (manager is not null)
            {
                manager.SessionsChanged -= ManagerChanged;
                manager.CurrentSessionChanged -= ManagerChanged;
            }
            foreach (var session in _sessions.Keys) Unsubscribe(session);
        }
    }

    private async Task CaptureAsync(GlobalSystemMediaTransportControlsSession session, MediaCandidate candidate, CancellationToken cancellation)
    {
        try
        {
            var properties = await session.TryGetMediaPropertiesAsync().AsTask(cancellation);
            var playback = session.GetPlaybackInfo();
            var timeline = session.GetTimelineProperties();
            var state = State(playback);
            var duration = (timeline.EndTime - timeline.StartTime).TotalSeconds;
            double? total = duration > 0 && double.IsFinite(duration) ? duration : null;
            var rate = playback.PlaybackRate ?? 1;
            if (!double.IsFinite(rate) || rate <= 0) rate = 1;
            var title = properties.Title ?? "";
            var artist = properties.Artist ?? "";
            var album = properties.AlbumTitle ?? "";
            var signature = string.Join('\n', candidate.SessionId, title, artist, album, total is null ? "" : Math.Round(total.Value).ToString(System.Globalization.CultureInfo.InvariantCulture));
            var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(signature)));
            if (_artTrackKey != key || _artDirty)
            {
                _artDirty = false;
                try { _artwork = await ReadArtworkAsync(properties.Thumbnail, cancellation); }
                catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
                catch { _artwork = ""; }
                _artTrackKey = key;
            }
            // Artwork reads are asynchronous: discard a frame if the song changed meanwhile.
            var confirmed = await session.TryGetMediaPropertiesAsync().AsTask(cancellation);
            if (confirmed.Title != properties.Title || confirmed.Artist != properties.Artist || confirmed.AlbumTitle != properties.AlbumTitle)
            {
                Publish(new(state, "", "", "", "", null, null, SessionId: candidate.SessionId, SourceAppId: candidate.SourceAppId));
                Signal();
                return;
            }
            var capturedAt = DateTimeOffset.UtcNow;
            var position = MediaTiming.Position(timeline.Position.TotalSeconds, timeline.StartTime.TotalSeconds,
                total, timeline.LastUpdatedTime, capturedAt, state == "playing", rate);
            var type = properties.PlaybackType?.ToString().ToLowerInvariant() ?? "unknown";
            var controls = playback.Controls;
            var seekMin = Math.Max(0, (timeline.MinSeekTime - timeline.StartTime).TotalSeconds);
            var seekMax = total is double length ? Math.Min(length, (timeline.MaxSeekTime - timeline.StartTime).TotalSeconds) : 0;
            var canSeek = controls.IsPlaybackPositionEnabled && total is > 0 && seekMax > seekMin;
            var capabilities = new MediaCapabilities(controls.IsPlayEnabled, controls.IsPauseEnabled,
                controls.IsPreviousEnabled, controls.IsNextEnabled, canSeek);
            Publish(new(state, title, artist, album, _artwork, position, total, true, key,
                candidate.SessionId, candidate.SourceAppId, type, capturedAt.ToUnixTimeMilliseconds(), rate,
                capabilities, canSeek ? seekMin : null, canSeek ? seekMax : null));
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
        catch
        {
            // Keep a playing Spotify session selected even when its metadata isn't ready.
            Publish(new(candidate.State, "", "", "", "", null, null,
                SessionId: candidate.SessionId, SourceAppId: candidate.SourceAppId));
        }
    }

    private static async Task<string> ReadArtworkAsync(IRandomAccessStreamReference? reference, CancellationToken cancellation)
    {
        if (reference is null) return "";
        using var stream = await reference.OpenReadAsync().AsTask(cancellation);
        if (stream.Size is 0 or > 2_000_000) return "";
        using var reader = new DataReader(stream);
        var size = (uint)stream.Size;
        await reader.LoadAsync(size).AsTask(cancellation);
        var bytes = new byte[size];
        reader.ReadBytes(bytes);
        var mime = stream.ContentType;
        if (mime is not ("image/png" or "image/jpeg" or "image/webp" or "image/gif")) mime = "image/jpeg";
        return $"data:{mime};base64,{Convert.ToBase64String(bytes)}";
    }
}
