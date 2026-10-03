using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.FileProviders;
using Microsoft.AspNetCore.StaticFiles;
using System.Security.Cryptography;
using QuietSystem.Telemetry.Monitoring;
using QuietSystem.Telemetry.Networking;
using QuietSystem.Telemetry.Services;

// Verify the packaged runtime without starting services or opening terminal sessions.
if (args.Contains("--check-installation", StringComparer.Ordinal))
{
    var wallpaperAvailable = File.Exists(Path.Combine(AppContext.BaseDirectory, "wallpaper", "index.html"));
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new
    {
        runtime = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
        architecture = System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture.ToString(),
        wallpaperAvailable
    }));
    Environment.ExitCode = wallpaperAvailable ? 0 : 1;
    return;
}

using var instanceMutex = new Mutex(true, @"Local\QuietSystem.Telemetry", out var isFirstInstance);
if (!isFirstInstance) return;

var builder = WebApplication.CreateSlimBuilder(args);
builder.Logging.ClearProviders();
builder.Services.AddSingleton<TelemetrySnapshotStore>();
builder.Services.AddSingleton<HardwareTelemetryCollector>();
builder.Services.AddHostedService<TelemetryWorker>();
builder.Services.AddSingleton<MediaSource>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<MediaSource>());
builder.Services.AddSingleton(new HttpClient
{
    BaseAddress = new Uri("https://lrclib.net/api/"),
    Timeout = TimeSpan.FromSeconds(10),
    MaxResponseContentBufferSize = 2_000_000,
    DefaultRequestHeaders = { { "User-Agent", "QuietSystem/1.0 (Wallpaper Engine companion; https://openai.com/codex/)" } }
});
builder.Services.AddSingleton<LyricsClient>();
builder.Services.AddSingleton<LyricsSource>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<LyricsSource>());
builder.Services.AddSingleton<AudioSource>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<AudioSource>());

var app = builder.Build();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
// Keep Wallpaper Engine's embedded browser from mixing old UI code with a new companion.
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/wallpaper"))
        context.Response.Headers.CacheControl = "no-store";
    await next(context);
});
var wallpaperRoot = Path.Combine(AppContext.BaseDirectory, "wallpaper");
if (!Directory.Exists(wallpaperRoot))
    wallpaperRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "wallpaper"));
if (Directory.Exists(wallpaperRoot))
{
    var files = new PhysicalFileProvider(wallpaperRoot);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files, RequestPath = "/wallpaper" });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = files, RequestPath = "/wallpaper", ContentTypeProvider = new FileExtensionContentTypeProvider() });
}
app.MapGet("/wallpaper", () => Directory.Exists(wallpaperRoot)
    ? Results.File(Path.Combine(wallpaperRoot, "index.html"), "text/html")
    : Results.NotFound());
var commandToken = RandomNumberGenerator.GetHexString(32);
app.MapGet("/api/session", (HttpContext context) =>
{
    if (!CommandOriginPolicy.IsLocalHost(context.Request)) return Results.StatusCode(403);
    context.Response.Headers.CacheControl = "no-store";
    return Results.Json(new { token = commandToken });
});
app.Map("/commands", async context =>
{
    if (!CommandOriginPolicy.IsSocketAllowed(context.Request) ||
        context.Request.Query["token"] != commandToken || !context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }
    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    await CommandSocketSession.RunAsync(socket, context.RequestAborted);
});
app.Map("/live", async context =>
{
    if (!CommandOriginPolicy.IsSocketAllowed(context.Request) || !context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }
    using var socket = await context.WebSockets.AcceptWebSocketAsync();
    await LiveSocketSession.RunAsync(socket,
        context.RequestServices.GetRequiredService<MediaSource>(),
        context.RequestServices.GetRequiredService<LyricsSource>(),
        context.RequestServices.GetRequiredService<AudioSource>(), context.RequestAborted);
});

app.MapGet("/health", (TelemetrySnapshotStore snapshots, AudioSource audio) => Results.Json(new
{
    status = snapshots.HasSnapshot ? "ready" : "starting",
    endpoint = "ws://127.0.0.1:9876/",
    audio = new { audio.Available }
}));

app.Map("/", async context =>
{
    if (!OriginPolicy.IsAllowed(context.Request.Headers.Origin))
    {
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
    }

    if (!context.WebSockets.IsWebSocketRequest)
    {
        context.Response.StatusCode = StatusCodes.Status200OK;
        context.Response.ContentType = "text/html; charset=utf-8";
        context.Response.Headers.CacheControl = "no-store";
        await context.Response.WriteAsync("""
            <!doctype html>
            <html lang="en">
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <title>Quiet System Telemetry</title>
                <style>
                  :root { color-scheme: dark; font-family: "Cascadia Code", Consolas, monospace; }
                  body { display:grid; min-height:100vh; margin:0; place-items:center; background:#06080b; color:#dfe8ef; }
                  main { width:min(560px,80vw); padding:32px; border-left:2px solid #70beff; background:#0a0e13; }
                  small,p { color:#73808b; } strong { color:#70beff; } a { color:#9ed2ff; }
                </style>
              </head>
              <body>
                <main>
                  <small>QUIET SYSTEM / LOCAL COMPANION</small>
                  <h1>Telemetry service <strong>ready</strong></h1>
                  <p>Listening on <code>ws://127.0.0.1:9876/</code>.</p>
                  <p>The wallpaper interface is loaded locally by Wallpaper Engine. This page only confirms that its companion service is available.</p>
                  <a href="/health">View health response</a>
                </main>
              </body>
            </html>
            """);
        return;
    }

    var socket = await context.WebSockets.AcceptWebSocketAsync();
    await TelemetrySocketSession.RunAsync(socket, context.RequestServices.GetRequiredService<TelemetrySnapshotStore>(), context.RequestAborted);
});

try
{
    await app.RunAsync("http://127.0.0.1:9876");
}
catch (Exception exception)
{
    CrashLog.Write(exception);
}
