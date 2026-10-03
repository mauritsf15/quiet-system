import { createStore } from "./core/store.js";
import { initialState } from "./core/state.js";
import { createHistory } from "./core/history.js";
import { startTelemetryClient } from "./core/telemetry-client.js";
import { startDemoTelemetry } from "./core/demo-telemetry.js";
import { startWeatherService } from "./core/weather-service.js";
import { installMediaIntegration } from "./media/media-controller.js";
import { renderResources } from "./components/resources.js?v=20261002a";
import { installDashboard } from "./components/dashboard.js?v=20261003c";
import { installCommandTerminal } from "./components/command-terminal.js?v=20261003b";
import { installAppearance } from "./components/appearance.js";

const store = createStore(initialState);
const history = createHistory(60);
const disposers = [];
const params = new URLSearchParams(location.search);
const role = params.get("role");
document.body.dataset.role = role === "dashboard" || role === "commands" ? role : "auto";
const localCompanion = location.hostname === "127.0.0.1" && location.port === "9876";
const wallpaperRuntime = typeof window.wallpaperRegisterMediaPropertiesListener === "function";

installAppearance(store);
if (!localCompanion) installMediaIntegration(store);
const onTelemetry = (telemetry) => history.push(telemetry);
disposers.push(localCompanion || params.get("telemetry") === "live" || params.get("telemetry") === "offline" || wallpaperRuntime
  ? startTelemetryClient(store, onTelemetry)
  : startDemoTelemetry(store, onTelemetry));
disposers.push(startWeatherService(store));
disposers.push(installDashboard(store, { localCompanion }));
disposers.push(installCommandTerminal({ localCompanion }));
disposers.push(store.subscribe((state) => renderResources(state, history)));
document.body.classList.add("is-ready");

window.addEventListener("pagehide", () => disposers.forEach((dispose) => dispose?.()), { once: true });
