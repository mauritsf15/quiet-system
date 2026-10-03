import { createStore } from "./core/store.js";
import { initialState } from "./core/state.js";
import { createHistory } from "./core/history.js";
import { startTelemetryClient } from "./core/telemetry-client.js";
import { startDemoTelemetry } from "./core/demo-telemetry.js";
import { startWeatherService } from "./core/weather-service.js?v=0.1.1";
import { installMediaIntegration } from "./media/media-controller.js";
import { renderResources } from "./components/resources.js?v=20261002a";
import { installDashboard } from "./components/dashboard.js?v=20261004a";
import { installCommandTerminal } from "./components/command-terminal.js?v=20261003d";
import { installAppearance } from "./components/appearance.js?v=0.1.1";
import { displayRole, startDisplayRuntime } from "./core/display-runtime.js";

const store = createStore(initialState);
const history = createHistory(60);
const params = new URLSearchParams(location.search);
const role = displayRole(params.get("role"));
document.body.dataset.role = role;
const localCompanion = location.hostname === "127.0.0.1" && location.port === "9876";
const wallpaperRuntime = typeof window.wallpaperRegisterMediaPropertiesListener === "function";

const disposeAppearance = installAppearance(store);
const disposeRuntime = startDisplayRuntime({
  role, localCompanion, telemetryMode: params.get("telemetry"), wallpaperRuntime, store, history,
  services: { installMediaIntegration, startTelemetryClient, startDemoTelemetry, startWeatherService,
    installDashboard, installCommandTerminal, renderResources },
});
document.body.classList.add("is-ready");

window.addEventListener("pagehide", () => { disposeRuntime(); disposeAppearance?.(); }, { once: true });
