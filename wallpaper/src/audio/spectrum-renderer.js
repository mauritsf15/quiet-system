export function smoothAudioLevel(current, target, elapsedMs) {
  if (Math.abs(target - current) < 0.0005) return target;
  const timeConstant = target > current ? 35 : 200;
  return current + (target - current) * (1 - Math.exp(-elapsedMs / timeConstant));
}

export function createSpectrumRenderer(container, count = 48) {
  const bars = Array.from({ length: count }, () => {
    const bar = document.createElement("i");
    bar.setAttribute("aria-hidden", "true");
    container.appendChild(bar);
    return bar;
  });
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let targets = new Array(count).fill(0);
  let visible = targets.slice();
  let frame = 0;
  let previousTime = 0;
  let staleTimer;
  let disposed = false;

  function paint() {
    bars.forEach((bar, index) => {
      bar.style.height = `${visible[index] * 100}%`;
      bar.style.opacity = String(0.32 + visible[index] * 0.68);
    });
  }

  function animate(time) {
    frame = 0;
    if (disposed) return;
    const elapsed = Math.max(0, time - previousTime);
    previousTime = time;
    visible = visible.map((value, index) => smoothAudioLevel(value, targets[index], elapsed));
    paint();
    if (visible.some((value, index) => value !== targets[index])) frame = window.requestAnimationFrame(animate);
  }

  function render() {
    if (motion.matches) {
      window.cancelAnimationFrame(frame);
      frame = 0;
      visible = targets.slice();
      paint();
    } else if (!frame) {
      previousTime = performance.now();
      frame = window.requestAnimationFrame(animate);
    }
  }

  motion.addEventListener("change", render);
  paint();
  return {
    update(levels, available = true) {
      if (disposed) return false;
      const input = available && Array.isArray(levels) ? levels : [];
      targets = targets.map((_, index) => {
        const value = Number(input[index]);
        return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
      });
      window.clearTimeout(staleTimer);
      if (available) {
        // A stalled connection must never leave a frozen spectrum on the desktop.
        staleTimer = window.setTimeout(() => { targets.fill(0); render(); }, 400);
        render();
      } else {
        window.cancelAnimationFrame(frame);
        frame = 0;
        visible.fill(0);
        paint();
      }
      return targets.some((value) => value > 0.04);
    },
    dispose() {
      disposed = true;
      window.clearTimeout(staleTimer);
      window.cancelAnimationFrame(frame);
      motion.removeEventListener("change", render);
    },
  };
}
