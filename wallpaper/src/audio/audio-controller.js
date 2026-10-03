import { clamp } from "../core/format.js";

const BAR_COUNT = 32;

function downsample(samples) {
  const result = new Array(BAR_COUNT).fill(0);
  for (let index = 0; index < BAR_COUNT; index += 1) {
    const left = Math.min(1, samples[index * 2] ?? 0);
    const right = Math.min(1, samples[64 + index * 2] ?? 0);
    // Wallpaper Engine's normalized signal is intentionally conservative.
    // A soft power curve makes quiet music legible without clipping loud tracks.
    result[index] = Math.pow((left + right) / 2, 0.62);
  }
  return result;
}

export function createAudioController({ enabled = true, simulate = true } = {}) {
  const container = document.getElementById("audio-spectrum");
  const bars = Array.from({ length: BAR_COUNT }, () => {
    const bar = document.createElement("i");
    container.appendChild(bar);
    return bar;
  });
  let target = new Array(BAR_COUNT).fill(0);
  const smoothed = new Array(BAR_COUNT).fill(0);
  const supported = enabled && typeof window.wallpaperRegisterAudioListener === "function";

  if (supported) {
    window.wallpaperRegisterAudioListener((samples) => {
      target = downsample(samples);
    });
  }

  return {
    supported,
    update(time, intensity = 0.6) {
      if (!supported && simulate && enabled) {
        target = target.map((_, index) => {
          const bassBias = 1 - index / BAR_COUNT * 0.55;
          return (0.1 + (Math.sin(time * 0.0024 + index * 0.73) + 1) * 0.12) * bassBias;
        });
      }
      let energy = 0;
      let peak = 0;
      for (let index = 0; index < BAR_COUNT; index += 1) {
        const attack = target[index] > smoothed[index] ? 0.32 : 0.09;
        smoothed[index] += (target[index] - smoothed[index]) * attack;
        const value = clamp(smoothed[index] * intensity, 0, 1);
        bars[index].style.transform = `scaleY(${1 + value * 8})`;
        bars[index].style.opacity = String(0.2 + value * 0.8);
        energy += value * value;
        peak = Math.max(peak, value);
      }
      const rms = Math.sqrt(energy / BAR_COUNT);
      const bass = smoothed.slice(0, 8).reduce((sum, value) => sum + value, 0) / 8 * intensity;
      return {
        values: smoothed,
        level: clamp(rms * 1.65, 0, 1),
        bass: clamp(bass * 1.8, 0, 1),
        peak: clamp(peak * intensity, 0, 1),
      };
    },
  };
}
