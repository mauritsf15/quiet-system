const GLYPHS = "01·:+×/<>[]{}#";

function seededPoints(width, height) {
  const points = [];
  const columns = Math.max(14, Math.floor(width / 86));
  const rows = Math.max(9, Math.floor(height / 82));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const seed = (row * 97 + column * 53) % 101;
      if (seed % 3 !== 0) continue;
      points.push({
        x: (column + 0.35 + (seed % 7) / 18) / columns * width,
        y: (row + 0.32 + (seed % 5) / 15) / rows * height,
        glyph: GLYPHS[seed % GLYPHS.length],
        phase: seed * 0.13,
      });
    }
  }
  return points;
}

function createClockGlyphs() {
  const container = document.getElementById("clock-glyphs");
  for (let index = 0; index < 52; index += 1) {
    const angle = index / 52 * Math.PI * 2 - Math.PI / 2;
    const radius = index % 5 === 0 ? 39 : 34.5;
    const glyph = document.createElement("span");
    glyph.textContent = index % 4 === 0 ? String(index).padStart(2, "0") : GLYPHS[index % GLYPHS.length];
    glyph.style.left = `${50 + Math.cos(angle) * radius}%`;
    glyph.style.top = `${50 + Math.sin(angle) * radius}%`;
    glyph.style.setProperty("--glyph-size", index % 4 === 0 ? ".5rem" : ".65rem");
    glyph.style.transform = `translate(-50%, -50%) rotate(${angle + Math.PI / 2}rad)`;
    container.appendChild(glyph);
  }
  return [...container.children];
}

export function startAmbientField(store, audio) {
  const canvas = document.getElementById("ambient-canvas");
  const context = canvas.getContext("2d", { alpha: true });
  const stage = document.querySelector(".clock-stage");
  const signal = document.getElementById("clock-signal");
  const clockGlyphs = createClockGlyphs();
  const pointer = { x: -1000, y: -1000, targetX: -1000, targetY: -1000 };
  let points = [];
  let frame = 0;
  let lastFrame = 0;
  let running = true;

  function resize() {
    const ratio = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    points = seededPoints(window.innerWidth, window.innerHeight);
  }

  function draw(time, audioState, state, motion) {
    const { level: audioLevel, bass, peak } = audioState;
    const { accentRgb } = state.settings;
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    pointer.x += (pointer.targetX - pointer.x) * 0.09;
    pointer.y += (pointer.targetY - pointer.y) * 0.09;

    for (const point of points) {
      const distance = Math.hypot(pointer.x - point.x, pointer.y - point.y);
      const proximity = Math.max(0, 1 - distance / 155);
      const breathe = 0.5 + Math.sin(time * 0.00035 * motion + point.phase) * 0.5;
      const alpha = 0.035 + breathe * 0.025 + proximity * 0.72 + audioLevel * 0.045;
      context.fillStyle = `rgba(${accentRgb.join(",")},${alpha})`;
      context.font = `${10 + proximity * 3}px "Cascadia Code", monospace`;
      context.fillText(point.glyph, point.x, point.y);
    }

    const glow = context.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 180);
    glow.addColorStop(0, `rgba(${accentRgb.join(",")},${0.055 * motion})`);
    glow.addColorStop(1, `rgba(${accentRgb.join(",")},0)`);
    context.fillStyle = glow;
    context.fillRect(pointer.x - 180, pointer.y - 180, 360, 360);

    stage.style.setProperty("--audio-scale", String(bass * 0.055));
    stage.style.setProperty("--audio-rotation", `${audioLevel * 10}deg`);
    stage.style.setProperty("--audio-glow", String(Math.min(1, audioLevel * 1.4 + peak * 0.35)));
    signal.textContent = `SIGNAL ${String(Math.round(audioLevel * 999)).padStart(3, "0")}`;
    clockGlyphs.forEach((glyph, index) => {
      const pulse = Math.max(0, audioLevel * (1.35 - (index % 7) * 0.06));
      glyph.style.setProperty("--glyph-alpha", String(0.07 + pulse * 0.55));
    });
  }

  function loop(time) {
    if (!running) return;
    const state = store.getState();
    const utilization = Math.max(state.telemetry.cpu?.usage ?? 0, state.telemetry.gpu?.usage ?? 0);
    const loadDamping = utilization >= 90 ? 0.3 : utilization >= 80 ? 0.6 : 1;
    const motion = state.settings.animationIntensity * loadDamping;
    const fps = document.hidden ? 5 : utilization >= 90 ? Math.min(15, state.settings.fps) : state.settings.fps;
    if (time - lastFrame >= 1000 / fps) {
      const audioState = audio.update(time, motion);
      draw(time, audioState, state, motion);
      lastFrame = time;
    }
    frame = window.requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("pointermove", (event) => {
    pointer.targetX = event.clientX;
    pointer.targetY = event.clientY;
  }, { passive: true });
  window.addEventListener("pointerleave", () => {
    pointer.targetX = -1000;
    pointer.targetY = -1000;
  });

  resize();
  frame = window.requestAnimationFrame(loop);
  return () => {
    running = false;
    window.cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
  };
}
