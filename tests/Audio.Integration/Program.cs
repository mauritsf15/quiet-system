using NAudio.Wave;
using QuietSystem.Telemetry.Services;

var checks = 0;
void Require(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    checks++;
    Console.WriteLine("PASS " + name);
}

async Task Until(Func<bool> condition)
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    while (!condition()) await Task.Delay(10, timeout.Token);
}

var factory = new TestFactory();
using var source = new AudioSource(factory, TimeSpan.FromMilliseconds(20));
await source.StartAsync(CancellationToken.None);
await Until(() => source.Available && factory.Latest?.Starts == 1);
var speakers = factory.Latest!;
Require(speakers.DeviceId == "speakers" && speakers.Starts == 1, "Captures the current default output");
speakers.EmitTone();
Require(source.Current.Any(level => level > 0), "Captured audio drives the visualizer");
await Task.Delay(100);
Require(ReferenceEquals(speakers, factory.Latest) && speakers.Starts == 1, "A healthy device keeps one capture session");

using var formatReadStarted = new ManualResetEventSlim();
using var finishFormatRead = new ManualResetEventSlim();
speakers.BeforeFormatRead = () => { formatReadStarted.Set(); finishFormatRead.Wait(); };
var oldCallback = Task.Run(speakers.EmitTone);
await Until(() => formatReadStarted.IsSet);
factory.DefaultId = "headphones";
await Until(() => factory.Latest?.DeviceId == "headphones" && source.Available);
var headphones = factory.Latest!;
finishFormatRead.Set();
await oldCallback;
Require(speakers.Disposed && speakers.Stops == 1, "Changing the default output releases the previous device");
Require(source.Current.All(level => level == 0), "An in-flight old-device callback cannot restore cleared audio levels");
headphones.EmitTone();
Require(source.Current.Any(level => level > 0), "The new output drives the visualizer");
speakers.EmitLateStopped();
Require(source.Available, "A late stop event from the old device cannot disable the new capture");

headphones.Fail();
Require(!source.Available && source.Current.All(level => level == 0), "A stopped capture immediately reports unavailable silence");
await Until(() => source.Available && factory.Latest != headphones);
Require(headphones.Disposed && factory.Latest!.DeviceId == "headphones", "Device failure restarts capture without restarting the companion");

factory.DefaultId = null;
await Until(() => !source.Available);
var attempts = factory.Created;
await Task.Delay(100);
Require(factory.Created == attempts && source.Current.All(level => level == 0), "No output device stays quiet without creating capture sessions");
factory.StartFailures = 1;
factory.DefaultId = "returned-speakers";
await Until(() => source.Available && factory.Latest?.DeviceId == "returned-speakers"
    && factory.Latest != factory.FailedCapture && factory.Latest.Starts == 1);
Require(factory.FailedCapture?.Disposed == true, "Startup failure disposes the failed capture before retrying");
Require(factory.Created >= attempts + 2, "Audio recovers when an output device becomes available again");

var active = factory.Latest!;
await source.StopAsync(CancellationToken.None);
attempts = factory.Created;
await Task.Delay(100);
Require(active.Disposed && !source.Available && factory.Created == attempts, "Stopping the service releases capture and ends recovery");
Console.WriteLine($"{checks} audio recovery checks passed.");

if (args.Contains("--device-check"))
{
    var nativeFactory = new WasapiAudioCaptureFactory();
    using var nativeCapture = nativeFactory.CreateCapture(nativeFactory.GetDefaultDeviceId());
    nativeCapture.StartRecording();
    await Task.Delay(150);
    nativeCapture.StopRecording();
    Console.WriteLine("PASS Native capture initializes after releasing device discovery handles");
}

sealed class TestFactory : IAudioCaptureFactory
{
    private string? _defaultId = "speakers";
    private TestCapture? _latest;
    private int _created;
    public string? DefaultId { get => Volatile.Read(ref _defaultId); set => Volatile.Write(ref _defaultId, value); }
    public TestCapture? Latest => Volatile.Read(ref _latest);
    public TestCapture? FailedCapture { get; private set; }
    public int Created => Volatile.Read(ref _created);
    public int StartFailures;
    public string GetDefaultDeviceId() => DefaultId ?? throw new InvalidOperationException("No output device");
    public IWaveIn CreateCapture(string deviceId)
    {
        var fail = Interlocked.Exchange(ref StartFailures, 0) > 0;
        var capture = new TestCapture(deviceId, fail);
        if (fail) FailedCapture = capture;
        Volatile.Write(ref _latest, capture);
        Interlocked.Increment(ref _created);
        return capture;
    }
}

sealed class TestCapture(string deviceId, bool failStart) : IWaveIn
{
    private EventHandler<StoppedEventArgs>? _stopped;
    private EventHandler<StoppedEventArgs>? _lateStopped;
    public string DeviceId { get; } = deviceId;
    public int Starts;
    public int Stops;
    public bool Disposed;
    private WaveFormat _format = WaveFormat.CreateIeeeFloatWaveFormat(48000, 2);
    public Action? BeforeFormatRead;
    public WaveFormat WaveFormat
    {
        get { Interlocked.Exchange(ref BeforeFormatRead, null)?.Invoke(); return _format; }
        set => _format = value;
    }
    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<StoppedEventArgs>? RecordingStopped
    {
        add { _stopped += value; _lateStopped = _stopped; }
        remove { _stopped -= value; }
    }
    public void StartRecording()
    {
        Starts++;
        if (failStart) throw new IOException("Device is waking up");
    }
    public void StopRecording() { Stops++; _stopped?.Invoke(this, new StoppedEventArgs()); }
    public void Dispose() => Disposed = true;
    public void Fail() => _stopped?.Invoke(this, new StoppedEventArgs(new IOException("Device reset")));
    public void EmitLateStopped() => _lateStopped?.Invoke(this, new StoppedEventArgs());
    public void EmitTone()
    {
        var buffer = new byte[2048 * 2 * sizeof(float)];
        for (var sample = 0; sample < 2048; sample++)
        {
            var value = .5f * MathF.Sin(2 * MathF.PI * 440 * sample / 48000);
            for (var channel = 0; channel < 2; channel++)
                BitConverter.GetBytes(value).CopyTo(buffer, (sample * 2 + channel) * sizeof(float));
        }
        DataAvailable?.Invoke(this, new WaveInEventArgs(buffer, buffer.Length));
    }
}
