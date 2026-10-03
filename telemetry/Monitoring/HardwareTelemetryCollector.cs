using System.Runtime.InteropServices;
using LibreHardwareMonitor.Hardware;
using LibreHardwareMonitor.Hardware.Storage;
using QuietSystem.Telemetry.Models;

namespace QuietSystem.Telemetry.Monitoring;

public sealed class HardwareTelemetryCollector : IDisposable
{
    private Computer _computer;
    private readonly UpdateVisitor _visitor = new();
    private readonly NetworkSampler _network = new();
    private bool _opened;
    private bool _disposed;

    public HardwareTelemetryCollector()
    {
        _computer = CreateComputer();
    }

    private static Computer CreateComputer() => new()
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            IsMemoryEnabled = true,
            IsStorageEnabled = true,
            IsNetworkEnabled = false,
            IsMotherboardEnabled = false,
            IsControllerEnabled = false,
            IsBatteryEnabled = false
        };

    public TelemetrySnapshot Collect()
    {
        if (!_opened)
        {
            _computer.Open();
            _opened = true;
        }
        _computer.Accept(_visitor);
        var hardware = Flatten(_computer.Hardware).ToArray();
        return new TelemetrySnapshot(
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            new SystemTelemetry(
                Environment.UserName,
                Environment.MachineName,
                RuntimeInformation.OSDescription.Trim(),
                Environment.TickCount64 / 1000d),
            ReadCpu(hardware.FirstOrDefault(item => item.HardwareType == HardwareType.Cpu)),
            ReadGpu(hardware.FirstOrDefault(item => item.HardwareType is HardwareType.GpuNvidia or HardwareType.GpuAmd or HardwareType.GpuIntel)),
            ReadMemory(hardware.FirstOrDefault(item => item.HardwareType == HardwareType.Memory)),
            ReadStorage(hardware.OfType<StorageDevice>()),
            _network.Sample());
    }

    private static IEnumerable<IHardware> Flatten(IEnumerable<IHardware> roots)
    {
        foreach (var root in roots)
        {
            yield return root;
            foreach (var child in Flatten(root.SubHardware)) yield return child;
        }
    }

    private static CpuTelemetry? ReadCpu(IHardware? hardware)
    {
        if (hardware is null) return null;
        var sensors = hardware.Sensors;
        var cores = Values(sensors, SensorType.Load, "Core").ToArray();
        return new CpuTelemetry(
            hardware.Name,
            Preferred(sensors, SensorType.Load, "CPU Total", "Total") ?? Average(cores),
            Preferred(sensors, SensorType.Temperature, "CPU Package", "Core Average", "Core Max"),
            Average(Values(sensors, SensorType.Clock, "Core")) ?? ProcessorPowerSampler.CurrentClockMHz(),
            Positive(Preferred(sensors, SensorType.Power, "CPU Package", "Package")),
            cores.Length > 0 ? cores : null);
    }

    private static GpuTelemetry? ReadGpu(IHardware? hardware)
    {
        if (hardware is null) return null;
        var sensors = hardware.Sensors;
        return new GpuTelemetry(
            hardware.Name,
            Preferred(sensors, SensorType.Load, "GPU Core", "D3D 3D", "Core"),
            Preferred(sensors, SensorType.Temperature, "GPU Core", "Core", "Hot Spot"),
            Preferred(sensors, SensorType.Clock, "GPU Core", "Core"),
            DataInGigabytes(sensors, "Memory Used"),
            DataInGigabytes(sensors, "Memory Total"),
            Preferred(sensors, SensorType.Power, "GPU Package", "GPU Power", "Power"),
            Preferred(sensors, SensorType.Fan, "GPU", "Fan"));
    }

    private static MemoryTelemetry? ReadMemory(IHardware? hardware)
    {
        // LibreHardwareMonitor also exposes "Virtual Memory" sensors. A fuzzy
        // name match can therefore report the Windows commit limit as RAM.
        // GlobalMemoryStatusEx is the same physical-memory pool Task Manager uses.
        var physical = PhysicalMemorySampler.Sample();
        if (physical is not null) return physical;
        if (hardware is null) return null;
        var sensors = hardware.Sensors;
        var used = Exact(sensors, SensorType.Data, "Memory Used", "Used Memory");
        var available = Exact(sensors, SensorType.Data, "Memory Available", "Available Memory");
        var total = used.HasValue && available.HasValue ? used + available : null;
        return new MemoryTelemetry(used, total, Exact(sensors, SensorType.Load, "Memory"));
    }

    private static StorageTelemetry? ReadStorage(IEnumerable<StorageDevice> disks)
    {
        var systemRoot = Path.GetPathRoot(Environment.SystemDirectory);
        var drive = DriveInfo.GetDrives().FirstOrDefault(item => item.IsReady && item.Name.Equals(systemRoot, StringComparison.OrdinalIgnoreCase));
        if (drive is null) return null;
        // Disk enumeration order is unrelated to the volume containing Windows.
        var hardware = StorageSelection.SystemDrive(disks, systemRoot,
            disk => disk.Storage.Partitions.Select(partition => partition.DriveLetter));
        double? total = drive.TotalSize / 1_073_741_824d;
        double? used = (drive.TotalSize - drive.AvailableFreeSpace) / 1_073_741_824d;
        double? usage = total > 0 ? used / total * 100 : null;
        var sensors = hardware?.Sensors ?? Array.Empty<ISensor>();
        return new StorageTelemetry(
            hardware?.Name ?? drive?.Name,
            used,
            total,
            usage,
            ThroughputInMegabytes(sensors, "Read"),
            ThroughputInMegabytes(sensors, "Write"),
            Preferred(sensors, SensorType.Temperature, "Temperature", "Drive"));
    }

    private static double? DataInGigabytes(IEnumerable<ISensor> sensors, string name)
    {
        var sensor = sensors.FirstOrDefault(item => item.Name.Contains(name, StringComparison.OrdinalIgnoreCase) && item.Value.HasValue);
        return sensor?.SensorType switch
        {
            SensorType.Data => sensor.Value,
            SensorType.SmallData => sensor.Value / 1024d,
            _ => null
        };
    }

    private static double? ThroughputInMegabytes(IEnumerable<ISensor> sensors, string name)
    {
        var value = sensors.FirstOrDefault(item => item.SensorType == SensorType.Throughput && item.Name.Contains(name, StringComparison.OrdinalIgnoreCase))?.Value;
        return value / 1_048_576d;
    }

    private static double? Preferred(IEnumerable<ISensor> sensors, SensorType type, params string[] names)
    {
        foreach (var name in names)
        {
            var value = sensors.FirstOrDefault(item => item.SensorType == type && item.Value.HasValue && item.Name.Contains(name, StringComparison.OrdinalIgnoreCase))?.Value;
            if (value.HasValue) return value;
        }
        return sensors.FirstOrDefault(item => item.SensorType == type && item.Value.HasValue)?.Value;
    }

    private static double? Exact(IEnumerable<ISensor> sensors, SensorType type, params string[] names)
    {
        foreach (var name in names)
        {
            var value = sensors.FirstOrDefault(item => item.SensorType == type && item.Value.HasValue &&
                item.Name.Equals(name, StringComparison.OrdinalIgnoreCase))?.Value;
            if (value.HasValue) return value;
        }
        return null;
    }

    private static double? Positive(double? value) => value > 0 ? value : null;

    private static IEnumerable<double> Values(IEnumerable<ISensor> sensors, SensorType type, string name) =>
        sensors.Where(item => item.SensorType == type && item.Value.HasValue && item.Name.Contains(name, StringComparison.OrdinalIgnoreCase))
            .Select(item => (double)item.Value!.Value);

    private static double? Average(IEnumerable<double> values)
    {
        var materialized = values.ToArray();
        return materialized.Length == 0 ? null : materialized.Average();
    }

    public void Reset()
    {
        try
        {
            if (_opened) _computer.Close();
        }
        catch
        {
            // Hardware handles may already be invalid after sleep or device removal.
        }
        _computer = CreateComputer();
        _opened = false;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_opened) _computer.Close();
    }
}
