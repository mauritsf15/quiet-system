import { duration, clamp } from "../core/format.js";
import { imageToAscii, proceduralAscii } from "../media/ascii-art.js";

const panel = document.getElementById("media-panel");
const ascii = document.getElementById("album-ascii");
const sampler = document.getElementById("album-sampler");
const title = document.getElementById("media-title");
const artist = document.getElementById("media-artist");
const progress = document.getElementById("media-progress-fill");
const position = document.getElementById("media-position");
const total = document.getElementById("media-duration");
let activeThumbnail = null;

export async function renderMedia(state) {
  const media = state.media;
  const visible = state.settings.showMedia && media.enabled && media.state === "playing";
  panel.hidden = !visible;
  document.body.classList.toggle("has-media", visible);
  if (!visible) return;

  title.textContent = media.title || "Untitled";
  artist.textContent = media.artist || "Unknown artist";
  position.textContent = duration(media.position);
  total.textContent = duration(media.duration);
  const percent = Number.isFinite(media.position) && Number.isFinite(media.duration) && media.duration > 0
    ? clamp(media.position / media.duration * 100, 0, 100)
    : 0;
  progress.style.width = `${percent}%`;
  panel.style.setProperty("--media-color", media.primaryColor || "var(--accent)");

  if (media.thumbnail === activeThumbnail) return;
  activeThumbnail = media.thumbnail;
  if (!media.thumbnail) {
    ascii.textContent = proceduralAscii();
    return;
  }
  try {
    ascii.textContent = await imageToAscii(media.thumbnail, sampler);
  } catch {
    ascii.textContent = proceduralAscii();
  }
}
