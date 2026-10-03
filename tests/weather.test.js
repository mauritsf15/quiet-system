import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLocation, searchLocations, detectLocation } from "../wallpaper/src/core/weather-location.js";
import { startWeatherService } from "../wallpaper/src/core/weather-service.js";
import { createStore } from "../wallpaper/src/core/store.js";

function harness(t) {
  const oldFetch = globalThis.fetch;
  const oldWindow = globalThis.window;
  const calls = [];
  globalThis.window = { setInterval: () => 1, clearInterval: () => {} };
  globalThis.fetch = (url, options) => new Promise((resolve) => calls.push({ url, options, resolve }));
  t.after(() => { globalThis.fetch = oldFetch; globalThis.window = oldWindow; });
  const store = createStore({ settings: { showWeather: true, weatherLocation: null }, weather: { available: false } });
  const select = (location) => store.update((state) => ({ ...state, settings: { ...state.settings, weatherLocation: location } }));
  return { store, calls, select };
}
const response = (temperature) => ({ ok: true, json: async () => ({ current: { temperature_2m: temperature, weather_code: 0 } }) });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("weather makes no requests until the user chooses a valid location", (t) => {
  const app = harness(t);
  const dispose = startWeatherService(app.store);
  assert.equal(app.calls.length, 0);
  assert.match(app.store.getState().weather.condition, /choose a location/);
  app.select({ latitude: 91, longitude: 10 });
  assert.equal(app.calls.length, 0);
  app.select({ name: "Test city", latitude: 51.123456, longitude: -1.234567 });
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].url.searchParams.get("latitude"), "51.123");
  assert.equal(app.calls[0].url.searchParams.get("longitude"), "-1.235");
  assert.equal(app.calls[0].url.searchParams.get("timezone"), "auto");
  dispose();
});

test("changing location or disabling weather rejects old responses", async (t) => {
  const app = harness(t);
  const dispose = startWeatherService(app.store);
  app.select({ name: "First", latitude: 10, longitude: 20 });
  app.select({ name: "Second", latitude: 30, longitude: 40 });
  assert.equal(app.calls[0].options.signal.aborted, true);
  app.calls[1].resolve(response(15));
  await tick();
  app.calls[0].resolve(response(99));
  await tick();
  assert.equal(app.store.getState().weather.temperatureC, 15);
  app.select({ name: "Third", latitude: 50, longitude: 60 });
  app.store.update((state) => ({ ...state, settings: { ...state.settings, showWeather: false } }));
  app.calls[2].resolve(response(25));
  await tick();
  assert.equal(app.store.getState().weather.available, false);
  assert.equal(app.store.getState().weather.temperatureC, null);
  dispose();
});

test("disposing weather prevents pending requests from updating the store", async (t) => {
  const app = harness(t);
  const dispose = startWeatherService(app.store);
  app.select({ latitude: 10, longitude: 20 });
  dispose();
  app.calls[0].resolve(response(15));
  await tick();
  assert.equal(app.calls[0].options.signal.aborted, true);
  assert.equal(app.store.getState().weather.available, false);
});

test("city search keeps disambiguating region and country and filters invalid coordinates", async (t) => {
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  globalThis.fetch = async (url) => {
    assert.equal(url.searchParams.get("name"), "Berlin");
    return { ok: true, json: async () => ({ results: [
      { name: "Berlin", admin1: "Berlin", country: "Germany", latitude: 52.52, longitude: 13.405 },
      { name: "Invalid", latitude: 200, longitude: 13 },
    ] }) };
  };
  const matches = await searchLocations(" Berlin ");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, "Berlin, Berlin, Germany");
  assert.equal(normalizeLocation({ latitude: "10", longitude: 20 }), null);
});

test("device location is optional and denial has a city-search fallback", async (t) => {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    geolocation: { getCurrentPosition: (_success, failure) => failure({ code: 1 }) },
  } });
  t.after(() => {
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator);
    else delete globalThis.navigator;
  });
  await assert.rejects(detectLocation(), /Search for your city/);
});
