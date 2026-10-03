using Microsoft.Extensions.Hosting;
using NAudio.Dsp;
using NAudio.Wave;

namespace QuietSystem.Telemetry.Services;

public sealed class AudioSource : IHostedService, IDisposable
{
    private const int BarCount = 48;
    private const int FftSize = 2048;
    private WasapiLoopbackCapture? _capture;
    private float[] _levels = new float[BarCount];
    private DateTime _lastData = DateTime.MinValue;
    public bool Available { get; private set; }

    public float[] Current
    {
        get
        {
            var current = Volatile.Read(ref _levels);
            return DateTime.UtcNow - _lastData > TimeSpan.FromSeconds(1) ? new float[BarCount] : current;
        }
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            _capture = new WasapiLoopbackCapture();
            _capture.DataAvailable += OnDataAvailable;
            _capture.RecordingStopped += (_, _) => Available = false;
            _capture.StartRecording();
            Available = true;
        }
        catch { Dispose(); }
        return Task.CompletedTask;
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs args)
    {
        if (_capture is null) return;
        var bits = _capture.WaveFormat.BitsPerSample;
        if (bits is not (16 or 32)) return;
        var channels = _capture.WaveFormat.Channels;
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
        var sampleRate = _capture.WaveFormat.SampleRate;
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
        _lastData = DateTime.UtcNow;
        Volatile.Write(ref _levels, levels);
    }

    public Task StopAsync(CancellationToken cancellationToken) { Dispose(); return Task.CompletedTask; }
    public void Dispose()
    {
        Available = false;
        if (_capture is null) return;
        try { _capture.StopRecording(); } catch { }
        _capture.Dispose();
        _capture = null;
    }
}
