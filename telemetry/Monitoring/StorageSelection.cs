namespace QuietSystem.Telemetry.Monitoring;

internal static class StorageSelection
{
    public static T? SystemDrive<T>(IEnumerable<T> disks, string? systemRoot,
        Func<T, IEnumerable<char?>> driveLetters) where T : class
    {
        if (systemRoot is not { Length: >= 2 } || systemRoot[1] != ':' || !char.IsAsciiLetter(systemRoot[0])) return null;
        var systemLetter = char.ToUpperInvariant(systemRoot[0]);
        T? selected = null;
        foreach (var disk in disks)
        {
            bool containsSystemDrive;
            try { containsSystemDrive = driveLetters(disk).Any(letter => letter.HasValue && char.ToUpperInvariant(letter.Value) == systemLetter); }
            catch { continue; } // A removed disk must not suppress other hardware telemetry.
            if (!containsSystemDrive) continue;
            // A spanned volume has no single physical disk whose sensors describe it.
            if (selected is not null) return null;
            selected = disk;
        }
        return selected;
    }
}
