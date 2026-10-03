const root = document.documentElement;

function propertyValue(properties, key, fallback) {
  return properties[key] ? properties[key].value : fallback;
}

function colorToRgb(value) {
  if (typeof value !== "string") return [112, 190, 255];
  return value.split(" ").slice(0, 3).map((channel) => Math.round(Number(channel) * 255));
}

function textBrightness(value) {
  const light = Math.round(185 + Number(value) * 60);
  const muted = Math.round(76 + Number(value) * 48);
  root.style.setProperty("--text", `rgb(${light}, ${light + 3}, ${Math.min(255, light + 6)})`);
  root.style.setProperty("--muted", `rgb(${muted}, ${muted + 8}, ${muted + 14})`);
}

export function installSettings(store) {
  function apply(properties) {
    const previous = store.getState().settings;
    const accentRgb = properties.accentcolor ? colorToRgb(properties.accentcolor.value) : previous.accentRgb;
    const settings = {
      ...previous,
      accentRgb,
      uiScale: Number(propertyValue(properties, "uiscale", previous.uiScale)),
      brightness: Number(propertyValue(properties, "brightness", previous.brightness)),
      animationIntensity: Number(propertyValue(properties, "animationintensity", previous.animationIntensity)),
      glowStrength: Number(propertyValue(properties, "glowstrength", previous.glowStrength)),
      scanlines: Number(propertyValue(properties, "scanlines", previous.scanlines)),
      bootSequence: Boolean(propertyValue(properties, "bootsequence", previous.bootSequence)),
      showMedia: Boolean(propertyValue(properties, "showmedia", previous.showMedia)),
      showWeather: Boolean(propertyValue(properties, "showweather", previous.showWeather)),
      showStorage: Boolean(propertyValue(properties, "showstorage", previous.showStorage)),
      showClock: Boolean(propertyValue(properties, "showclock", previous.showClock)),
      clock24Hour: Boolean(propertyValue(properties, "clock24hour", previous.clock24Hour)),
      temperatureUnit: String(propertyValue(properties, "temperatureunit", previous.temperatureUnit)),
      networkUnit: String(propertyValue(properties, "networkunit", previous.networkUnit)),
      telemetryRate: Number(propertyValue(properties, "telemetryrate", previous.telemetryRate)),
    };

    root.style.setProperty("--accent-rgb", settings.accentRgb.join(", "));
    root.style.setProperty("--ui-scale", settings.uiScale);
    root.style.setProperty("--motion", settings.animationIntensity);
    root.style.setProperty("--glow", settings.glowStrength);
    root.style.setProperty("--scanline-opacity", settings.scanlines);
    textBrightness(settings.brightness);
    document.body.classList.toggle("reduced-motion", settings.animationIntensity === 0);
    store.update((state) => ({ ...state, settings }));
  }

  window.wallpaperPropertyListener = {
    applyUserProperties: apply,
    applyGeneralProperties(properties) {
      if (!properties.fps) return;
      const fps = Math.max(10, Math.min(30, Number(properties.fps)));
      store.update((state) => ({ ...state, settings: { ...state.settings, fps } }));
    },
  };

  apply({});
}
