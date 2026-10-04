using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using QuietSystem.Telemetry.Services;

var checks = 0;
void Require(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    checks++;
    Console.WriteLine("PASS " + name);
}

MediaCandidate Spotify(string state) => new("spotify", "Spotify.exe", state);
MediaCandidate Youtube(string state) => new("youtube", "chrome.exe", state);
Require(MediaSelection.Select([Spotify("playing"), Youtube("playing")], "youtube", "youtube") == "spotify", "Playing Spotify overrides Windows-current YouTube");
Require(MediaSelection.Select([Spotify("paused"), Youtube("playing")], "spotify", "spotify") == "youtube", "Paused Spotify yields to playing YouTube");
Require(MediaSelection.Select([Spotify("playing"), Youtube("playing")], "youtube", "youtube") == "spotify", "Resumed Spotify takes priority again");
Require(MediaSelection.Select([Spotify("paused"), Youtube("paused")], "youtube", "youtube") == "spotify", "Paused Spotify wins when no player is playing");
Require(MediaSelection.Select([Youtube("playing")], "spotify", "youtube") == "youtube", "Closing Spotify falls back to another player");
Require(MediaSelection.Select([Youtube("playing"), new("other", "vlc.exe", "playing")], "youtube", "other") == "youtube", "Equal-priority sessions remain stable");
Require(MediaSelection.Select([Youtube("playing"), new("other", "vlc.exe", "playing")], null, "other") == "other", "Initial fallback prefers Windows-current session");
Require(MediaSelection.Select([Spotify("stopped"), Youtube("stopped")], "spotify", "youtube") is null, "Stopped sessions produce no active media");
Require(MediaSelection.IsSpotify("SPOTIFY.EXE") && MediaSelection.IsSpotify("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify"), "Desktop and Store Spotify identifiers are recognized");
Require(!MediaSelection.IsSpotify("chrome.exe") && !MediaSelection.IsSpotify("NotSpotify.exe"), "Other players are not mistaken for Spotify");
Require(MediaSelection.Select([Spotify("playing")], "failed-session", "failed-session") == "spotify", "Unavailable candidate does not hide a valid session");

var now = DateTimeOffset.UtcNow;
Require(MediaTiming.Position(12, 2, 30, now.AddSeconds(-2), now, true, 1) == 12, "Windows timeline is relative to start and extrapolates its update time");
Require(MediaTiming.Position(12, 2, 30, now.AddSeconds(-2), now, false, 1) == 10, "Paused Windows timeline is frozen");
Require(MediaTiming.Position(29, 0, 30, now.AddSeconds(-2), now, true, 2) == 30, "Playback extrapolation is clamped to duration");
Require(MediaTiming.Position(3, 0, 30, DateTimeOffset.MinValue, now, true, 1) == 3, "Missing timeline timestamp does not jump to the end");
Require(MediaTiming.Position(double.NaN, 0, 30, now, now, true, 1) is null, "Invalid timeline values stay unavailable");

var parsed = TimedLyrics.Parse("[ar:Fixture Artist]\n[00:10.250][00:20.25] Repeated fixture\n[00:05.00] Intro fixture\n[00:15.00] \n[00:20.25] Repeated fixture\n[00:99.00] bad");
Require(parsed.Select(line => line.At).SequenceEqual(new double[] { 5, 10.25, 15, 20.25 }), "LRC sorts multiple timestamps, deduplicates, and rejects invalid seconds");
Require(parsed[2].Text == "", "LRC preserves instrumental blanks");
Require(TimedLyrics.Parse("Only untimed lyrics").Count == 0, "Plain lyrics do not invent timing");

MediaFrame Track(string title = "Fixture Song", string key = "one") => new("playing", title, "Fixture Artist", "Fixture Album", "", 7, 120,
    TrackKey: key, MediaType: "music", CapturedAt: now.ToUnixTimeMilliseconds());
object Record(string title = "Fixture Song", string artist = "Fixture Artist", string album = "Fixture Album", double? duration = 120, string? synced = "[00:05.00] Fixture current\n[00:10.00] Fixture upcoming\n[00:15.00] ", long id = 1) =>
    new { id, trackName = title, artistName = artist, albumName = album, duration, instrumental = false, syncedLyrics = synced };
HttpResponseMessage Json(object body) => new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };
HttpClient Http(FixtureHandler handler) => new(handler) { BaseAddress = new Uri("https://lrclib.invalid/api/") };

var exactHandler = new FixtureHandler((_, _) => Task.FromResult(Json(Record())));
var exactClient = new LyricsClient(Http(exactHandler));
var exactLines = await exactClient.GetAsync(Track(), CancellationToken.None);
Require(exactLines.Count == 3 && exactLines[0].Text == "Fixture current", "Exact lookup returns timed lines");
await exactClient.GetAsync(Track(key: "new-session"), CancellationToken.None);
Require(exactHandler.Requests.Count == 1, "Metadata cache is reusable across playback sessions");
Require(exactHandler.Requests[0].Query.Contains("duration=120") && exactHandler.Requests[0].Query.Contains("album_name=Fixture%20Album"), "Exact lookup includes album and duration");

