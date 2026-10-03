using System.Runtime.InteropServices;

namespace QuietSystem.Telemetry.Monitoring;

internal static class ProcessorPowerSampler
{
    private const int ProcessorInformation = 11;

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessorPowerInformation
    {
        public uint Number;
        public uint MaxMhz;
        public uint CurrentMhz;
        public uint MhzLimit;
        public uint MaxIdleState;
        public uint CurrentIdleState;
    }

    [DllImport("powrprof.dll", SetLastError = true)]
    private static extern uint CallNtPowerInformation(
        int informationLevel,
        IntPtr inputBuffer,
        uint inputBufferLength,
        IntPtr outputBuffer,
        uint outputBufferLength);

    public static double? CurrentClockMHz()
    {
        if (!OperatingSystem.IsWindows()) return null;
        var processorCount = Environment.ProcessorCount;
        var itemSize = Marshal.SizeOf<ProcessorPowerInformation>();
        var bufferLength = checked(itemSize * processorCount);
        var buffer = Marshal.AllocHGlobal(bufferLength);
        try
        {
            var status = CallNtPowerInformation(
                ProcessorInformation,
                IntPtr.Zero,
                0,
                buffer,
                (uint)bufferLength);
            if (status != 0) return null;

            var clocks = new List<uint>(processorCount);
            for (var index = 0; index < processorCount; index++)
            {
                var info = Marshal.PtrToStructure<ProcessorPowerInformation>(IntPtr.Add(buffer, index * itemSize));
                if (info.CurrentMhz > 0) clocks.Add(info.CurrentMhz);
            }
            return clocks.Count == 0 ? null : clocks.Average(value => (double)value);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }
}
