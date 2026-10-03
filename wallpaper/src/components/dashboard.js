import { duration, uptime } from "../core/format.js";
import { installLyrics } from "../media/lyrics-controller.js?v=20261003c";

const el = (id) => document.getElementById(id);
let lastArtwork = null;

function renderClock(store) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: store.getState().settings.clock24Hour ? "h23" : "h12" }).formatToParts(now);
  const part = (name) => parts.find((entry) => entry.type === name)?.value || "--";
  el("clock-time").innerHTML = `${part("hour")}:${part("minute")}<small>${part("second")}</small>`;
  el("clock-weekday").textContent = `${new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(now).toUpperCase()} · WASSENAAR`;
  el("clock-date").textContent = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric" }).format(now);
}

function renderState(state) {
  const { identity, media, weather, connected, connectionState } = state;
  el("shell-identity").textContent = `${identity.username}@${identity.hostname}`;
  el("system-line").textContent = `${identity.os} · ${uptime(identity.uptimeSeconds)}`;
  el("connection-label").textContent = connectionState.toUpperCase();
  el("status-message").textContent = connected ? "All systems reporting" : "Waiting for live data";
  el("weather-line").textContent = weather.available ? `Wassenaar · ${Math.round(weather.temperatureC)}°C · ${weather.condition}` : `Weather / ${weather.condition}`;
  el("weather-line").hidden = !state.settings.showWeather;

  const playing = media.enabled && (media.state === "playing" || media.state === "paused");
  el("media-state").textContent = !media.enabled ? "MEDIA UNAVAILABLE" : playing ? media.state.toUpperCase() : "NO ACTIVE MEDIA";
  el("media-title").textContent = playing ? media.title || "Untitled" : "Nothing playing";
  el("media-artist").textContent = playing ? media.artist || "Unknown artist" : "—";
  el("media-position").textContent = playing ? duration(media.position) : "--:--";
  el("media-duration").textContent = playing ? duration(media.duration) : "--:--";
  el("media-progress-fill").style.width = playing && media.duration > 0 ? `${Math.min(100, Math.max(0, media.position / media.duration * 100))}%` : "0%";
  const artwork = playing ? media.thumbnail || "" : "";
  if (artwork !== lastArtwork) {
    lastArtwork = artwork;
    const holder = el("album-art");
    holder.replaceChildren();
    if (artwork) {
      const image = document.createElement("img");
      image.alt = "Album artwork";
      image.src = artwork;
      image.onerror = () => holder.replaceChildren(Object.assign(document.createElement("span"), { textContent: "no art" }));
      holder.appendChild(image);
    } else holder.appendChild(Object.assign(document.createElement("span"), { textContent: "no art" }));
  }
}

function updateAudio(bars, levels, available = true) {
  for (let index = 0; index < bars.length; index += 1) {
    const level = Math.max(0, Math.min(1, Number(levels[index]) || 0));
    bars[index].style.height = `${Math.max(4, level * 100)}%`;
    bars[index].style.opacity = String(0.32 + level * 0.68);
  }
  el("audio-label").textContent = !available ? "audio unavailable" : levels.some((value) => value > 0.04) ? "audio / live" : "system audio";
}

export function installDashboard(store, { localCompanion }) {
  const bars = Array.from({ length: 48 }, () => {
    const bar = document.createElement("i");
    el("audio-spectrum").appendChild(bar);
    return bar;
  });
  let liveSocket;
  let retryTimer;
  let stopped = false;
  const clockTimer = window.setInterval(() => renderClock(store), 1000);
  const lyrics = installLyrics(store);
  renderClock(store);
  const unsubscribe = store.subscribe(renderState);

  function connectLive() {
    if (stopped) return;
    liveSocket = new WebSocket("ws://127.0.0.1:9876/live");
    liveSocket.addEventListener("message", (event) => {
      try {
        const packet = JSON.parse(event.data);
        if (packet.type === "media") store.update((state) => ({ ...state, media: { ...state.media, ...packet.data } }));
        if (packet.type === "lyrics") lyrics.receive(packet.data);
        if (packet.type === "audio") updateAudio(bars, packet.levels || [], packet.available);
      } catch { /* Ignore malformed live packets. */ }
    });
    liveSocket.addEventListener("close", () => {
      updateAudio(bars, [], false);
      lyrics.disconnect();
      store.update((state) => ({ ...state, media: { ...state.media, enabled: false, state: "stopped" } }));
      if (!stopped) retryTimer = window.setTimeout(connectLive, 2500);
    });
    liveSocket.addEventListener("error", () => liveSocket.close());
  }
  if (localCompanion) connectLive();
  else updateAudio(bars, [], false);
  return () => { stopped = true; unsubscribe(); lyrics.dispose(); window.clearInterval(clockTimer); window.clearInterval(retryTimer); liveSocket?.close(); };
}
