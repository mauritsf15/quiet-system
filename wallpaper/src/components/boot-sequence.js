const lines = [
  "quiet-system / boot",
  "mounting visual interface ............ ok",
  "binding local telemetry .............. pending",
  "loading 60-second history ............ ok",
  "registering media session ............ ok",
  "calibrating audio field .............. ok",
  "weather / local forecast ............ queued",
  "",
  "> system ready",
];

export function runBootSequence(enabled = true) {
  const overlay = document.getElementById("boot-sequence");
  const log = document.getElementById("boot-log");

  if (!enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    log.textContent = lines.join("\n");
    overlay.classList.add("is-complete");
    document.body.classList.add("is-ready");
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let index = 0;
    const write = () => {
      if (index < lines.length) {
        log.textContent += `${lines[index]}\n`;
        index += 1;
        window.setTimeout(write, index === lines.length ? 420 : 115 + Math.random() * 90);
        return;
      }
      document.body.classList.add("is-ready");
      overlay.classList.add("is-complete");
      window.setTimeout(resolve, 700);
    };
    write();
  });
}
