import test from "node:test";
import assert from "node:assert/strict";
import { installAppearance } from "../wallpaper/src/components/appearance.js";
import { createStore } from "../wallpaper/src/core/store.js";

const KEY = "quiet-system-appearance-v3";

function appearanceHarness(t, saved = null) {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const controls = Object.fromEntries([
    ["setting-accent", "color"], ["setting-scale", "range"],
    ["setting-weather", "checkbox"], ["setting-storage", "checkbox"],
    ["settings-button", "button"],
  ].map(([id, type]) => [id, Object.assign(new EventTarget(), { type, value: "", checked: false })]));
  controls["settings-dialog"] = { opened: false, showModal() { this.opened = true; } };
  const properties = new Map();
  const savedValues = new Map(saved === null ? [] : [[KEY, saved]]);
  let writes = 0;
  const storage = {
    getItem: (key) => savedValues.get(key) ?? null,
    setItem: (key, value) => { savedValues.set(key, value); writes += 1; },
  };
  const browser = Object.assign(new EventTarget(), { localStorage: storage });
  globalThis.window = browser;
  globalThis.document = {
    getElementById: (id) => controls[id],
    documentElement: { style: { setProperty: (key, value) => properties.set(key, String(value)) } },
  };
  t.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else delete globalThis.window;
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else delete globalThis.document;
  });
  const store = createStore({ settings: { clock24Hour: true } });
  return {
    controls, properties, store, storage, browser,
    saved: () => JSON.parse(savedValues.get(KEY)),
    writes: () => writes,
    storageEvent(value, key = KEY, storageArea = storage) {
      browser.dispatchEvent(Object.assign(new Event("storage"), { key, newValue: value, storageArea }));
    },
  };
}

test("appearance repairs malformed saved preferences before applying or displaying them", (t) => {
  const app = appearanceHarness(t, JSON.stringify({ accent: "red", scale: "large", weather: "false", storage: null }));
  installAppearance(app.store);
  assert.deepEqual(app.saved(), { accent: "#83adbf", scale: 1, weather: true, storage: true });
  assert.equal(app.controls["setting-accent"].value, "#83adbf");
  assert.equal(app.controls["setting-scale"].value, "1");
  assert.equal(app.properties.get("--scale"), "1");
  assert.equal(app.store.getState().settings.showWeather, true);
  assert.equal(app.store.getState().settings.clock24Hour, true);
});

test("appearance bounds a restored scale to the range shown by its control", (t) => {
  const app = appearanceHarness(t, JSON.stringify({ scale: 5, weather: false, storage: false }));
  installAppearance(app.store);
  assert.equal(app.saved().scale, 1.15);
  assert.equal(app.controls["setting-scale"].value, "1.15");
  assert.equal(app.store.getState().settings.uiScale, 1.15);
  assert.equal(app.store.getState().settings.showStorage, false);
  app.controls["setting-scale"].value = "0.987";
  app.controls["setting-scale"].dispatchEvent(new Event("input"));
  assert.equal(app.saved().scale, 0.99);
  assert.equal(app.properties.get("--scale"), "0.99");
});

test("a second wallpaper window updates appearance and controls without writing back", (t) => {
  const app = appearanceHarness(t);
  const dispose = installAppearance(app.store);
  const initialWrites = app.writes();
  app.storageEvent(JSON.stringify({ accent: "#123456", scale: 0.85, weather: false, storage: false }));
  assert.equal(app.writes(), initialWrites);
  assert.equal(app.controls["setting-accent"].value, "#123456");
  assert.equal(app.controls["setting-scale"].value, "0.85");
  assert.equal(app.controls["setting-weather"].checked, false);
  assert.equal(app.controls["setting-storage"].checked, false);
  assert.equal(app.properties.get("--accent-rgb"), "18,52,86");
  assert.equal(app.store.getState().settings.showWeather, false);
  assert.equal(app.store.getState().settings.uiScale, 0.85);
  app.storageEvent(null, "unrelated-setting");
  assert.equal(app.controls["setting-scale"].value, "0.85");
  app.storageEvent(null, null);
  assert.equal(app.controls["setting-scale"].value, "1");
  assert.equal(app.store.getState().settings.showWeather, true);
  dispose();
  app.storageEvent(JSON.stringify({ scale: 1.15 }));
  assert.equal(app.store.getState().settings.uiScale, 1);
});

test("appearance remains usable when browser storage is disabled", (t) => {
  const app = appearanceHarness(t);
  Object.defineProperty(app.browser, "localStorage", { get() { throw new Error("Storage denied"); } });
  assert.doesNotThrow(() => installAppearance(app.store));
  app.controls["setting-weather"].checked = false;
  assert.doesNotThrow(() => app.controls["setting-weather"].dispatchEvent(new Event("input")));
  assert.equal(app.store.getState().settings.showWeather, false);
});
