using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace QuietSystem.Telemetry.Networking;

// ConPTY gives native programs (including Windows OpenSSH) real console handles.
// Its synchronous input and output pipes must be serviced on separate threads.
internal sealed class PseudoConsoleProcess : IDisposable
{
    private IntPtr console;
    private readonly object consoleLock = new();
    public Process Process { get; }
    public FileStream Input { get; }
    public FileStream Output { get; }

    public PseudoConsoleProcess(string command, string directory, int columns, int rows)
    {
        IntPtr inputRead = IntPtr.Zero, inputWrite = IntPtr.Zero;
        IntPtr outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero;
        IntPtr attributes = IntPtr.Zero;
        var attributesInitialized = false;
        Process? process = null;
        FileStream? input = null, output = null;
        try
        {
            Check(CreatePipe(out inputRead, out inputWrite, IntPtr.Zero, 0));
            Check(CreatePipe(out outputRead, out outputWrite, IntPtr.Zero, 0));
            Marshal.ThrowExceptionForHR(CreatePseudoConsole(new Coord(columns, rows), inputRead, outputWrite, 0, out console));
            nuint size = 0;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            attributes = Marshal.AllocHGlobal(checked((int)size));
            Check(InitializeProcThreadAttributeList(attributes, 1, 0, ref size));
            attributesInitialized = true;
            Check(UpdateProcThreadAttribute(attributes, 0, (nuint)0x00020016, console, (nuint)IntPtr.Size, IntPtr.Zero, IntPtr.Zero));
            var startup = new StartupInfoEx
            {
                // Null standard handles with STARTF_USESTDHANDLES force console handles
                // even when the companion's own standard streams are redirected.
                Info = new StartupInfo { Size = Marshal.SizeOf<StartupInfoEx>(), Flags = 0x00000100 },
                Attributes = attributes,
            };
            var executable = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe");
            var script = "$ProgressPreference = 'SilentlyContinue'; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); " + command;
            var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
            var commandLine = new StringBuilder($"\"{executable}\" -NoLogo -NoProfile -EncodedCommand {encoded}");
            Check(CreateProcess(executable, commandLine, IntPtr.Zero, IntPtr.Zero, false, 0x00080000,
                IntPtr.Zero, directory, ref startup, out var info));
            try { process = Process.GetProcessById((int)info.ProcessId); }
            finally { CloseHandle(info.Thread); CloseHandle(info.Process); }

            input = new FileStream(new SafeFileHandle(inputWrite, ownsHandle: true), FileAccess.Write, 4096, isAsync: false);
            inputWrite = IntPtr.Zero;
            output = new FileStream(new SafeFileHandle(outputRead, ownsHandle: true), FileAccess.Read, 4096, isAsync: false);
            outputRead = IntPtr.Zero;
            Process = process;
            Input = input;
            Output = output;
        }
        catch
        {
            if (process is not null) { if (!process.HasExited) process.Kill(entireProcessTree: true); process.Dispose(); }
            input?.Dispose();
            // Close the output reader before ConPTY when no reader task exists yet.
            output?.Dispose();
            if (outputRead != IntPtr.Zero) { CloseHandle(outputRead); outputRead = IntPtr.Zero; }
            CloseConsole();
            throw;
        }
        finally
        {
            if (attributesInitialized) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            foreach (var handle in new[] { inputRead, inputWrite, outputRead, outputWrite })
                if (handle != IntPtr.Zero) CloseHandle(handle);
        }
    }

    public void Resize(int columns, int rows)
    {
        lock (consoleLock)
            if (console != IntPtr.Zero)
                Marshal.ThrowExceptionForHR(ResizePseudoConsole(console, new Coord(columns, rows)));
    }

    public void Stop()
    {
        try { if (!Process.HasExited) Process.Kill(entireProcessTree: true); }
        catch (InvalidOperationException) { }
        catch (Win32Exception) { }
    }

    // Call while the output pump is still draining, including during disconnect.
    public void CloseConsole()
    {
        lock (consoleLock)
        {
            if (console == IntPtr.Zero) return;
            var handle = console;
            console = IntPtr.Zero;
            ClosePseudoConsole(handle);
        }
    }

    public void Dispose()
    {
        Stop();
        Output.Dispose();
        CloseConsole();
        Input.Dispose();
        Process.Dispose();
    }

    private static void Check(bool success) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error()); }

    [StructLayout(LayoutKind.Sequential)]
    private readonly struct Coord(int columns, int rows)
    {
        public readonly short X = (short)columns;
        public readonly short Y = (short)rows;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfo
    {
        public int Size;
        public IntPtr Reserved, Desktop, Title;
        public int X, Y, XSize, YSize, XCountChars, YCountChars, FillAttribute, Flags;
        public short ShowWindow, ReservedSize;
        public IntPtr ReservedBytes, StandardInput, StandardOutput, StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfoEx { public StartupInfo Info; public IntPtr Attributes; }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInfo { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreatePipe(out IntPtr read, out IntPtr write, IntPtr security, uint size);
    [DllImport("kernel32.dll")]
    private static extern int CreatePseudoConsole(Coord size, IntPtr input, IntPtr output, uint flags, out IntPtr console);
    [DllImport("kernel32.dll")]
    private static extern int ResizePseudoConsole(IntPtr console, Coord size);
    [DllImport("kernel32.dll")]
    private static extern void ClosePseudoConsole(IntPtr console);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref nuint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, nuint attribute, IntPtr value, nuint size, IntPtr previous, IntPtr returnedSize);
    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
}
