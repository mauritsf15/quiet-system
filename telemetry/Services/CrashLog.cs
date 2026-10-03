namespace QuietSystem.Telemetry.Services;

internal static class CrashLog
{
    public static void Write(Exception exception)
    {
        try
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QuietSystem");
            Directory.CreateDirectory(directory);
            var entry = $"[{DateTimeOffset.Now:O}] {exception}\n\n";
            File.AppendAllText(Path.Combine(directory, "telemetry.log"), entry);
        }
        catch
        {
            // A logging failure must never produce a second crash dialog.
        }
    }
}
