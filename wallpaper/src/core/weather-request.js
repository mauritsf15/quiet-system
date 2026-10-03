export function weatherEndpoint(kind) {
  const local = globalThis.location?.hostname === "127.0.0.1" && globalThis.location?.port === "9876";
  return new URL(local ? `/api/weather/${kind}` : kind === "locations"
    ? "https://geocoding-api.open-meteo.com/v1/search"
    : "https://api.open-meteo.com/v1/forecast", local ? globalThis.location.origin : undefined);
}

export async function fetchWeather(url, { signal } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 12000);
  try {
    return await fetch(url, { signal: controller.signal, cache: "no-store" });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Could not reach the weather service. Please try again.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
