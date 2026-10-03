using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace QuietSystem.Telemetry.Services;

public sealed record LyricLine(double At, string Text);
public sealed record LyricsFrame(string TrackKey, bool Available, IReadOnlyList<LyricLine> Lines);

public static class TimedLyrics
{
    private static readonly Regex Timestamp = new(@"\[(\d{1,3}):(\d{2}(?:\.\d{1,3})?)\]", RegexOptions.Compiled);

    public static IReadOnlyList<LyricLine> Parse(string? lrc)
    {
        if (string.IsNullOrWhiteSpace(lrc)) return Array.Empty<LyricLine>();
        var result = new List<LyricLine>();
        foreach (var raw in lrc.Split('\n'))
        {
            var line = raw.Trim();
            var tags = Timestamp.Matches(line);
            if (tags.Count == 0 || tags[0].Index != 0) continue;
            // LRC permits several leading timestamps for repeated verses.
            var end = 0;
            foreach (Match tag in tags)
            {
                if (tag.Index != end) break;
                end = tag.Index + tag.Length;
            }
            var text = line[end..].Trim();
            foreach (Match tag in tags)
            {
                if (tag.Index >= end) break;
                var minutes = double.Parse(tag.Groups[1].Value, CultureInfo.InvariantCulture);
                var seconds = double.Parse(tag.Groups[2].Value, CultureInfo.InvariantCulture);
                if (seconds < 60) result.Add(new(minutes * 60 + seconds, text));
            }
        }
        return result.GroupBy(line => line.At).OrderBy(group => group.Key)
            .Select(group => new LyricLine(group.Key, string.Join(" / ", group.Select(line => line.Text).Where(text => text.Length > 0).Distinct())))
            .ToArray();
    }
}

public sealed class LyricsClient(HttpClient http, TimeProvider? clock = null)
{
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;
    private readonly SemaphoreSlim _requests = new(1, 1);
    private readonly Dictionary<string, (DateTimeOffset Expires, IReadOnlyList<LyricLine> Lines)> _cache = new();
    private DateTimeOffset _nextRequest;
    private bool _requestFailed;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private sealed record LyricsRecord(long Id, string? TrackName, string? ArtistName,
        string? AlbumName, double? Duration, bool Instrumental, string? SyncedLyrics);

    private static string Normalize(string? text) => Regex.Replace((text ?? "").Normalize().Trim(), @"\s+", " ").ToUpperInvariant();
    private static bool Matches(LyricsRecord record, MediaFrame media) => !record.Instrumental
        && Normalize(record.TrackName) == Normalize(media.Title)
        && Normalize(record.ArtistName) == Normalize(media.Artist);

    private static string CacheKey(MediaFrame media) => string.Join('\n', Normalize(media.Title), Normalize(media.Artist), Normalize(media.Album),
        media.Duration is null ? "" : Math.Round(media.Duration.Value).ToString(CultureInfo.InvariantCulture));

    private async Task<JsonDocument?> RequestAsync(string relative, CancellationToken cancellation)
    {
        _requestFailed = false;
        var wait = _nextRequest - _clock.GetUtcNow();
        if (wait > TimeSpan.Zero) await Task.Delay(wait, _clock, cancellation);
        using var response = await http.GetAsync(relative, cancellation);
        _nextRequest = _clock.GetUtcNow().AddMilliseconds(300);
        if (response.StatusCode is HttpStatusCode.TooManyRequests or HttpStatusCode.ServiceUnavailable)
        {
            _requestFailed = true;
            var retry = response.Headers.RetryAfter?.Date
                ?? _clock.GetUtcNow().Add(response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(30));
            if (retry > _nextRequest) _nextRequest = retry;
            return null;
        }
        if (!response.IsSuccessStatusCode)
        {
            _requestFailed = response.StatusCode != HttpStatusCode.NotFound;
            return null;
        }
        if (response.Content.Headers.ContentLength > 2_000_000) { _requestFailed = true; return null; }
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellation));
    }

    public async Task<IReadOnlyList<LyricLine>> GetAsync(MediaFrame media, CancellationToken cancellation)
    {
        await _requests.WaitAsync(cancellation);
        try
        {
            var key = CacheKey(media);
            if (_cache.TryGetValue(key, out var cached) && cached.Expires > _clock.GetUtcNow()) return cached.Lines;
            var signature = $"track_name={Uri.EscapeDataString(media.Title)}&artist_name={Uri.EscapeDataString(media.Artist)}";
            var exact = signature;
            if (!string.IsNullOrWhiteSpace(media.Album)) exact += $"&album_name={Uri.EscapeDataString(media.Album)}";
            if (media.Duration is > 0 and <= 3600) exact += $"&duration={media.Duration.Value.ToString(CultureInfo.InvariantCulture)}";
            IReadOnlyList<LyricLine> lines = Array.Empty<LyricLine>();
            using (var result = await RequestAsync("get?" + exact, cancellation))
            {
                if (result?.RootElement.ValueKind == JsonValueKind.Object)
                {
                    var record = result.RootElement.Deserialize<LyricsRecord>(JsonOptions);
                    if (record is not null && Matches(record, media)) lines = TimedLyrics.Parse(record.SyncedLyrics);
                }
            }
            if (_requestFailed) return Array.Empty<LyricLine>();
            if (!lines.Any(line => line.Text.Length > 0))
            {
                // Respect server cooldowns rather than immediately issuing a fallback request.
                if (_nextRequest - _clock.GetUtcNow() > TimeSpan.FromSeconds(1)) return Array.Empty<LyricLine>();
                using var result = await RequestAsync("search?" + signature, cancellation);
                if (result?.RootElement.ValueKind == JsonValueKind.Array)
                {
                    var matches = result.RootElement.Deserialize<LyricsRecord[]>(JsonOptions) ?? Array.Empty<LyricsRecord>();
                    lines = matches.Where(record => Matches(record, media))
                        .Select(record => new { Record = record, Lines = TimedLyrics.Parse(record.SyncedLyrics) })
                        .Where(match => match.Lines.Any(line => line.Text.Length > 0))
                        .OrderByDescending(match => Normalize(match.Record.AlbumName) == Normalize(media.Album))
                        .ThenBy(match => media.Duration is null || match.Record.Duration is null
                            ? double.MaxValue : Math.Abs(match.Record.Duration.Value - media.Duration.Value))
                        .ThenByDescending(match => match.Record.Id)
                        .Select(match => match.Lines).FirstOrDefault() ?? Array.Empty<LyricLine>();
                }
            }
            // Transient provider failures are retried by the worker, not cached as missing lyrics.
            if (_requestFailed) return Array.Empty<LyricLine>();
            if (_cache.Count >= 128) _cache.Remove(_cache.Keys.First());
            _cache[key] = (_clock.GetUtcNow().Add(lines.Count > 0 ? TimeSpan.FromHours(12) : TimeSpan.FromMinutes(10)), lines);
            return lines;
        }
        finally { _requests.Release(); }
    }
}
