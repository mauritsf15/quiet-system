namespace QuietSystem.Telemetry.Networking;

internal static class OriginPolicy
{
    public static bool IsAllowed(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin) || origin.Equals("null", StringComparison.OrdinalIgnoreCase)) return true;
        if (origin.StartsWith("file://", StringComparison.OrdinalIgnoreCase)) return true;
        if (origin.StartsWith("wallpaper-engine", StringComparison.OrdinalIgnoreCase)) return true;
        return Uri.TryCreate(origin, UriKind.Absolute, out var uri) &&
               (uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || System.Net.IPAddress.TryParse(uri.Host, out var address) && System.Net.IPAddress.IsLoopback(address));
    }
}
