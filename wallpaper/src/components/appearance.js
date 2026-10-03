const KEY = "quiet-system-appearance-v3";
const defaults = { accent: "#83adbf", scale: 1, weather: true, storage: true };

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
  let saved;
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { saved = {}; }
  const values = { ...defaults, ...saved };

  function apply() {
    const accent = /^#[0-9a-f]{6}$/i.test(values.accent) ? values.accent : defaults.accent;
    const color = rgb(accent);
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-rgb", color.join(","));
    document.documentElement.style.setProperty("--scale", values.scale);
    store.update((state) => ({ ...state, settings: {
      ...state.settings, accentRgb: color, uiScale: values.scale,
      showWeather: values.weather,
      showStorage: values.storage,
    } }));
    try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* Storage may be disabled. */ }
  }

  for (const [key, input] of Object.entries(controls)) {
    input.type === "checkbox" ? input.checked = Boolean(values[key]) : input.value = String(values[key]);
    input.addEventListener("input", () => {
      values[key] = input.type === "checkbox" ? input.checked : input.type === "range" ? Number(input.value) : input.value;
      apply();
    });
  }
  document.getElementById("settings-button").addEventListener("click", () => dialog.showModal());
  apply();
}
