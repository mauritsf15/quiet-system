import { duration } from "../core/format.js";

export function installPlaybackControls(store, { localCompanion }) {
  const el = (id) => document.getElementById(id);
  const controls = el("media-controls");
  if (!controls) return () => {};
  const previous = el("media-previous"), toggle = el("media-toggle"), next = el("media-next");
  const seek = el("media-seek"), progress = el("media-progress-fill"), position = el("media-position");
  const status = el("media-control-status"), holder = el("album-art"), stateLabel = el("media-state");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = [];
  let media, identity = "", token, request, busy = false, scrubbing = false, stopped = false;
  let artwork, artGeneration = 0, artAnimation, stateAnimation, displayedState;
  let lastPosition = null;
  let scrubKey = null, scrubCancelled = false;

  function listen(node, event, callback) {
    node.addEventListener(event, callback);
    listeners.push(() => node.removeEventListener(event, callback));
  }
  function active() {
    return media?.enabled && ["playing", "paused"].includes(media.state);
  }
  function available() {
    return localCompanion && active() && Boolean(media.sessionId && media.trackKey);
  }
  function showPosition(value, immediate = false) {
    const percent = active() && Number.isFinite(value) && media.duration > 0
      ? Math.max(0, Math.min(100, value / media.duration * 100)) : 0;
    if (immediate) {
      progress.style.transition = "none";
      progress.style.width = `${percent}%`;
      // Flush the immediate seek/reset before restoring ordinary progress easing.
      void progress.offsetWidth;
      progress.style.transition = "";
    } else progress.style.width = `${percent}%`;
    seek.value = Number.isFinite(value) ? value : 0;
    position.textContent = active() ? duration(value) : "--:--";
    seek.setAttribute("aria-valuetext", `${duration(value)} of ${duration(media.duration)}`);
  }
  function updateArtwork(src) {
    if (src === artwork) return;
    artwork = src;
    const generation = ++artGeneration;
    const replace = (node) => {
      if (stopped || generation !== artGeneration) return;
      artAnimation?.cancel();
      holder.replaceChildren(node);
      if (!motion.matches) artAnimation = node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
    };
    const fallback = () => replace(Object.assign(document.createElement("span"), { textContent: "no art" }));
    if (!src) { fallback(); return; }
    const image = document.createElement("img");
    image.alt = "Album artwork";
    image.onload = () => replace(image);
    image.onerror = fallback;
    image.src = src;
  }
  function render(state) {
    media = state.media;
    const key = `${media.sessionId}:${media.trackKey}`;
    const changed = key !== identity;
    if (changed || !active()) {
      if (scrubbing || scrubKey !== null) scrubCancelled = true;
      identity = key;
      scrubbing = false;
      request?.abort();
      status.textContent = "";
    }
    const caps = media.capabilities || {};
    const usable = available() && !busy;
    const action = media.state === "playing" ? "pause" : "play";
    previous.disabled = !usable || !caps.previous;
    next.disabled = !usable || !caps.next;
    toggle.disabled = !usable || !caps[action];
    toggle.setAttribute("aria-label", action === "pause" ? "Pause" : "Play");
    toggle.title = action === "pause" ? "Pause" : "Play";
    toggle.dataset.action = action;
    const canSeek = caps.seek && Number.isFinite(media.duration) && media.duration > 0 &&
      Number.isFinite(media.seekMin) && Number.isFinite(media.seekMax) && media.seekMin >= 0 &&
      media.seekMax > media.seekMin && media.seekMax <= media.duration;
    seek.disabled = !usable || !canSeek;
    seek.min = canSeek ? media.seekMin : 0;
    seek.max = canSeek ? media.seekMax : Math.max(1, media.duration || 1);
    if (!usable || !canSeek) scrubbing = false;
    controls.setAttribute("aria-busy", String(busy));
    if (changed || !active() || (!scrubbing && !(busy && request?.seek))) {
      const jumped = lastPosition !== null && Number.isFinite(media.position) && Math.abs(media.position - lastPosition) > 2;
      showPosition(media.position, changed || jumped || !active());
      lastPosition = media.position;
    }
    el("media-duration").textContent = active() ? duration(media.duration) : "--:--";
    updateArtwork(active() ? media.thumbnail || "" : "");
    if (displayedState !== media.state) {
      const first = displayedState === undefined;
      displayedState = media.state;
      stateAnimation?.cancel();
      if (!first && !motion.matches) stateAnimation = stateLabel.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
    }
  }
  async function command(action, positionSeconds) {
    if (busy || !available() || !media.capabilities?.[action]) return;
    const body = { sessionId: media.sessionId, trackKey: media.trackKey, action,
      ...(action === "seek" ? { positionSeconds } : {}) };
    const key = identity;
    const controller = new AbortController();
    controller.seek = action === "seek";
    request = controller;
    busy = true;
    status.textContent = "";
    render(store.getState());
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 3000);
    try {
      if (!token) {
        const response = await fetch("/api/session", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Local companion unavailable");
        token = (await response.json()).token;
      }
      if (controller.signal.aborted || stopped || identity !== key) return;
      const response = await fetch("/api/media/control", { method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Session-Token": token }, body: JSON.stringify(body) });
      if (response.status === 403) token = null;
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Media controls unavailable");
    } catch (error) {
      if (!stopped && key === identity && active() && (!controller.signal.aborted || timedOut))
        status.textContent = timedOut ? "The player took too long. Try again." : error.message;
    } finally {
      window.clearTimeout(timer);
      if (request === controller) {
        request = null;
        busy = false;
        if (!stopped) render(store.getState());
      }
    }
  }
  listen(previous, "click", () => command("previous"));
  listen(next, "click", () => command("next"));
  listen(toggle, "click", () => command(media.state === "playing" ? "pause" : "play"));
  listen(seek, "pointerdown", () => { if (!seek.disabled) { scrubKey = identity; scrubCancelled = false; } });
  listen(seek, "input", () => {
    if (seek.disabled || scrubCancelled) return;
    scrubKey ??= identity;
    scrubbing = true;
    showPosition(Number(seek.value), true);
  });
  listen(seek, "change", () => {
    if (scrubCancelled || (scrubKey !== null && scrubKey !== identity)) { cancelScrub(); return; }
    if (seek.disabled || !scrubbing) return;
    const target = Number(seek.value);
    scrubbing = false;
    scrubKey = null;
    command("seek", target);
  });
  const cancelScrub = () => { scrubbing = false; scrubKey = null; scrubCancelled = false; render(store.getState()); };
  listen(seek, "pointerup", () => { if (!scrubbing) cancelScrub(); });
  listen(seek, "pointercancel", cancelScrub);
  listen(seek, "keydown", (event) => { if (event.key === "Escape") cancelScrub(); });
  listen(seek, "blur", () => { if (scrubbing) cancelScrub(); });
  const unsubscribe = store.subscribe(render);
  return () => {
    stopped = true;
    ++artGeneration;
    request?.abort();
    artAnimation?.cancel(); stateAnimation?.cancel();
    unsubscribe(); listeners.forEach((remove) => remove());
  };
}
