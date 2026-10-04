export function installVolumeMixer({ localCompanion }) {
  const panel = document.getElementById("volume-mixer");
  if (!panel) return () => {};
  const summary = document.getElementById("mixer-summary");
  const status = document.getElementById("mixer-status");
  const list = document.getElementById("mixer-controls");
  const rows = new Map();
  let token, timer, stopped = false, refreshing = false;
  const demo = { available: true, deviceId: "demo", deviceName: "Speakers", volume: .65, muted: false,
    sessions: [{ id: "music", name: "Spotify", volume: .8, muted: false }, { id: "browser", name: "Browser", volume: .4, muted: false }] };
  try { panel.open = localStorage.getItem("quiet-volume-mixer-open") === "true"; } catch {}

  async function request(path, body) {
    if (!token) {
      const response = await fetch("/api/session", { cache: "no-store" });
      if (!response.ok) throw new Error("Local companion unavailable");
      token = (await response.json()).token;
    }
    const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store",
      headers: { "X-Session-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    if (response.status === 403) token = null;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Local companion unavailable");
    return data;
  }

  function render(data) {
    summary.textContent = data.available ? `${data.deviceName} · ${data.muted ? "muted" : `${Math.round(data.volume * 100)}%`}` : "Audio unavailable";
    status.textContent = !data.available ? "No audio output available" : !localCompanion ? "Preview · sample controls" : data.sessions.length ? "" : "No application audio sessions. Start playback to see an app here.";
    const entries = data.available ? [{ id: "master", name: "Master volume", volume: data.volume, muted: data.muted }, ...data.sessions] : [];
    const duplicates = new Map();
    const totals = new Map();
    for (const entry of entries) totals.set(entry.name, (totals.get(entry.name) || 0) + 1);
    const current = new Set();
    for (const entry of entries) {
      const key = `${data.deviceId}:${entry.id}`;
      current.add(key);
      let row = rows.get(key);
      if (!row) {
        const element = document.createElement("div"); element.className = "mixer-row";
        const label = document.createElement("span");
        const slider = document.createElement("input"); slider.type = "range"; slider.min = "0"; slider.max = "100"; slider.step = "1";
        const value = document.createElement("output");
        const mute = document.createElement("button"); mute.type = "button";
        element.append(label, slider, value, mute); list.append(element);
        row = { element, label, slider, value, mute, deviceId: data.deviceId, sessionId: entry.id === "master" ? null : entry.id, pending: null, busy: false, timeout: null };
        rows.set(key, row);
        slider.addEventListener("input", () => { value.textContent = `${slider.value}%`; queue(row, { volume: Number(slider.value) / 100 }); });
        slider.addEventListener("change", () => { clearTimeout(row.timeout); flush(row); });
        mute.addEventListener("click", () => queue(row, { muted: mute.getAttribute("aria-pressed") !== "true" }, true));
      }
      const number = (duplicates.get(entry.name) || 0) + 1; duplicates.set(entry.name, number);
      const name = totals.get(entry.name) > 1 ? `${entry.name} (${number})` : entry.name;
      row.label.textContent = name; row.slider.setAttribute("aria-label", `${name} volume`);
      row.mute.setAttribute("aria-label", `${entry.muted ? "Unmute" : "Mute"} ${name}`);
      row.mute.setAttribute("aria-pressed", String(entry.muted)); row.mute.textContent = entry.muted ? "Unmute" : "Mute";
      row.slider.disabled = row.mute.disabled = false;
      if (!row.busy && !row.pending && document.activeElement !== row.slider) {
        row.slider.value = Math.round(entry.volume * 100); row.value.textContent = `${row.slider.value}%`;
      }
    }
    for (const [key, row] of rows) if (!current.has(key)) { clearTimeout(row.timeout); row.element.remove(); rows.delete(key); }
  }

  function queue(row, change, immediate = false) {
    row.pending = { ...row.pending, ...change };
    if (immediate) { clearTimeout(row.timeout); flush(row); }
    else if (!row.timeout) row.timeout = setTimeout(() => flush(row), 100);
  }
  async function flush(row) {
    clearTimeout(row.timeout); row.timeout = null;
    if (stopped || row.busy || !row.pending || !row.element.isConnected) return;
    const change = row.pending; row.pending = null; row.busy = true;
    try {
      if (localCompanion) {
        const data = await request("/api/audio-mixer/control", { deviceId: row.deviceId, sessionId: row.sessionId, ...change });
        if (!stopped && row.element.isConnected) render(data);
      } else {
        Object.assign(row.sessionId ? demo.sessions.find(session => session.id === row.sessionId) : demo, change);
        render(demo);
      }
    } catch (error) { if (!stopped) { status.textContent = error.message; for (const item of rows.values()) item.slider.disabled = item.mute.disabled = true; } }
    finally { row.busy = false; if (row.pending) flush(row); }
  }
  async function refresh() {
    if (stopped || refreshing) return;
    refreshing = true;
    try { const data = localCompanion ? await request("/api/audio-mixer") : demo; if (!stopped) render(data); }
    catch { if (!stopped) { summary.textContent = "Unavailable"; status.textContent = "Waiting for local companion"; for (const row of rows.values()) row.slider.disabled = row.mute.disabled = true; } }
    finally { refreshing = false; if (!stopped) { clearTimeout(timer); timer = setTimeout(refresh, panel.open ? 1000 : 2000); } }
  }
  function toggle() { try { localStorage.setItem("quiet-volume-mixer-open", String(panel.open)); } catch {} clearTimeout(timer); refresh(); }
  panel.addEventListener("toggle", toggle); refresh();
  return () => { stopped = true; clearTimeout(timer); panel.removeEventListener("toggle", toggle); for (const row of rows.values()) clearTimeout(row.timeout); };
}
