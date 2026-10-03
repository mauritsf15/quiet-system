const METRICS = ["cpu", "gpu", "memory", "network"];

export function createHistory(limit = 60) {
  const series = Object.fromEntries(METRICS.map((key) => [key, []]));

  return {
    push(telemetry) {
      const values = {
        cpu: telemetry.cpu?.usage,
        gpu: telemetry.gpu?.usage,
        memory: telemetry.memory?.usage,
        network: telemetry.network
          ? Math.max(telemetry.network.downloadMbps ?? 0, telemetry.network.uploadMbps ?? 0)
          : null,
      };

      for (const key of METRICS) {
        if (Number.isFinite(values[key])) {
          series[key].push(values[key]);
          if (series[key].length > limit) series[key].shift();
        }
      }
    },

    get(key) {
      return series[key] ?? [];
    },

    clear() {
      for (const key of METRICS) series[key].length = 0;
    },
  };
}
