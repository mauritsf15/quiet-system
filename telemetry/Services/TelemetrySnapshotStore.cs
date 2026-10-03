using System.Text.Json;
using QuietSystem.Telemetry.Models;

namespace QuietSystem.Telemetry.Services;

public sealed class TelemetrySnapshotStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private string? _current;

    public bool HasSnapshot => Volatile.Read(ref _current) is not null;

    public string? Current => Volatile.Read(ref _current);

    public void Publish(TelemetrySnapshot snapshot)
    {
        var envelope = JsonSerializer.Serialize(new { type = "telemetry", data = snapshot }, JsonOptions);
        Volatile.Write(ref _current, envelope);
    }
}
