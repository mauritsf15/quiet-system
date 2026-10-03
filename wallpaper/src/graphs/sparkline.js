const BARS = "▁▂▃▄▅▆▇█";

export function sparkline(values, { width = 34, max = 100 } = {}) {
  const recent = values.slice(-width);
  const padding = Math.max(0, width - recent.length);
  const ceiling = Math.max(1, max);
  return `${"·".repeat(padding)}${recent.map((value) => {
    const index = Math.min(BARS.length - 1, Math.max(0, Math.round((value / ceiling) * (BARS.length - 1))));
    return BARS[index];
  }).join("")}`;
}

export function progressBar(value, width = 18) {
  if (!Number.isFinite(value)) return `[${"·".repeat(width)}]`;
  const filled = Math.round(Math.max(0, Math.min(100, value)) / 100 * width);
  return `[${"━".repeat(filled)}${"·".repeat(width - filled)}]`;
}
