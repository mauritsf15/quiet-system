const RAMP = " .:-=+*#%@";

export function pixelsToAscii(data, width, height) {
  const luminance = [];
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3] / 255;
    luminance.push((0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) * alpha);
  }
  const sorted = [...luminance].sort((a, b) => a - b);
  const percentileLow = sorted[Math.floor(sorted.length * 0.04)] ?? 0;
  const percentileHigh = sorted[Math.floor(sorted.length * 0.96)] ?? 255;
  const hasUsefulContrast = percentileHigh - percentileLow >= 24;
  const low = hasUsefulContrast ? percentileLow : 0;
  const range = hasUsefulContrast ? percentileHigh - percentileLow : 255;
  const lines = [];
  for (let y = 0; y < height; y += 1) {
    let line = "";
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const normalized = Math.max(0, Math.min(1, (luminance[y * width + x] - low) / range));
      const index = Math.round(Math.pow(normalized, 0.88) * (RAMP.length - 1));
      line += RAMP[index];
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export async function imageToAscii(source, canvas) {
  if (!source) return "";
  const image = new Image();
  image.src = source;
  await image.decode();

  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  // The character grid is 2:1 because a monospace cell is roughly twice as
  // tall as it is wide. Sampling the full square cover preserves its shape.
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return pixelsToAscii(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}

export function proceduralAscii(width = 48, height = 24) {
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
    const dx = x / width - 0.5;
    const dy = y / height - 0.5;
    const value = (Math.sin(x * 0.41) + Math.cos(y * 0.73) + Math.sin((dx * dx + dy * dy) * 36)) / 3;
    return RAMP[Math.round(((value + 1) / 2) * (RAMP.length - 1))];
  }).join("")).join("\n");
}
