using System.Runtime.InteropServices;
using QuietSystem.Telemetry.Models;

namespace QuietSystem.Telemetry.Monitoring;

internal static class PhysicalMemorySampler
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private sealed class MemoryStatusEx
    {
        public uint Length = (uint)Marshal.SizeOf<MemoryStatusEx>();
        public uint MemoryLoad;
        public ulong TotalPhysical;
        public ulong AvailablePhysical;
        public ulong TotalPageFile;
        public ulong AvailablePageFile;
        public ulong TotalVirtual;
        public ulong AvailableVirtual;
        public ulong AvailableExtendedVirtual;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx([In, Out] MemoryStatusEx buffer);

    public static MemoryTelemetry? Sample()
    {
        if (!OperatingSystem.IsWindows()) return null;
        var status = new MemoryStatusEx();
        if (!GlobalMemoryStatusEx(status) || status.TotalPhysical == 0) return null;

        const double bytesPerGigabyte = 1_073_741_824d;
        var total = status.TotalPhysical / bytesPerGigabyte;
        var available = status.AvailablePhysical / bytesPerGigabyte;
        var used = Math.Max(0, total - available);
        return new MemoryTelemetry(used, total, used / total * 100d);
    }
}
