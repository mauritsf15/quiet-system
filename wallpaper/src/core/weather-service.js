import { conditionFromCode } from "./format.js";

const WASSENAAR = { latitude: 52.145, longitude: 4.402 };
const REFRESH_MS = 15 * 60 * 1000;

export function startWeatherService(store) {
  let timer = 0;
  let wasEnabled = store.getState().settings.showWeather;

  async function refresh() {
    if (!store.getState().settings.showWeather) return;
    try {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", WASSENAAR.latitude);
      url.searchParams.set("longitude", WASSENAAR.longitude);
      url.searchParams.set("current", "temperature_2m,weather_code");
      url.searchParams.set("timezone", "Europe/Amsterdam");
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`weather ${response.status}`);
      const payload = await response.json();
      store.update((state) => ({
        ...state,
        weather: {
          available: Number.isFinite(payload.current?.temperature_2m),
          temperatureC: payload.current?.temperature_2m ?? null,
          condition: conditionFromCode(payload.current?.weather_code),
          updatedAt: Date.now(),
        },
      }));
    } catch {
      store.update((state) => ({
        ...state,
        weather: { ...state.weather, available: false, condition: "weather offline" },
      }));
    }
  }

  refresh();
  timer = window.setInterval(refresh, REFRESH_MS);
  const unsubscribe = store.subscribe((state) => {
    if (state.settings.showWeather && !wasEnabled) refresh();
    wasEnabled = state.settings.showWeather;
  });
  return () => {
    unsubscribe();
    window.clearInterval(timer);
  };
}