var fallbackHandler = new FixtureHandler((request, _) => Task.FromResult(request.RequestUri!.AbsolutePath.EndsWith("/get")
    ? new HttpResponseMessage(HttpStatusCode.NotFound)
    : Json(new[] {
        Record(artist: "Wrong Artist", synced: "[00:01.00] Wrong artist"),
        Record(album: "Other Album", synced: "[00:01.00] Wrong album"),
        Record(duration: null, synced: "[00:01.00] Unknown duration", id: 2),
        Record(duration: 122, synced: "[00:01.00] Closest album match", id: 3),
        Record(duration: 150, synced: "[00:01.00] Longer version", id: 4),
    })));
var fallback = await new LyricsClient(Http(fallbackHandler)).GetAsync(Track(), CancellationToken.None);
Require(fallback[0].Text == "Closest album match" && fallbackHandler.Requests.Count == 2, "Fallback requires title/artist and ranks album then duration");

var unknownHandler = new FixtureHandler((request, _) => Task.FromResult(request.RequestUri!.AbsolutePath.EndsWith("/get")
    ? new HttpResponseMessage(HttpStatusCode.NotFound) : Json(new[] { Record(duration: null) })));
Require((await new LyricsClient(Http(unknownHandler)).GetAsync(Track(), CancellationToken.None)).Count == 3, "Fallback permits a missing recording duration");

var plainHandler = new FixtureHandler((request, _) => Task.FromResult(request.RequestUri!.AbsolutePath.EndsWith("/get")
    ? Json(Record(synced: null)) : Json(new[] { Record(synced: null) })));
var plainClient = new LyricsClient(Http(plainHandler));
Require((await plainClient.GetAsync(Track(), CancellationToken.None)).Count == 0, "Untimed-only results remain unavailable");
await plainClient.GetAsync(Track(), CancellationToken.None);
Require(plainHandler.Requests.Count == 2, "Missing timed lyrics are cached");

var limitedHandler = new FixtureHandler((_, _) => {
    var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
    response.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromSeconds(5));
    return Task.FromResult(response);
});
var limitedClient = new LyricsClient(Http(limitedHandler));
Require((await limitedClient.GetAsync(Track(), CancellationToken.None)).Count == 0 && limitedHandler.Requests.Count == 1, "Rate limit suppresses immediate fallback");
using (var timeout = new CancellationTokenSource(80))
{
    try { await limitedClient.GetAsync(Track("Another Fixture"), timeout.Token); throw new Exception("Cooldown not honored"); }
    catch (OperationCanceledException) { Require(limitedHandler.Requests.Count == 1, "Retry-After cooldown prevents another HTTP request"); }
}

var sourceMedia = new MediaSource();
var failedOnce = false;
var recoveryHandler = new FixtureHandler((_, _) => {
    if (!failedOnce) { failedOnce = true; return Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError)); }
    return Task.FromResult(Json(Record()));
});
var recoveryClient = new LyricsClient(Http(recoveryHandler));
Require((await recoveryClient.GetAsync(Track(), CancellationToken.None)).Count == 0 && recoveryHandler.Requests.Count == 1,
    "Provider errors do not trigger a fallback request");
Require((await recoveryClient.GetAsync(Track(), CancellationToken.None)).Count == 3,
    "Provider recovery is not blocked by a cached missing result");

var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
var raceHandler = new FixtureHandler(async (request, _) => {
    var first = request.RequestUri!.Query.Contains("Alpha");
    if (first) { started.TrySetResult(); await release.Task; }
    return Json(Record(title: first ? "Alpha" : "Beta", synced: "[00:01.00] " + (first ? "Stale alpha" : "Current beta")));
});
using var source = new LyricsSource(sourceMedia, new LyricsClient(Http(raceHandler)));
sourceMedia.Set(Track("Alpha", "spotify:alpha"));
await source.StartAsync(CancellationToken.None);
await started.Task.WaitAsync(TimeSpan.FromSeconds(3));
sourceMedia.Set(Track("Beta", "other:beta"));
release.TrySetResult();
using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(4)))
{
    while (!source.Current.Available) await Task.Delay(10, timeout.Token);
}
Require(source.Current.TrackKey == "other:beta" && source.Current.Lines[0].Text == "Current beta", "Late lyrics from a previous player cannot replace the selected track");
sourceMedia.Set(Track("Beta", "other:beta") with { State = "paused" });
await Task.Delay(50);
Require(source.Current.Available, "Pausing retains the matched lyrics");
sourceMedia.Set(Track("Beta", "other:beta") with { MediaType = "video" });
await Task.Delay(50);
Require(!source.Current.Available, "Video sessions hide lyrics");
sourceMedia.Set(Track() with { State = "stopped" });
Require(!LyricsSource.CanLookup(sourceMedia.Current), "Stopped sessions do not trigger lyric lookups");
await source.StopAsync(CancellationToken.None);
await MediaControlChecks.RunAsync(Require);
Console.WriteLine($"{checks} media and lyrics checks passed.");

sealed class FixtureHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
{
    public List<Uri> Requests { get; } = new();
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation)
    {
        Requests.Add(request.RequestUri!);
        return respond(request, cancellation);
    }
}
