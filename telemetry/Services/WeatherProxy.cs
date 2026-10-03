using System.Globalization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;

namespace QuietSystem.Telemetry.Services;

// Keep external weather traffic out of Wallpaper Engine's embedded browser.
internal static class WeatherProxy
{
    public static void MapEndpoints(WebApplication app)
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10), MaxResponseContentBufferSize = 1_000_000 };
        app.Lifetime.ApplicationStopped.Register(client.Dispose);

        app.MapGet("/api/weather/locations", (Func<HttpContext, Task<IResult>>)((HttpContext context) =>
        {
            var name = context.Request.Query["name"].ToString().Trim();
            if (name.Length is < 2 or > 120) return Task.FromResult<IResult>(Results.BadRequest());
            return Forward(context, client,
                "https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&name=" + Uri.EscapeDataString(name));
        }));

        app.MapGet("/api/weather/forecast", (Func<HttpContext, Task<IResult>>)((HttpContext context) =>
        {
            if (!Coordinate(context, "latitude", 90, out var latitude) ||
                !Coordinate(context, "longitude", 180, out var longitude))
                return Task.FromResult<IResult>(Results.BadRequest());
            return Forward(context, client,
                $"https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}&current=temperature_2m,weather_code&timezone=auto");
        }));
    }

    private static bool Coordinate(HttpContext context, string name, double limit, out string value)
    {
        value = "";
        if (!double.TryParse(context.Request.Query[name], NumberStyles.Float, CultureInfo.InvariantCulture, out var coordinate) ||
            !double.IsFinite(coordinate) || Math.Abs(coordinate) > limit) return false;
        value = Math.Round(coordinate, 3).ToString(CultureInfo.InvariantCulture);
        return true;
    }

    private static async Task<IResult> Forward(HttpContext context, HttpClient client, string url)
    {
        if (!Networking.CommandOriginPolicy.IsLocalHost(context.Request)) return Results.StatusCode(403);
        context.Response.Headers.CacheControl = "no-store";
        try
        {
            using var response = await client.GetAsync(url, context.RequestAborted);
            if (!response.IsSuccessStatusCode) return Results.StatusCode(502);
            var body = await response.Content.ReadAsStringAsync(context.RequestAborted);
            return Results.Content(body, "application/json");
        }
        catch (OperationCanceledException) { return Results.StatusCode(503); }
        catch (HttpRequestException) { return Results.StatusCode(502); }
    }
}
