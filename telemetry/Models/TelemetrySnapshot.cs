namespace QuietSystem.Telemetry.Models;

public sealed record TelemetrySnapshot(
    long Timestamp,
    SystemTelemetry System,
    CpuTelemetry? Cpu,
    GpuTelemetry? Gpu,
    MemoryTelemetry? Memory,
    StorageTelemetry? Storage,
    NetworkTelemetry? Network);

public sealed record SystemTelemetry(
    string Username,
    string Hostname,
    string Os,
    double UptimeSeconds);

public sealed record CpuTelemetry(
    string? Name,
    double? Usage,
    double? Temperature,
    double? ClockMHz,
    double? PowerW,
    IReadOnlyList<double>? Cores);

public sealed record GpuTelemetry(
    string? Name,
    double? Usage,
    double? Temperature,
    double? ClockMHz,
    double? VramUsedGB,
    double? VramTotalGB,
    double? PowerW,
    double? FanRpm);

public sealed record MemoryTelemetry(
    double? UsedGB,
    double? TotalGB,
    double? Usage);

public sealed record StorageTelemetry(
    string? Name,
    double? UsedGB,
    double? TotalGB,
    double? Usage,
    double? ReadMBps,
    double? WriteMBps,
    double? Temperature);

public sealed record NetworkTelemetry(
    string? Interface,
    double? DownloadMbps,
    double? UploadMbps,
    long? TotalReceivedBytes,
    long? TotalSentBytes);
