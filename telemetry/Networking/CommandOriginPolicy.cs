using Microsoft.AspNetCore.Http;

namespace QuietSystem.Telemetry.Networking;

internal static class CommandOriginPolicy
{
    private const string AllowedOrigin = "http://127.0.0.1:9876";

    public static bool IsLocalHost(HttpRequest request) =>
        request.Host.Host.Equals("127.0.0.1", StringComparison.Ordinal) &&
        request.Host.Port == 9876;

    public static bool IsSocketAllowed(HttpRequest request) =>
        IsLocalHost(request) &&
        request.Headers.Origin.ToString().Equals(AllowedOrigin, StringComparison.Ordinal);

    public static bool IsControlAllowed(HttpRequest request, string token) =>
        IsLocalHost(request) && request.Headers["X-Session-Token"] == token &&
        (request.Headers.Origin.Count == 0 || IsSocketAllowed(request));
}
