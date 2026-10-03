import { normalizeLocation, searchLocations, detectLocation } from "../core/weather-location.js";

const KEY = "quiet-system-appearance-v3";
const defaults = { accent: "#83adbf", scale: 1, weather: true, storage: true, location: null };

function normalize(saved) {
  const value = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  return {
    accent: typeof value.accent === "string" && /^#[0-9a-f]{6}$/i.test(value.accent) ? value.accent : defaults.accent,
    scale: typeof value.scale === "number" && Number.isFinite(value.scale)
      ? Math.round(Math.max(0.85, Math.min(1.15, value.scale)) * 100) / 100
      : defaults.scale,
    weather: typeof value.weather === "boolean" ? value.weather : defaults.weather,
    storage: typeof value.storage === "boolean" ? value.storage : defaults.storage,
    location: normalizeLocation(value.location),
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
      weatherLocation: values.location,
    } }));
    if (persist) {
      try { storage?.setItem(KEY, JSON.stringify(values)); } catch { /* Storage may be disabled. */ }
    }
  }

  const listeners = [];
  const city = document.getElementById("setting-city");
  const search = document.getElementById("location-search");
  const detect = document.getElementById("location-detect");
  const choices = document.getElementById("location-results");
  const status = document.getElementById("location-status");
  let locations = [];
  let locationRequest = 0;
  let searchController;
  let disposed = false;
  function showLocation() {
    if (status) status.textContent = values.location ? `Weather for ${values.location.name}` : "Choose a city to enable local weather.";
  }
  async function locate(useDevice = false) {
    const request = ++locationRequest;
    searchController?.abort();
    searchController = new AbortController();
    choices.hidden = true;
    status.textContent = useDevice ? "Finding your location…" : "Searching…";
    try {
      if (useDevice) {
        const location = await detectLocation();
        if (disposed || request !== locationRequest) return;
        values.location = location;
        apply();
        showLocation();
      } else {
        const matches = await searchLocations(city.value, { signal: searchController.signal });
        if (disposed || request !== locationRequest) return;
        locations = matches;
        choices.replaceChildren(new Option("Choose a location…", ""),
          ...locations.map((location, index) => new Option(location.name, String(index))));
        choices.hidden = locations.length === 0;
        status.textContent = locations.length ? "Choose the matching city below." : "No matches. Try a city name or postal code.";
      }
    } catch (error) {
      if (!disposed && request === locationRequest && error.name !== "AbortError") status.textContent = error.message;
    }
  }
  if (city && search && detect && choices && status) {
    const onSearch = () => locate();
    const onDetect = () => locate(true);
    const onCityKey = (event) => { if (event.key === "Enter") { event.preventDefault(); locate(); } };
    const onChoice = () => {
      if (choices.value === "") return;
      const location = locations[Number(choices.value)];
      if (!location) return;
      values.location = location;
      apply();
      showLocation();
      choices.hidden = true;
    };
    search.addEventListener("click", onSearch);
    detect.addEventListener("click", onDetect);
    city.addEventListener("keydown", onCityKey);
    choices.addEventListener("change", onChoice);
    listeners.push(() => {
      search.removeEventListener("click", onSearch);
      detect.removeEventListener("click", onDetect);
      city.removeEventListener("keydown", onCityKey);
      choices.removeEventListener("change", onChoice);
    });
  }
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
    showLocation();
  };
  button.addEventListener("click", openDialog);
  window.addEventListener("storage", onStorage);
  apply();
  showLocation();
  return () => {
    disposed = true;
    searchController?.abort();
    listeners.forEach((remove) => remove());
    button.removeEventListener("click", openDialog);
    window.removeEventListener("storage", onStorage);
  };
}
