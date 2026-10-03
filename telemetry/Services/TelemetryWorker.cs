using Microsoft.Extensions.Hosting;
using QuietSystem.Telemetry.Monitoring;

namespace QuietSystem.Telemetry.Services;

public sealed class TelemetryWorker(
    HardwareTelemetryCollector collector,
    TelemetrySnapshotStore snapshots) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Let the web host bind immediately; hardware discovery can take several seconds.
        await Task.Yield();
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(500));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                snapshots.Publish(collector.Collect());
            }
            catch
            {
                // Sleep/resume and driver resets can invalidate sensor handles.
                collector.Reset();
                await Task.Delay(1000, stoppingToken);
            }

            if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
        }
    }
}
