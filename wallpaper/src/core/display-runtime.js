export function displayRole(value) {
  return value === "dashboard" || value === "commands" ? value : "auto";
}

export function startDisplayRuntime({ role, localCompanion, telemetryMode, wallpaperRuntime, store, history, services }) {
  const disposers = [];
  if (role !== "commands") {
    if (!localCompanion) services.installMediaIntegration(store);
    const onTelemetry = (telemetry) => history.push(telemetry);
    const live = localCompanion || ["live", "offline"].includes(telemetryMode) || wallpaperRuntime;
    disposers.push(live
      ? services.startTelemetryClient(store, onTelemetry)
      : services.startDemoTelemetry(store, onTelemetry));
    disposers.push(services.startWeatherService(store));
    disposers.push(services.installDashboard(store, { localCompanion }));
    disposers.push(store.subscribe((state) => services.renderResources(state, history)));
  }
  if (role !== "dashboard") {
    disposers.push(services.installCommandTerminal({ localCompanion }));
  }
  return () => disposers.forEach((dispose) => dispose?.());
}
