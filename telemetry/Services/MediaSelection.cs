namespace QuietSystem.Telemetry.Services;

public sealed record MediaCandidate(string SessionId, string SourceAppId, string State);

public static class MediaSelection
{
    public static bool IsSpotify(string sourceAppId)
    {
        var name = sourceAppId.Replace('\\', '/').Split('/').Last();
        return name.Equals("Spotify.exe", StringComparison.OrdinalIgnoreCase)
            || name.Equals("Spotify", StringComparison.OrdinalIgnoreCase)
            || name.StartsWith("SpotifyAB.SpotifyMusic_", StringComparison.OrdinalIgnoreCase);
    }

    private static int Priority(MediaCandidate candidate) => candidate.State switch
    {
        "playing" => IsSpotify(candidate.SourceAppId) ? 0 : 1,
        "paused" => IsSpotify(candidate.SourceAppId) ? 2 : 3,
        _ => int.MaxValue
    };

    public static string? Select(IReadOnlyList<MediaCandidate> candidates,
        string? selectedSessionId, string? windowsCurrentSessionId)
    {
        var eligible = candidates.Where(candidate => Priority(candidate) != int.MaxValue).ToArray();
        if (eligible.Length == 0) return null;
        var priority = eligible.Min(Priority);
        var preferred = eligible.Where(candidate => Priority(candidate) == priority).ToArray();
        return preferred.FirstOrDefault(candidate => candidate.SessionId == selectedSessionId)?.SessionId
            ?? preferred.FirstOrDefault(candidate => candidate.SessionId == windowsCurrentSessionId)?.SessionId
            ?? preferred[0].SessionId;
    }
}
