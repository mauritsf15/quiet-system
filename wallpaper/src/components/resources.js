import { number, temperature, networkRate } from "../core/format.js";

const elements = Object.fromEntries([
  "cpu-value", "cpu-detail", "cpu-graph", "gpu-value", "gpu-detail", "gpu-graph",
  "memory-value", "memory-detail", "memory-graph", "network-value", "network-detail",
  "network-graph", "storage-value", "storage-detail", "storage-bar", "storage-io",
  "storage-indicator", "storage-summary", "storage-warning",
].map((id) => [id, document.getElementById(id)]));

function text(id, value) {
  if (elements[id].textContent !== value) elements[id].textContent = value;
}

function availability(name, available) {
  document.querySelector(`[data-metric="${name}"]`)?.classList.toggle("is-missing", !available);
}

function detail(parts, fallback) {
  const available = parts.filter(([value]) => Number.isFinite(value));
  return available.length
    ? available.map(([value, formatter]) => formatter(value)).join(" · ")
    : fallback;
}

function drawGraph(id, values, ceiling = 100) {
  const graph = elements[id];
  const recent = values.slice(-60);
  const [fill, line] = graph.querySelectorAll("path");
  if (!recent.length) { fill.removeAttribute("d"); line.removeAttribute("d"); return; }
  const y = (value) => 23 - Math.min(1, Math.max(0, value / Math.max(1, ceiling))) * 22;
  const points = recent.length === 1
    ? [[0, y(recent[0])], [100, y(recent[0])]]
    : recent.map((value, index) => [index / (recent.length - 1) * 100, y(value)]);
  const trace = points.map(([x, vertical], index) => `${index ? "L" : "M"}${x.toFixed(2)} ${vertical.toFixed(2)}`).join(" ");
  line.setAttribute("d", trace);
  fill.setAttribute("d", `${trace} L100 24 L0 24 Z`);
}

export function renderResources(state, history) {
  const { telemetry, settings } = state;
  const { cpu, gpu, memory, network, storage } = telemetry;

  availability("cpu", Boolean(cpu));
  text("cpu-value", cpu ? number(cpu.usage, 0, "%") : "--%");
  drawGraph("cpu-graph", history.get("cpu"));
  text("cpu-detail", cpu
    ? detail([
      [cpu.temperature, (value) => temperature(value, settings.temperatureUnit)],
      [cpu.clockMHz, (value) => number(value, 0, " MHz")],
      [cpu.powerW, (value) => number(value, 0, " W")],
    ], cpu.name || "extended sensors unavailable")
    : "sensor unavailable");

  availability("gpu", Boolean(gpu));
  text("gpu-value", gpu ? number(gpu.usage, 0, "%") : "--%");
  drawGraph("gpu-graph", history.get("gpu"));
  text("gpu-detail", gpu
    ? `${temperature(gpu.temperature, settings.temperatureUnit)} · ${number(gpu.vramUsedGB, 1)} / ${number(gpu.vramTotalGB, 0, " GB")} · ${number(gpu.powerW, 0, " W")}`
    : "sensor unavailable");

  availability("memory", Boolean(memory));
  text("memory-value", memory ? number(memory.usage, 0, "%") : "--%");
  drawGraph("memory-graph", history.get("memory"));
  text("memory-detail", memory ? `${number(memory.usedGB, 1)} / ${number(memory.totalGB, 0, " GB")}` : "sensor unavailable");

  const networkHistory = history.get("network");
  const networkCeiling = Math.max(10, ...networkHistory);
  availability("network", Boolean(network));
  text("network-value", network
    ? `↓ ${networkRate(network.downloadMbps, settings.networkUnit)}  ↑ ${networkRate(network.uploadMbps, settings.networkUnit)}`
    : "↓ --  ↑ --");
  drawGraph("network-graph", networkHistory, networkCeiling);
  text("network-detail", network?.interface ? `active interface / ${network.interface}` : "active interface / unavailable");

  const storageUsage = Number.isFinite(storage?.usage) ? Math.min(100, Math.max(0, storage.usage)) : null;
  const nearlyFull = storageUsage !== null && storageUsage >= 90;
  availability("storage", storageUsage !== null);
  text("storage-value", storageUsage !== null ? number(storageUsage, 0, "%") : "--%");
  elements["storage-bar"].style.width = `${storageUsage ?? 0}%`;
  text("storage-io", storage ? `Read ${number(storage.readMBps, 1, " MB/s")} · Write ${number(storage.writeMBps, 1, " MB/s")}` : "Read -- · Write --");
  text("storage-detail", storage
    ? `${number(storage.usedGB, 0)} / ${number(storage.totalGB, 0, " GB")} · ${temperature(storage.temperature, settings.temperatureUnit)}`
    : "storage sensor unavailable");
  const indicator = elements["storage-indicator"];
  indicator.classList.toggle("is-nearly-full", nearlyFull);
  elements["storage-warning"].hidden = !nearlyFull;
  elements["storage-summary"].title = `${elements["storage-detail"].textContent}\n${elements["storage-io"].textContent}${nearlyFull ? "\nNearly full" : ""}\nClick for storage details`;
  indicator.hidden = !settings.showStorage;
  if (indicator.hidden) indicator.open = false;
}
