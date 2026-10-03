import { conditionFromCode } from "./format.js";
import { normalizeLocation } from "./weather-location.js";

const REFRESH_MS = 15 * 60 * 1000;

export function startWeatherService(store) {
  let generation = 0;
  let controller;
  let disposed = false;
  const locationKey = () => JSON.stringify([store.getState().settings.showWeather,
    normalizeLocation(store.getState().settings.weatherLocation)]);
  let previousKey = locationKey();

  async function refresh() {
    const request = ++generation;
    controller?.abort();
    const settings = store.getState().settings;
    const location = normalizeLocation(settings.weatherLocation);
    if (disposed) return;
    if (!settings.showWeather || !location) {
      store.update((state) => ({ ...state, weather: { ...state.weather,
        available: false, temperatureC: null, condition: location ? "disabled" : "choose a location in settings" } }));
      return;
    }
    controller = new AbortController();
    store.update((state) => ({ ...state, weather: { ...state.weather, available: false, condition: "acquiring" } }));
    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", location.latitude);
      url.searchParams.set("longitude", location.longitude);
      url.searchParams.set("current", "temperature_2m,weather_code");
      url.searchParams.set("timezone", "auto");
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`weather ${response.status}`);
      const payload = await response.json();
      if (disposed || request !== generation) return;
      store.update((state) => ({
        ...state,
        weather: {
          available: Number.isFinite(payload.current?.temperature_2m),
          temperatureC: payload.current?.temperature_2m ?? null,
          condition: conditionFromCode(payload.current?.weather_code),
          updatedAt: Date.now(),
        },
      }));
    } catch (error) {
      if (disposed || request !== generation || error.name === "AbortError") return;
      store.update((state) => ({
        ...state,
        weather: { ...state.weather, available: false, condition: "weather offline" },
      }));
    }
  }

  const unsubscribe = store.subscribe(() => {
    const key = locationKey();
    if (key === previousKey) return;
    previousKey = key;
    refresh();
  });
  refresh();
  const timer = window.setInterval(refresh, REFRESH_MS);
  return () => {
    disposed = true;
    generation++;
    controller?.abort();
    unsubscribe();
    window.clearInterval(timer);
  };
}
