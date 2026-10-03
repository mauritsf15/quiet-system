using Microsoft.Extensions.Hosting;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace QuietSystem.Telemetry.Services;

public sealed class AudioSource : BackgroundService
{
    private const int BarCount = AudioSpectrum.BarCount;
    private static readonly float[] SilentLevels = new float[BarCount];
    private readonly IAudioCaptureFactory _factory;
    private readonly TimeSpan _retryInterval;
    private readonly object _captureGate = new();
    private readonly object _stateGate = new();
    private IWaveIn? _capture;
    private string? _deviceId;
    private float[] _levels = new float[BarCount];
    private AudioSpectrum? _spectrum;
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
                return !Available || DateTime.UtcNow.Ticks - _lastDataTicks > TimeSpan.TicksPerMillisecond * 250
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
        var format = capture.WaveFormat;
        // Device replacement clears the accumulator as well as published levels.
        lock (_stateGate)
        {
            if (!ReferenceEquals(capture, _capture) || !Available) return;
            _spectrum ??= new AudioSpectrum(format);
            if (!_spectrum.Supported || args.BytesRecorded <= 0) return;
            var levels = _spectrum.Push(args.Buffer, args.BytesRecorded);
            _lastDataTicks = DateTime.UtcNow.Ticks;
            if (levels is not null) _levels = levels;
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
            _spectrum = null;
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
