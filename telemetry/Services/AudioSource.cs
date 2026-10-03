using Microsoft.Extensions.Hosting;
using NAudio.CoreAudioApi;
using NAudio.Dsp;
using NAudio.Wave;

namespace QuietSystem.Telemetry.Services;

public sealed class AudioSource : BackgroundService
{
    private const int BarCount = 48;
    private const int FftSize = 2048;
    private static readonly float[] SilentLevels = new float[BarCount];
    private readonly IAudioCaptureFactory _factory;
    private readonly TimeSpan _retryInterval;
    private readonly object _captureGate = new();
    private readonly object _stateGate = new();
    private IWaveIn? _capture;
    private string? _deviceId;
    private float[] _levels = new float[BarCount];
    private long _lastDataTicks;
    private int _available;
    private bool _disposed;
    public bool Available => Volatile.Read(ref _available) != 0;

    public AudioSource() : this(new WasapiAudioCaptureFactory(), TimeSpan.FromSeconds(1)) { }

    internal AudioSource(IAudioCaptureFactory factory, TimeSpan retryInterval)
    {
        _factory = factory;
        _retryInterval = retryInterval;
    }

    public float[] Current
    {
        get
        {
            lock (_stateGate)
                return !Available || DateTime.UtcNow.Ticks - _lastDataTicks > TimeSpan.TicksPerSecond
                    ? SilentLevels : _levels;
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Audio discovery must not delay the local web host while a device is waking up.
        await Task.Yield();
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                lock (_captureGate)
                {
                    if (_disposed) break;
                    try
                    {
                        var deviceId = _factory.GetDefaultDeviceId();
                        if (_capture is null || !Available || deviceId != _deviceId)
                        {
                            ReleaseCapture();
                            var capture = _factory.CreateCapture(deviceId);
                            capture.DataAvailable += OnDataAvailable;
                            capture.RecordingStopped += OnRecordingStopped;
                            _deviceId = deviceId;
                            // A capture may report failure during StartRecording itself.
                            lock (_stateGate)
                            {
                                Volatile.Write(ref _capture, capture);
                                Volatile.Write(ref _available, 1);
                            }
                            capture.StartRecording();
                        }
                    }
                    catch { ReleaseCapture(); }
                }
                await Task.Delay(_retryInterval, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally { lock (_captureGate) ReleaseCapture(); }
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs args)
    {
        lock (_stateGate)
            if (ReferenceEquals(sender, _capture))
                Volatile.Write(ref _available, 0);
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs args)
    {
        var capture = Volatile.Read(ref _capture);
        if (capture is null || !ReferenceEquals(sender, capture) || !Available) return;
        var bits = capture.WaveFormat.BitsPerSample;
        if (bits is not (16 or 32)) return;
        var channels = capture.WaveFormat.Channels;
        var bytesPerSample = bits / 8;
        var frames = args.BytesRecorded / (bytesPerSample * channels);
        if (frames < 32) return;
        var fft = new Complex[FftSize];
        var start = Math.Max(0, frames - FftSize);
        var peakSample = 0f;
        for (var index = start; index < frames; index++)
        {
            float sample = 0;
            for (var channel = 0; channel < channels; channel++)
            {
                var offset = (index * channels + channel) * bytesPerSample;
                sample += bits == 32 ? BitConverter.ToSingle(args.Buffer, offset) : BitConverter.ToInt16(args.Buffer, offset) / 32768f;
            }
            if (!float.IsFinite(sample)) sample = 0;
            peakSample = Math.Max(peakSample, Math.Abs(sample / channels));
            var target = index - start;
            if (target >= FftSize) break;
            var window = 0.5f - 0.5f * MathF.Cos(2 * MathF.PI * target / (FftSize - 1));
            fft[target].X = sample / channels * window;
        }
        FastFourierTransform.FFT(true, 11, fft);
        var levels = new float[BarCount];
        var sampleRate = capture.WaveFormat.SampleRate;
        for (var bar = 0; bar < BarCount; bar++)
        {
            var low = 35 * Math.Pow(16000d / 35, (double)bar / BarCount);
            var high = 35 * Math.Pow(16000d / 35, (double)(bar + 1) / BarCount);
            var from = Math.Clamp((int)(low * FftSize / sampleRate), 1, FftSize / 2 - 1);
            var to = Math.Clamp((int)(high * FftSize / sampleRate), from + 1, FftSize / 2);
            var peak = 0f;
            for (var index = from; index < to; index++)
                peak = Math.Max(peak, MathF.Sqrt(fft[index].X * fft[index].X + fft[index].Y * fft[index].Y));
            var spectrum = Math.Clamp(MathF.Pow(peak * 8, .62f), 0, 1);
            var signal = Math.Clamp(peakSample * (1 - bar / 64f) * 2f, 0, 1);
            levels[bar] = Math.Max(spectrum, signal);
        }
        // A device may be replaced while its last data callback is finishing.
        lock (_stateGate)
        {
            if (!ReferenceEquals(capture, _capture) || !Available) return;
            _lastDataTicks = DateTime.UtcNow.Ticks;
            _levels = levels;
        }
    }

    private void ReleaseCapture()
    {
        IWaveIn? capture;
        lock (_stateGate)
        {
            capture = _capture;
            Volatile.Write(ref _capture, null);
            Volatile.Write(ref _available, 0);
            _lastDataTicks = 0;
            _levels = SilentLevels;
        }
        _deviceId = null;
        if (capture is null) return;
        capture.DataAvailable -= OnDataAvailable;
        capture.RecordingStopped -= OnRecordingStopped;
        // Native disposal waits for callbacks; never hold _stateGate while joining them.
        try { capture.StopRecording(); } catch { }
        try { capture.Dispose(); } catch { }
    }

    public override void Dispose()
    {
        base.Dispose();
        lock (_captureGate)
        {
            _disposed = true;
            ReleaseCapture();
        }
    }
}

internal interface IAudioCaptureFactory
{
    string GetDefaultDeviceId();
    IWaveIn CreateCapture(string deviceId);
}

internal sealed class WasapiAudioCaptureFactory : IAudioCaptureFactory
{
    public string GetDefaultDeviceId()
    {
        using var devices = new MMDeviceEnumerator();
        using var device = devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        return device.ID;
    }

    public IWaveIn CreateCapture(string deviceId)
    {
        using var devices = new MMDeviceEnumerator();
        using var device = devices.GetDevice(deviceId);
        return new WasapiLoopbackCapture(device);
    }
}
