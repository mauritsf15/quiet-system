using System.Collections.Concurrent;
using System.Diagnostics;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace QuietSystem.Telemetry.Services;

public sealed record MixerSession(string Id, string Name, float Volume, bool Muted);
public sealed record MixerFrame(bool Available, string? DeviceId, string? DeviceName,
    float Volume, bool Muted, IReadOnlyList<MixerSession> Sessions);
public sealed record MixerControl(string DeviceId, string? SessionId, float? Volume, bool? Muted);

// All native discovery, controls and disposal run on the same MTA thread.
public sealed class AudioMixer : IDisposable
{
    private readonly BlockingCollection<Action> _work = new();
    private readonly Thread _thread;
    public AudioMixer()
    {
        _thread = new Thread(() => { foreach (var action in _work.GetConsumingEnumerable()) action(); })
            { IsBackground = true, Name = "Volume mixer" };
        _thread.SetApartmentState(ApartmentState.MTA);
        _thread.Start();
    }

    public Task<MixerFrame> ReadAsync() => Enqueue(() => Read(null));
    public Task<MixerFrame> ControlAsync(MixerControl control) => Enqueue(() => Read(control));

    private Task<MixerFrame> Enqueue(Func<MixerFrame> operation)
    {
        var completion = new TaskCompletionSource<MixerFrame>(TaskCreationOptions.RunContinuationsAsynchronously);
        _work.Add(() => { try { completion.SetResult(operation()); } catch (Exception error) { completion.SetException(error); } });
        return completion.Task;
    }

    private static MixerFrame Read(MixerControl? control)
    {
        using var enumerator = new MMDeviceEnumerator();
        MMDevice device;
        try { device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia); }
        catch when (control is null) { return new(false, null, null, 0, false, []); }
        using (device)
        {
            if (control is not null && control.DeviceId != device.ID)
                throw new KeyNotFoundException("The default output changed. Try again.");
            var endpoint = device.AudioEndpointVolume;
            if (control is { SessionId: null })
            {
                if (control.Volume is float volume) endpoint.MasterVolumeLevelScalar = volume;
                if (control.Muted is bool muted) endpoint.Mute = muted;
            }
            var sessions = new List<MixerSession>();
            var found = control?.SessionId is null;
            using var manager = device.AudioSessionManager;
            manager.RefreshSessions();
            for (var index = 0; index < manager.Sessions.Count; index++)
            {
                using var session = manager.Sessions[index];
                string? id = null;
                try
                {
                    if (session.State == AudioSessionState.AudioSessionStateExpired) continue;
                    id = session.GetSessionInstanceIdentifier;
                    if (control?.SessionId == id)
                    {
                        found = true;
                        if (control.Volume is float volume) session.SimpleAudioVolume.Volume = volume;
                        if (control.Muted is bool muted) session.SimpleAudioVolume.Mute = muted;
                    }
                    sessions.Add(new(id, Name(session), session.SimpleAudioVolume.Volume, session.SimpleAudioVolume.Mute));
                }
                catch when (control is null || control.SessionId != id) { /* Session ended during discovery. */ }
            }
            if (!found) throw new KeyNotFoundException("This audio session ended. Refreshing the mixer.");
            return new(true, device.ID, device.FriendlyName, endpoint.MasterVolumeLevelScalar, endpoint.Mute,
                sessions.OrderBy(session => session.Name, StringComparer.OrdinalIgnoreCase).ToArray());
        }
    }

    private static string Name(AudioSessionControl session)
    {
        if (session.IsSystemSoundsSession) return "System Sounds";
        var name = session.DisplayName;
        if (!string.IsNullOrWhiteSpace(name) && !name.StartsWith('@')) return name;
        try { using var process = Process.GetProcessById((int)session.GetProcessID); return process.ProcessName; }
        catch { return "Application"; }
    }

    public void Dispose() { _work.CompleteAdding(); _thread.Join(); _work.Dispose(); }
}
