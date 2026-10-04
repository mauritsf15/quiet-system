using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using QuietSystem.Telemetry.Networking;
using QuietSystem.Telemetry.Services;

static class MediaControlChecks
{
    public static async Task RunAsync(Action<bool, string> require)
    {
        var frame = new MediaFrame("paused", "Song", "Artist", "Album", "", 12, 120,
            SessionId: "session", TrackKey: "track", Capabilities: new(true, true, true, true, true), SeekMin: 5, SeekMax: 115);
        MediaControl Control(string action = "play", double? position = null) => new("session", "track", action, position);
        var dispatched = new List<(string Action, long? Ticks)>();
        Task<bool> Dispatch(string action, long? ticks, CancellationToken token) { dispatched.Add((action, ticks)); return Task.FromResult(true); }
        async Task Reject(MediaControl control, MediaFrame current, int expected, string name)
        {
            var before = dispatched.Count;
            try { await MediaControlExecutor.ExecuteAsync(control, current, 0, Dispatch, CancellationToken.None); throw new Exception(name); }
            catch (MediaControlException error) { require(error.StatusCode == expected && dispatched.Count == before, name); }
        }
        foreach (var action in new[] { "play", "pause", "previous", "next" })
        {
            await MediaControlExecutor.ExecuteAsync(Control(action), frame, 0, Dispatch, CancellationToken.None);
            require(dispatched[^1] == (action, null), action + " dispatches to the selected session");
        }
        foreach (var (target, expected) in new[] { (0d, 5d), (20.25, 20.25), (150d, 115d) })
        {
            await MediaControlExecutor.ExecuteAsync(Control("seek", target), frame, TimeSpan.FromSeconds(10).Ticks, Dispatch, CancellationToken.None);
            require(dispatched[^1].Ticks == TimeSpan.FromSeconds(10 + expected).Ticks, "Seek converts seconds to absolute ticks and respects bounds: " + target);
        }
        await Reject(Control() with { SessionId = "stale" }, frame, 409, "Stale session never dispatches");
        await Reject(Control() with { TrackKey = "old-track" }, frame, 409, "Stale track never dispatches");
        await Reject(Control(), frame with { Enabled = false }, 503, "Disconnected media never dispatches");
        await Reject(Control(), frame with { State = "stopped" }, 409, "Stopped media never dispatches");
        await Reject(Control(), frame with { Capabilities = null }, 409, "Missing capability flags default to disabled");
        await Reject(Control("seek", 20), frame with { SeekMax = null }, 409, "Missing seek range is rejected");
        await Reject(Control("seek", -1), frame, 400, "Negative seek rejected");
        await Reject(Control("seek", double.NaN), frame, 400, "Nonfinite seek rejected");
        await Reject(Control("seek"), frame, 400, "Seek requires a position");
        await Reject(Control("play", 10), frame, 400, "Position on a transport command rejected");
        await Reject(Control("unknown"), frame, 400, "Unknown command rejected");
        try
        {
            await MediaControlExecutor.ExecuteAsync(Control(), frame, 0, (_, _, _) => Task.FromResult(false), CancellationToken.None);
            throw new Exception("Player rejection accepted");
        }
        catch (MediaControlException error) { require(error.StatusCode == 409, "Player rejection is reported"); }
        using (var cancellation = new CancellationTokenSource())
        {
            cancellation.Cancel();
            var before = dispatched.Count;
            try { await MediaControlExecutor.ExecuteAsync(Control(), frame, 0, Dispatch, cancellation.Token); throw new Exception("Cancellation ignored"); }
            catch (OperationCanceledException) { require(before == dispatched.Count, "Cancelled command never dispatches"); }
        }

        var context = new DefaultHttpContext();
        context.Request.Host = new HostString("127.0.0.1", 9876);
        context.Request.Headers["X-Session-Token"] = "fixture-token";
        context.Request.Headers.Origin = "http://127.0.0.1:9876";
        require(CommandOriginPolicy.IsControlAllowed(context.Request, "fixture-token"), "Local origin and token authorize controls");
        require(!CommandOriginPolicy.IsControlAllowed(context.Request, "wrong-token"), "Wrong token rejected");
        context.Request.Headers.Origin = "https://example.invalid";
        require(!CommandOriginPolicy.IsControlAllowed(context.Request, "fixture-token"), "External origin rejected");
        context.Request.Headers.Remove("Origin");
        require(CommandOriginPolicy.IsControlAllowed(context.Request, "fixture-token"), "Token-authenticated local tools are allowed");
        context.Request.Host = new HostString("localhost", 9876);
        require(!CommandOriginPolicy.IsControlAllowed(context.Request, "fixture-token"), "Unexpected host rejected");

        var source = new MediaSource();
        source.Set(frame);
        source.ControlHandler = (control, token) => MediaControlExecutor.ExecuteAsync(control, source.Current, 0, Dispatch, token);
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        builder.Services.AddSingleton(source);
        await using var app = builder.Build();
        app.Urls.Add("http://127.0.0.1:0");
        MediaControlEndpoints.MapEndpoints(app, ctx => ctx.Request.Headers["X-Session-Token"] == "fixture-token");
        await app.StartAsync();
        using var client = new HttpClient { BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()) };
        using (var denied = await client.PostAsJsonAsync("/api/media/control", Control()))
            require(denied.StatusCode == HttpStatusCode.Forbidden, "HTTP endpoint requires authorization");
        client.DefaultRequestHeaders.Add("X-Session-Token", "fixture-token");
        using (var applied = await client.PostAsJsonAsync("/api/media/control", Control()))
            require(applied.IsSuccessStatusCode && (await applied.Content.ReadAsStringAsync()).Contains("\"applied\":true"), "HTTP endpoint confirms applied command");
        using (var invalid = await client.PostAsJsonAsync("/api/media/control", Control("seek")))
            require(invalid.StatusCode == HttpStatusCode.BadRequest, "HTTP endpoint reports invalid input");
        source.Set(frame with { TrackKey = "new-track" });
        using (var stale = await client.PostAsJsonAsync("/api/media/control", Control()))
            require(stale.StatusCode == HttpStatusCode.Conflict, "HTTP endpoint reports stale track");
        source.ControlHandler = (_, token) => Task.Delay(Timeout.Infinite, token);
        using (var timeout = await client.PostAsJsonAsync("/api/media/control", Control()))
            require(timeout.StatusCode == HttpStatusCode.GatewayTimeout, "HTTP commands time out after three seconds");
        source.ControlHandler = (_, _) => Task.FromException(new Exception("fixture failure"));
        using (var failure = await client.PostAsJsonAsync("/api/media/control", Control()))
            require(failure.StatusCode == HttpStatusCode.ServiceUnavailable, "HTTP endpoint reports player failure");
        await app.StopAsync();
    }
}
