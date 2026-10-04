import { uptime } from "../core/format.js";
import { installPlaybackControls } from "../media/playback-controls.js?v=20261004a";
import { installVolumeMixer } from "../audio/volume-mixer.js?v=20261004a";
import { installLyrics } from "../media/lyrics-controller.js?v=20261003c";
import { createSpectrumRenderer } from "../audio/spectrum-renderer.js?v=20261004a";

const el = (id) => document.getElementById(id);

function renderClock(store) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: store.getState().settings.clock24Hour ? "h23" : "h12" }).formatToParts(now);
  const part = (name) => parts.find((entry) => entry.type === name)?.value || "--";
  el("clock-time").innerHTML = `${part("hour")}:${part("minute")}<small>${part("second")}</small>`;
  const place = store.getState().settings.weatherLocation?.name;
  el("clock-weekday").textContent = new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(now).toUpperCase() + (place ? ` · ${place.toUpperCase()}` : "");
  el("clock-date").textContent = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(now);
}

function renderState(state) {
  const { identity, media, weather, connected, connectionState } = state;
  el("shell-identity").textContent = `${identity.username}@${identity.hostname}`;
  el("system-line").textContent = `${identity.os} · ${uptime(identity.uptimeSeconds)}`;
  el("connection-label").textContent = connectionState.toUpperCase();
  el("status-message").textContent = connected ? "All systems reporting" : "Waiting for live data";
  el("weather-line").textContent = weather.available ? `${state.settings.weatherLocation?.name || "Weather"} · ${Math.round(weather.temperatureC)}°C · ${weather.condition}` : `Weather / ${weather.condition}`;
  el("weather-line").hidden = !state.settings.showWeather;

  const playing = media.enabled && (media.state === "playing" || media.state === "paused");
  el("media-state").textContent = !media.enabled ? "MEDIA UNAVAILABLE" : playing ? media.state.toUpperCase() : "NO ACTIVE MEDIA";
  el("media-title").textContent = playing ? media.title || "Untitled" : "Nothing playing";
  el("media-artist").textContent = playing ? media.artist || "Unknown artist" : "—";
}

function updateAudio(spectrum, levels, available = true) {
  const active = spectrum.update(levels, available);
  el("audio-label").textContent = !available ? "audio unavailable" : active ? "audio / live" : "system audio";
}

export function installDashboard(store, { localCompanion }) {
  const disposeMixer = installVolumeMixer({ localCompanion });
  const spectrum = createSpectrumRenderer(el("audio-spectrum"));
  let liveSocket;
  let retryTimer;
  let stopped = false;
  const clockTimer = window.setInterval(() => renderClock(store), 1000);
  const lyrics = installLyrics(store);
  renderClock(store);
  const unsubscribe = store.subscribe(renderState);
  const disposePlayback = installPlaybackControls(store, { localCompanion });

  function connectLive() {
    if (stopped) return;
    liveSocket = new WebSocket("ws://127.0.0.1:9876/live");
    liveSocket.addEventListener("message", (event) => {
      try {
        const packet = JSON.parse(event.data);
        if (packet.type === "media") store.update((state) => ({ ...state, media: {
          ...state.media, capabilities: null, seekMin: null, seekMax: null, ...packet.data,
        } }));
        if (packet.type === "lyrics") lyrics.receive(packet.data);
        if (packet.type === "audio") updateAudio(spectrum, packet.levels || [], packet.available);
      } catch { /* Ignore malformed live packets. */ }
    });
    liveSocket.addEventListener("close", () => {
      updateAudio(spectrum, [], false);
      lyrics.disconnect();
      store.update((state) => ({ ...state, media: { ...state.media, enabled: false, state: "stopped" } }));
      if (!stopped) retryTimer = window.setTimeout(connectLive, 2500);
    });
    liveSocket.addEventListener("error", () => liveSocket.close());
  }
  if (localCompanion) connectLive();
  else updateAudio(spectrum, [], false);
  return () => { stopped = true; disposePlayback(); disposeMixer(); unsubscribe(); lyrics.dispose(); spectrum.dispose(); window.clearInterval(clockTimer); window.clearTimeout(retryTimer); liveSocket?.close(); };
}
