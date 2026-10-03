const STALE_MS = 3500;

export function normalizeLyricLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.filter((line) => Number.isFinite(line?.at) && line.at >= 0 && typeof line.text === "string")
    .map((line) => ({ at: line.at, text: line.text.trim() })).sort((a, b) => a.at - b.at);
}

export function selectLyricPair(lines, position) {
  if (!Number.isFinite(position) || !lines.length) return { index: -1, current: "", next: "" };
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].at <= position) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  let next = index + 1;
  while (next < lines.length && !lines[next].text) next += 1;
  return { index, current: index >= 0 ? lines[index].text : "", next: lines[next]?.text || "" };
}

export class PlaybackClock {
  constructor() { this.reset(); }

  reset() {
    this.trackKey = "";
    this.position = null;
    this.anchorAt = 0;
    this.freshAt = -Infinity;
    this.rate = 0;
    this.duration = null;
    this.correction = 0;
    this.seek = false;
  }

  accept(media, now, wallNow) {
    const predicted = this.read(now);
    const lag = Number.isFinite(media.capturedAt) && media.capturedAt > 0
      ? Math.max(0, wallNow - media.capturedAt) : 0;
    const playing = media.state === "playing";
    const rate = Number.isFinite(media.playbackRate) && media.playbackRate > 0 ? media.playbackRate : 1;
    const target = Number.isFinite(media.position) ? media.position + (playing ? Math.min(lag, STALE_MS) / 1000 * rate : 0) : null;
    const changed = this.trackKey !== media.trackKey;
    this.seek = changed || (target !== null && predicted !== null && Math.abs(target - predicted) > 0.75);
    const smooth = !changed && !this.seek && playing && this.rate > 0 && target !== null && predicted !== null;
    this.position = smooth ? predicted : target;
    this.correction = smooth ? target - predicted : 0;
    this.anchorAt = now;
    this.freshAt = now - lag;
    this.trackKey = media.trackKey || "";
    this.duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null;
    this.rate = playing ? rate : 0;
  }

  isFresh(now) { return now - this.freshAt <= STALE_MS; }

  read(now) {
    if (this.position === null) return null;
    const elapsed = Math.max(0, now - this.anchorAt);
    const position = this.position + elapsed / 1000 * this.rate + this.correction * Math.min(1, elapsed / 200);
    return Math.max(0, this.duration === null ? position : Math.min(this.duration, position));
  }
}

export function installLyrics(store) {
  const viewport = document.getElementById("media-lyrics");
  const layers = Array.from(viewport.querySelectorAll(".lyric-pair"));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clock = new PlaybackClock();
  let media;
  let lines = [];
  let payloadKey = "";
  let activeLayer = 0;
  let signature = "";
  let animations = [];
  let cleanupTimer = 0;
  let frame;
  let stopped = false;
  let lastTick = -Infinity;

  function cancelAnimations() {
    animations.forEach((animation) => animation.cancel());
    animations = [];
  }

  function clearText() {
    cancelAnimations();
    layers.forEach((layer) => {
      layer.querySelector(".lyric-current").textContent = "";
      layer.querySelector(".lyric-next").textContent = "";
      layer.classList.remove("is-active");
      layer.setAttribute("aria-hidden", "true");
    });
    signature = "";
  }

  function hide(immediate = false) {
    viewport.classList.remove("is-visible");
    viewport.setAttribute("aria-hidden", "true");
    window.clearTimeout(cleanupTimer);
    if (immediate || reducedMotion.matches) clearText();
    else cleanupTimer = window.setTimeout(clearText, 220);
  }

  function renderPair(pair) {
    if (!pair.current && !pair.next) {
      if (viewport.classList.contains("is-visible")) hide();
      return;
    }
    const nextSignature = JSON.stringify([payloadKey, pair.index, pair.current, pair.next]);
    if (signature === nextSignature && viewport.classList.contains("is-visible")) return;
    window.clearTimeout(cleanupTimer);
    cancelAnimations();
    const wasVisible = viewport.classList.contains("is-visible");
    const oldLayer = layers[activeLayer];
    activeLayer = 1 - activeLayer;
    const newLayer = layers[activeLayer];
    newLayer.querySelector(".lyric-current").textContent = pair.current;
    newLayer.querySelector(".lyric-next").textContent = pair.next;
    oldLayer.classList.remove("is-active");
    oldLayer.setAttribute("aria-hidden", "true");
    newLayer.classList.add("is-active");
    newLayer.setAttribute("aria-hidden", "false");
    viewport.setAttribute("aria-hidden", "false");
    viewport.classList.add("is-visible");
    if (wasVisible && !reducedMotion.matches) {
      const options = { duration: 180, easing: "cubic-bezier(.2,.7,.2,1)" };
      animations = [
        oldLayer.animate([{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-4px)" }], options),
        newLayer.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }], options),
      ];
    }
    signature = nextSignature;
  }

  function tick(now) {
    if (stopped) return;
    if (now - lastTick >= 1000 / 30) {
      lastTick = now;
      const eligible = media?.enabled && ["playing", "paused"].includes(media.state)
        && media.title?.trim() && media.artist?.trim() && !["video", "image"].includes(media.mediaType)
        && media.trackKey && payloadKey === media.trackKey && clock.isFresh(now);
      if (eligible) renderPair(selectLyricPair(lines, clock.read(now)));
      else if (viewport.classList.contains("is-visible")) hide();
    }
    frame = window.requestAnimationFrame(tick);
  }

  const unsubscribe = store.subscribe((state) => {
    if (media === state.media) return;
    const changed = media?.trackKey !== state.media.trackKey;
    media = state.media;
    if (changed || !media.enabled || !["playing", "paused"].includes(media.state)) {
      lines = [];
      payloadKey = "";
      hide(true);
    }
    clock.accept(media, performance.now(), Date.now());
  });
  reducedMotion.addEventListener("change", cancelAnimations);
  frame = window.requestAnimationFrame(tick);

  return {
    receive(data) {
      if (!data || !media?.trackKey || data.trackKey !== media.trackKey) return;
      payloadKey = data.trackKey;
      lines = data.available ? normalizeLyricLines(data.lines) : [];
      if (!lines.length) hide();
    },
    disconnect() {
      clock.reset();
      lines = [];
      payloadKey = "";
      hide(true);
    },
    dispose() {
      stopped = true;
      unsubscribe();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(cleanupTimer);
      reducedMotion.removeEventListener("change", cancelAnimations);
      clearText();
    },
  };
}
