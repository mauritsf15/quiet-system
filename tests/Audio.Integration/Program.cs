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

int Band(double frequency) => (int)(Math.Log(frequency / 35) / Math.Log(16000d / 35) * AudioSpectrum.BarCount);
int Strongest(float[] levels) => Array.IndexOf(levels, levels.Max());
var floatFormat = WaveFormat.CreateIeeeFloatWaveFormat(48000, 2);
float[] Analyze(params (double Frequency, double Amplitude)[] tones) =>
    new AudioSpectrum(floatFormat).Push(AudioFixtures.Tones(floatFormat, tones), AudioSpectrum.FftSize * floatFormat.BlockAlign)!;

foreach (var frequency in new[] { 70d, 880d, 8000d })
{
    var levels = Analyze((frequency, .25));
    Require(levels.Length == 48 && Strongest(levels) == Band(frequency), $"{frequency} Hz peaks in its fixed frequency band");
    Require(levels.All(value => float.IsFinite(value) && value is >= 0 and <= 1), "Frequency levels stay finite and normalized");
}
var combined = Analyze((70, .25), (880, .25), (8000, .25));
Require(new[] { 70d, 880d, 8000d }.All(frequency => combined[Band(frequency)] > .7), "Combined tones keep bass, midrange, and treble peaks simultaneously");
var loud = Analyze((880, .5));
var quiet = Analyze((880, .25));
Require(Math.Abs(loud[Band(880)] - quiet[Band(880)] - 6.0206 / 66) < .001, "Halving amplitude reduces the shared decibel scale by 6 dB");
Require(quiet.Take(Band(880) - 8).All(value => value == 0), "A midrange tone adds no artificial descending bass ramp");
Require(Analyze().All(value => value == 0), "Silent audio produces exactly zero in every band");
Require(Analyze((880, .0001)).All(value => value == 0), "Signals below the shared display floor stay at zero");

var streaming = new AudioSpectrum(floatFormat);
var toneBuffer = AudioFixtures.Tones(floatFormat, [(880, .25)]);
float[]? chunked = null;
for (var offset = 0; offset < toneBuffer.Length; offset += 256 * floatFormat.BlockAlign)
{
    var chunk = toneBuffer.AsSpan(offset, 256 * floatFormat.BlockAlign).ToArray();
    chunked = streaming.Push(chunk, chunk.Length) ?? chunked;
    if (offset + chunk.Length < toneBuffer.Length) Require(chunked is null, "Short callbacks accumulate until one complete FFT window is available");
}
Require(chunked is not null && chunked.Zip(quiet).All(pair => Math.Abs(pair.First - pair.Second) < .0001), "Splitting audio into callbacks does not change its measured spectrum");
var silence = new byte[toneBuffer.Length];
Require(streaming.Push(silence, silence.Length)!.All(value => value == 0), "A full silent window clears the previous tone");
var reversed = new AudioSpectrum(floatFormat).Push(AudioFixtures.Tones(floatFormat, [(880, .25)], invertRight: true), toneBuffer.Length)!;
Require(reversed.Zip(quiet).All(pair => Math.Abs(pair.First - pair.Second) < .0001), "Opposite-phase stereo retains energy instead of cancelling it");
foreach (var rate in new[] { 44100, 96000 })
{
    var format = WaveFormat.CreateIeeeFloatWaveFormat(rate, 2);
    var buffer = AudioFixtures.Tones(format, [(880, .25)]);
    Require(Strongest(new AudioSpectrum(format).Push(buffer, buffer.Length)!) == Band(880), $"Frequency positions remain correct at {rate} Hz sample rate");
}
foreach (var bits in new[] { 16, 24, 32 })
{
    var format = new WaveFormat(48000, bits, 2);
    var buffer = AudioFixtures.Tones(format, [(880, .25)]);
    var measured = new AudioSpectrum(format).Push(buffer, buffer.Length)!;
    Require(Strongest(measured) == Band(880) && Math.Abs(measured[Band(880)] - quiet[Band(880)]) < .001, $"{bits}-bit PCM is decoded at the same level as floating-point audio");
}

var factory = new TestFactory();
using var source = new AudioSource(factory, TimeSpan.FromMilliseconds(20));
await source.StartAsync(CancellationToken.None);
await Until(() => source.Available && factory.Latest?.Starts == 1);
var speakers = factory.Latest!;
Require(speakers.DeviceId == "speakers" && speakers.Starts == 1, "Captures the current default output");
speakers.EmitTone();
Require(source.Current.Any(level => level > 0), "Captured audio drives the visualizer");
await Task.Delay(300);
Require(source.Available && source.Current.All(level => level == 0), "A healthy capture with no new audio reports silence instead of stale peaks");
speakers.EmitTone();
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
Console.WriteLine($"{checks} audio analysis and recovery checks passed.");

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
        var buffer = AudioFixtures.Tones(_format, [(440, .5)]);
        DataAvailable?.Invoke(this, new WaveInEventArgs(buffer, buffer.Length));
    }
}

static class AudioFixtures
{
    internal static byte[] Tones(WaveFormat format, (double Frequency, double Amplitude)[] tones, bool invertRight = false)
    {
        var buffer = new byte[AudioSpectrum.FftSize * format.BlockAlign];
        for (var frame = 0; frame < AudioSpectrum.FftSize; frame++)
        {
            var sample = tones.Sum(tone => tone.Amplitude * Math.Sin(2 * Math.PI * tone.Frequency * frame / format.SampleRate));
            for (var channel = 0; channel < format.Channels; channel++)
            {
                var value = sample * (invertRight && channel == 1 ? -1 : 1);
                var offset = frame * format.BlockAlign + channel * (format.BitsPerSample / 8);
                if (format.Encoding == WaveFormatEncoding.IeeeFloat) BitConverter.GetBytes((float)value).CopyTo(buffer, offset);
                else
                {
                    var integer = (int)(value * Math.Pow(2, format.BitsPerSample - 1));
                    for (var index = 0; index < format.BitsPerSample / 8; index++) buffer[offset + index] = (byte)(integer >> (index * 8));
                }
            }
        }
        return buffer;
    }
}
