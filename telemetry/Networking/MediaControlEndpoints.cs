using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using QuietSystem.Telemetry.Services;

namespace QuietSystem.Telemetry.Networking;

public static class MediaControlEndpoints
{
    public static void MapEndpoints(WebApplication app, Func<HttpContext, bool> allowed)
    {
        app.MapPost("/api/media/control", async (HttpContext context, MediaSource media, MediaControl control) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            if (!allowed(context)) return Results.Json(new { error = "Media controls unavailable" }, statusCode: 403);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
            timeout.CancelAfter(TimeSpan.FromSeconds(3));
            try
            {
                await media.ControlAsync(control, timeout.Token);
                return Results.Json(new { applied = true });
            }
            catch (MediaControlException error) { return Results.Json(new { error = error.Message }, statusCode: error.StatusCode); }
            catch (OperationCanceledException) { return Results.Json(new { error = "The player took too long. Try again." }, statusCode: 504); }
            catch { return Results.Json(new { error = "Media controls unavailable. Try again." }, statusCode: 503); }
        });
    }
}
