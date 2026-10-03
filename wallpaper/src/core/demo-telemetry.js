export function startDemoTelemetry(store, onTelemetry) {
  document.body.classList.add("is-demo");
  const startedAt = Date.now() - 183_000;
  let tick = 0;

  const sample = () => {
    tick += 1;
    const wave = (period, offset = 0) => (Math.sin(tick / period + offset) + 1) / 2;
    const telemetry = {
      timestamp: Date.now(),
      system: {
        username: "demo-user",
        hostname: "DEMO-PC",
        os: "Windows 11 · 25H2",
        uptimeSeconds: (Date.now() - startedAt) / 1000 + 180_000,
      },
      cpu: {
        name: "AMD Ryzen",
        usage: 18 + wave(7) * 34,
        temperature: 47 + wave(11, 1) * 13,
        clockMHz: 4250 + wave(5) * 600,
        powerW: 42 + wave(8) * 38,
      },
      gpu: {
        name: "NVIDIA GeForce",
        usage: 34 + wave(9, 2) * 49,
        temperature: 53 + wave(10, 0.5) * 14,
        clockMHz: 1850 + wave(6) * 280,
        vramUsedGB: 5.8 + wave(15) * 1.9,
        vramTotalGB: 12,
        powerW: 116 + wave(8, 1) * 74,
        fanRpm: 1220 + wave(7) * 480,
      },
      memory: { usedGB: 17.6 + wave(22) * 1.2, totalGB: 32, usage: 55 + wave(22) * 4 },
      storage: { usage: 68.4, usedGB: 684, totalGB: 1000, readMBps: wave(4) * 41, writeMBps: wave(9) * 12, temperature: 42 },
      network: { downloadMbps: wave(5) ** 3 * 92, uploadMbps: wave(8, 2) ** 3 * 16, interface: "Wi-Fi" },
    };

    store.update((state) => ({
      ...state,
      connected: true,
      connectionState: "preview",
      lastTelemetryAt: Date.now(),
      identity: telemetry.system,
      telemetry,
    }));
    onTelemetry(telemetry);
  };

  sample();
  const timer = window.setInterval(sample, 1000);
  return () => window.clearInterval(timer);
}
