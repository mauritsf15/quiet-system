export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function number(value, digits = 0, suffix = "") {
  return Number.isFinite(value) ? `${value.toFixed(digits)}${suffix}` : "--";
}

export function temperature(valueC, unit = "c") {
  if (!Number.isFinite(valueC)) return "--";
  const value = unit === "f" ? valueC * 9 / 5 + 32 : valueC;
  return `${Math.round(value)}°${unit.toUpperCase()}`;
}

export function bytes(value, digits = 1) {
  if (!Number.isFinite(value)) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  let scaled = value;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(unit === 0 ? 0 : digits)} ${units[unit]}`;
}

export function networkRate(mbps, mode = "auto") {
  if (!Number.isFinite(mbps)) return "--";
  if (mode === "mbs") return `${(mbps / 8).toFixed(1)} MB/s`;
  if (mode === "mbps") return `${mbps.toFixed(1)} Mb/s`;
  if (mbps >= 1) return `${mbps.toFixed(mbps >= 100 ? 0 : 1)} Mb/s`;
  return `${(mbps * 1000).toFixed(0)} Kb/s`;
}

export function duration(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

export function uptime(seconds) {
  if (!Number.isFinite(seconds)) return "uptime --";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `uptime ${days}d ${String(hours).padStart(2, "0")}h`;
  return `uptime ${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function conditionFromCode(code) {
  if (code === 0) return "clear";
  if ([1, 2, 3].includes(code)) return "cloud cover";
  if ([45, 48].includes(code)) return "fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([95, 96, 99].includes(code)) return "storm";
  return "conditions unknown";
}
