using System.Net;
using System.Net.NetworkInformation;
using QuietSystem.Telemetry.Models;

namespace QuietSystem.Telemetry.Monitoring;

internal sealed class NetworkSampler
{
    private sealed class CounterState
    {
        public long Received;
        public long Sent;
        public long SampledAt;
        public double? DownloadMbps;
        public double? UploadMbps;
    }

    private sealed record Candidate(
        NetworkInterface Interface,
        IPv4InterfaceStatistics Counters,
        bool HasGateway,
        long ActivityBytes,
        double? DownloadMbps,
        double? UploadMbps);

    private readonly Dictionary<string, CounterState> _states = new(StringComparer.OrdinalIgnoreCase);

    public NetworkTelemetry? Sample()
    {
        var now = Environment.TickCount64;
        var candidates = new List<Candidate>();
        NetworkInterface[] interfaces;
        try
        {
            interfaces = NetworkInterface.GetAllNetworkInterfaces();
        }
        catch
        {
            return null;
        }

        foreach (var adapter in interfaces)
        {
            if (adapter.OperationalStatus != OperationalStatus.Up ||
                adapter.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel ||
                !adapter.Supports(NetworkInterfaceComponent.IPv4)) continue;

            try
            {
                var counters = adapter.GetIPv4Statistics();
                var state = _states.GetValueOrDefault(adapter.Id);
                long activity = 0;
                double? download = null;
                double? upload = null;

                if (state is not null && state.SampledAt > 0 && now > state.SampledAt)
                {
                    var seconds = (now - state.SampledAt) / 1000d;
                    var received = Math.Max(0, counters.BytesReceived - state.Received);
                    var sent = Math.Max(0, counters.BytesSent - state.Sent);
                    activity = received + sent;
                    var rawDownload = received * 8d / 1_000_000d / seconds;
                    var rawUpload = sent * 8d / 1_000_000d / seconds;

                    // Streams download in short chunks, so instantaneous rates often
                    // alternate between a large spike and zero. A quick attack and
                    // slower release keeps the readout useful without hiding changes.
                    state.DownloadMbps = Smooth(state.DownloadMbps, rawDownload);
                    state.UploadMbps = Smooth(state.UploadMbps, rawUpload);
                    download = state.DownloadMbps;
                    upload = state.UploadMbps;
                }
                else
                {
                    state = new CounterState();
                    _states[adapter.Id] = state;
                }

                state.Received = counters.BytesReceived;
                state.Sent = counters.BytesSent;
                state.SampledAt = now;

                var hasGateway = adapter.GetIPProperties().GatewayAddresses.Any(gateway =>
                    !gateway.Address.Equals(IPAddress.Any) &&
                    !gateway.Address.Equals(IPAddress.IPv6Any));
                candidates.Add(new Candidate(adapter, counters, hasGateway, activity, download, upload));
            }
            catch
            {
                // One stale or restricted adapter should not suppress all networking.
            }
        }

        if (candidates.Count == 0) return null;
        var routed = candidates.Where(candidate => candidate.HasGateway).ToArray();
        var pool = routed.Length > 0 ? routed : candidates.ToArray();
        var active = pool
            .OrderByDescending(candidate => candidate.ActivityBytes)
            .ThenByDescending(candidate => candidate.Interface.Speed)
            .First();

        return new NetworkTelemetry(
            active.Interface.Name,
            active.DownloadMbps,
            active.UploadMbps,
            active.Counters.BytesReceived,
            active.Counters.BytesSent);
    }

    private static double Smooth(double? previous, double current)
    {
        if (!previous.HasValue) return current;
        var factor = current > previous.Value ? 0.55 : 0.12;
        return previous.Value + (current - previous.Value) * factor;
    }
}
