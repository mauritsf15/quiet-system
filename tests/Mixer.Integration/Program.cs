using QuietSystem.Telemetry.Services;

using var mixer = new AudioMixer();
var frame = await mixer.ReadAsync();
if (!frame.Available) throw new Exception("No default audio output for live mixer check.");
if (frame.Volume is < 0 or > 1 || frame.Sessions.Any(session => session.Volume is < 0 or > 1))
    throw new Exception("Invalid volume snapshot.");
if (frame.Sessions.Select(session => session.Id).Distinct().Count() != frame.Sessions.Count)
    throw new Exception("Session identities are not unique.");
try
{
    await mixer.ControlAsync(new("stale-output", null, 0.5f, null));
    throw new Exception("Stale device accepted.");
}
catch (KeyNotFoundException) { }
try
{
    await mixer.ControlAsync(new(frame.DeviceId!, "stale-session", 0.5f, null));
    throw new Exception("Stale session accepted.");
}
catch (KeyNotFoundException) { }
await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => mixer.ReadAsync()));
Console.WriteLine($"Mixer checks passed: {frame.Sessions.Count} sessions; no volume changes made.");
