const KEY = "quiet-system-appearance-v3";
const defaults = { accent: "#83adbf", scale: 1, weather: true, storage: true };

function normalize(saved) {
  const value = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  return {
    accent: typeof value.accent === "string" && /^#[0-9a-f]{6}$/i.test(value.accent) ? value.accent : defaults.accent,
    scale: typeof value.scale === "number" && Number.isFinite(value.scale)
      ? Math.round(Math.max(0.85, Math.min(1.15, value.scale)) * 100) / 100
      : defaults.scale,
    weather: typeof value.weather === "boolean" ? value.weather : defaults.weather,
    storage: typeof value.storage === "boolean" ? value.storage : defaults.storage,
  };
}

function parseSaved(value) {
  try { return normalize(JSON.parse(value || "{}")); } catch { return { ...defaults }; }
}

function rgb(hex) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

export function installAppearance(store) {
  const dialog = document.getElementById("settings-dialog");
  const controls = {
    accent: document.getElementById("setting-accent"),
    scale: document.getElementById("setting-scale"),
    weather: document.getElementById("setting-weather"),
    storage: document.getElementById("setting-storage"),
  };
  let storage;
  let values = { ...defaults };
  try {
    storage = window.localStorage;
    values = parseSaved(storage.getItem(KEY));
  } catch { /* Storage may be disabled. */ }

  function apply(persist = true) {
    values = normalize(values);
    const color = rgb(values.accent);
    for (const [key, input] of Object.entries(controls)) {
      if (input.type === "checkbox") input.checked = values[key];
      else input.value = String(values[key]);
    }
    document.documentElement.style.setProperty("--accent", values.accent);
    document.documentElement.style.setProperty("--accent-rgb", color.join(","));
    document.documentElement.style.setProperty("--scale", values.scale);
    store.update((state) => ({ ...state, settings: {
      ...state.settings, accentRgb: color, uiScale: values.scale,
      showWeather: values.weather,
      showStorage: values.storage,
    } }));
    if (persist) {
      try { storage?.setItem(KEY, JSON.stringify(values)); } catch { /* Storage may be disabled. */ }
    }
  }

  const listeners = [];
  for (const [key, input] of Object.entries(controls)) {
    const onInput = () => {
      values[key] = input.type === "checkbox" ? input.checked : input.type === "range" ? Number(input.value) : input.value;
      apply();
    };
    input.addEventListener("input", onInput);
    listeners.push(() => input.removeEventListener("input", onInput));
  }
  const button = document.getElementById("settings-button");
  const openDialog = () => dialog.showModal();
  const onStorage = (event) => {
    if (event.storageArea !== storage || (event.key !== KEY && event.key !== null)) return;
    values = parseSaved(event.newValue);
    apply(false);
  };
  button.addEventListener("click", openDialog);
  window.addEventListener("storage", onStorage);
  apply();
  return () => {
    listeners.forEach((remove) => remove());
    button.removeEventListener("click", openDialog);
    window.removeEventListener("storage", onStorage);
  };
}
