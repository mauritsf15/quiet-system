using NAudio.Dsp;
using NAudio.Wave;

namespace QuietSystem.Telemetry.Services;

internal sealed class AudioSpectrum
{
    internal const int BarCount = 48;
    internal const int FftSize = 8192;
    private const int HopSize = 2048;
    private const float FloorDb = -66;
    private static readonly float[] Window = Enumerable.Range(0, FftSize)
        .Select(index => .5f - .5f * MathF.Cos(2 * MathF.PI * index / (FftSize - 1))).ToArray();
    // NAudio's forward FFT divides by N; restore the Hann window's coherent gain.
    private static readonly float AmplitudeScale = 2f * FftSize / Window.Sum();
    private readonly WaveFormat _format;
    private readonly bool _floatingPoint;
    private readonly int _bytesPerSample;
    private readonly float[][] _samples;
    private readonly Complex[] _fft = new Complex[FftSize];
    private readonly float[] _power = new float[FftSize / 2];
    private readonly int[] _bands = new int[FftSize / 2];
    private int _filled;

    internal AudioSpectrum(WaveFormat format)
    {
        _format = format is WaveFormatExtensible extensible ? extensible.ToStandardWaveFormat() : format;
        _floatingPoint = _format.Encoding == WaveFormatEncoding.IeeeFloat;
        var pcm = _format.Encoding == WaveFormatEncoding.Pcm;
        Supported = format.Channels > 0 && format.SampleRate > 0 &&
            (_floatingPoint && format.BitsPerSample == 32 || pcm && format.BitsPerSample is 16 or 24 or 32);
        _bytesPerSample = format.BitsPerSample / 8;
        Supported &= format.BlockAlign >= format.Channels * _bytesPerSample;
        _samples = Enumerable.Range(0, Supported ? format.Channels : 0).Select(_ => new float[FftSize]).ToArray();
        for (var index = 0; index < _bands.Length; index++)
        {
            var frequency = (double)index * format.SampleRate / FftSize;
            _bands[index] = frequency is >= 35 and < 16000
                ? (int)(Math.Log(frequency / 35) / Math.Log(16000d / 35) * BarCount) : -1;
        }
    }

    internal bool Supported { get; }

    internal float[]? Push(byte[] buffer, int bytesRecorded)
    {
        if (!Supported) return null;
        float[]? levels = null;
        var frames = Math.Min(bytesRecorded, buffer.Length) / _format.BlockAlign;
        for (var frame = 0; frame < frames; frame++)
        {
            for (var channel = 0; channel < _samples.Length; channel++)
            {
                var offset = frame * _format.BlockAlign + channel * _bytesPerSample;
                var sample = _floatingPoint ? BitConverter.ToSingle(buffer, offset) : _bytesPerSample switch
                {
                    2 => BitConverter.ToInt16(buffer, offset) / 32768f,
                    3 => ((buffer[offset] | buffer[offset + 1] << 8 | buffer[offset + 2] << 16) << 8 >> 8) / 8388608f,
                    4 => BitConverter.ToInt32(buffer, offset) / 2147483648f,
                    _ => 0,
                };
                _samples[channel][_filled] = float.IsFinite(sample) ? Math.Clamp(sample, -1, 1) : 0;
            }
            if (++_filled != FftSize) continue;
            levels = Analyze();
            foreach (var samples in _samples) Array.Copy(samples, HopSize, samples, 0, FftSize - HopSize);
            _filled -= HopSize;
        }
        return levels;
    }

    private float[] Analyze()
    {
        Array.Clear(_power);
        foreach (var samples in _samples)
        {
            for (var index = 0; index < FftSize; index++)
            {
                _fft[index].X = samples[index] * Window[index];
                _fft[index].Y = 0;
            }
            FastFourierTransform.FFT(true, 13, _fft);
            for (var index = 1; index < _power.Length; index++)
                _power[index] += _fft[index].X * _fft[index].X + _fft[index].Y * _fft[index].Y;
        }
        var peaks = new float[BarCount];
        for (var index = 1; index < _power.Length; index++)
        {
            var band = _bands[index];
            if (band < 0) continue;
            // Combine channel energy instead of averaging signed samples, which cancels opposite-phase stereo.
            var amplitude = MathF.Sqrt(_power[index] / _samples.Length) * AmplitudeScale;
            peaks[band] = Math.Max(peaks[band], amplitude);
        }
        return peaks.Select(amplitude => amplitude <= 0 ? 0 :
            Math.Clamp((20 * MathF.Log10(amplitude) - FloorDb) / -FloorDb, 0, 1)).ToArray();
    }
}
