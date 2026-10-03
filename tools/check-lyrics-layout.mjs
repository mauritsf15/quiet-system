import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";

const playwrightPath = process.env.QUIET_PLAYWRIGHT_PATH;
if (!playwrightPath) throw new Error("Set QUIET_PLAYWRIGHT_PATH to the bundled playwright/index.mjs path.");
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const root = resolve("wallpaper");
const output = resolve("artifacts/lyrics-layout");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };
let checks = 0;

async function setup(viewport, scale = 1, role = "", reducedMotion = "no-preference") {
  const page = await browser.newPage({ viewport, reducedMotion });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:9876" && url.pathname.startsWith("/wallpaper/")) {
      const file = resolve(root, decodeURIComponent(url.pathname.slice("/wallpaper/".length)) || "index.html");
      if (!file.startsWith(root + "\\")) return route.abort();
      try { return await route.fulfill({ contentType: types[extname(file)], body: await readFile(file) }); }
      catch { return route.fulfill({ status: 404, body: "Not found" }); }
    }
    if (url.pathname === "/api/session") return route.fulfill({ json: { token: "local-test-fixture" } });
    return route.abort();
  });
  await page.addInitScript(({ scale }) => {
    localStorage.setItem("quiet-system-appearance-v3", JSON.stringify({ scale, weather: false }));
    const sockets = new Map();
    class FixtureSocket extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url) {
        super(); this.url = url; this.readyState = 0; sockets.set(new URL(url).pathname, this);
        queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
      }
      send() {}
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    }
    window.WebSocket = FixtureSocket;
    window.__mediaFixture = {
      packet(packet) { sockets.get("/live").dispatchEvent(new MessageEvent("message", { data: JSON.stringify(packet) })); },
      media(extra = {}) {
        this.packet({ type: "media", data: {
          enabled: true, state: "paused", title: "Fixture Song", artist: "Fixture Artist", album: "Fixture Album",
          thumbnail: "", position: 7, duration: 120, playbackRate: 1, capturedAt: Date.now(),
          trackKey: "spotify:fixture", sessionId: "spotify", sourceAppId: "Spotify.exe", mediaType: "music", ...extra,
        } });
      },
      lyrics(extra = {}) {
        this.packet({ type: "lyrics", data: { trackKey: "spotify:fixture", available: true,
          lines: [{ at: 5, text: "A quiet signal moves across the room" }, { at: 10, text: "The next fixture line arrives in time" }, { at: 15, text: "" }], ...extra } });
      },
      close() { sockets.get("/live").close(); },
    };
  }, { scale });
  await page.goto(`http://127.0.0.1:9876/wallpaper/${role ? "?role=" + role : ""}`);
  await page.waitForSelector("body.is-ready");
  await page.evaluate(() => window.__mediaFixture.media());
  return { page, errors };
}

async function geometry(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      const box = node.getBoundingClientRect();
      const shift = selector === ".media-lyrics" ? new DOMMatrixReadOnly(getComputedStyle(node).transform).m42 : 0;
      return { x: box.x, y: box.y - shift, width: box.width, height: box.height, bottom: box.bottom - shift };
    };
    return { clock: rect(".overview"), resources: rect(".resources"), media: rect(".media-panel"), art: rect(".album-art"),
      lyrics: rect(".media-lyrics"), progress: rect(".media-progress"), audio: rect(".audio-spectrum"),
      scrollHeight: document.querySelector(".dashboard").scrollHeight };
  });
}

try {
  for (const [name, viewport, role] of [
    ["desktop", { width: 1920, height: 1080 }, ""],
    ["compact", { width: 1366, height: 768 }, ""],
    ["span", { width: 3840, height: 1080 }, ""],
    ["dashboard", { width: 1920, height: 1080 }, "dashboard"],
    ["narrow", { width: 800, height: 900 }, ""],
  ]) {
    for (const scale of [0.85, 1, 1.15]) {
      const { page, errors } = await setup(viewport, scale, role);
      const before = await geometry(page);
      assert.equal(await page.locator("#media-lyrics").getAttribute("aria-hidden"), "true");
      await page.evaluate(() => window.__mediaFixture.lyrics());
      await page.waitForTimeout(320);
      const after = await geometry(page);
      // Subtracting an animated transform can leave floating-point residue.
      for (const element of ["clock", "resources", "media", "art", "lyrics", "progress", "audio"]) {
        for (const coordinate of ["x", "y", "width", "height", "bottom"]) {
          assert.ok(Math.abs(after[element][coordinate] - before[element][coordinate]) < 0.01,
            `${name} ${scale}: lyrics must not move ${element}.${coordinate}`);
        }
      }
      assert.equal(after.scrollHeight, before.scrollHeight, `${name} ${scale}: lyrics must not add scrolling`);
      {
        assert.equal(await page.locator(".lyric-pair.is-active .lyric-current").textContent(), "A quiet signal moves across the room");
        assert.ok(after.lyrics.y >= after.media.y && after.lyrics.bottom <= after.media.bottom, `${name}: lyrics fit in panel`);
        assert.ok(after.progress.bottom <= after.media.bottom, `${name}: progress fits in panel`);
        const style = await page.locator(".lyric-current").first().evaluate((node) => ({
          overflow: getComputedStyle(node).overflow, whiteSpace: getComputedStyle(node).whiteSpace, ellipsis: getComputedStyle(node).textOverflow,
        }));
        assert.deepEqual(style, { overflow: "hidden", whiteSpace: "nowrap", ellipsis: "ellipsis" });
        if (scale === 1) await page.screenshot({ path: resolve(output, `${name}.png`) });
      }
      assert.deepEqual(errors, [], `${name}: no browser errors`);
      checks++;
      await page.close();
    }
  }

  const { page, errors } = await setup({ width: 1920, height: 1080 });
  await page.evaluate(() => window.__mediaFixture.lyrics());
  await page.waitForTimeout(250);
  const stableBefore = await page.locator(".lyric-pair.is-active").evaluate((node) => node.outerHTML);
  await page.evaluate(() => window.__mediaFixture.media());
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".lyric-pair.is-active").evaluate((node) => node.outerHTML), stableBefore, "Repeated media packets do not replace lyric DOM");
  await page.evaluate(() => window.__mediaFixture.media({ position: 11 }));
  await page.waitForTimeout(250);
  assert.equal(await page.locator(".lyric-pair.is-active .lyric-current").textContent(), "The next fixture line arrives in time");
  await page.evaluate(() => window.__mediaFixture.media({ state: "playing", position: 9.75 }));
  await page.waitForTimeout(550);
  assert.equal(await page.locator(".lyric-pair.is-active .lyric-current").textContent(), "The next fixture line arrives in time", "Lyric boundary advances between media packets");
  await page.evaluate(() => window.__mediaFixture.media({ state: "paused", position: 14.5 }));
  await page.waitForTimeout(800);
  assert.equal(await page.locator(".lyric-pair.is-active .lyric-current").textContent(), "The next fixture line arrives in time", "Pause freezes lyrics before the next boundary");
  await page.evaluate(() => window.__mediaFixture.media({ position: 16 }));
  await page.waitForTimeout(260);
  assert.equal(await page.locator("#media-lyrics").getAttribute("aria-hidden"), "true", "Final blank timestamp hides lyrics");
  await page.evaluate(() => {
    window.__mediaFixture.media({ trackKey: "youtube:other", sessionId: "youtube", title: "Other Song" });
    window.__mediaFixture.lyrics();
  });
  assert.equal(await page.locator("#media-lyrics").getAttribute("aria-hidden"), "true", "Player switches hide old lyrics and reject late packets");
  assert.equal(await page.locator(".lyric-current").allTextContents().then((text) => text.join("")), "");
  await page.evaluate(() => window.__mediaFixture.lyrics({ trackKey: "youtube:other" }));
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#media-lyrics").getAttribute("aria-hidden"), "false");
  await page.evaluate(() => window.__mediaFixture.media({ title: "" }));
  await page.waitForTimeout(260);
  assert.equal(await page.locator("#media-lyrics").getAttribute("aria-hidden"), "true", "Missing song identity hides lyrics");
  await page.evaluate(() => { window.__mediaFixture.media(); window.__mediaFixture.lyrics(); });
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__mediaFixture.close());
  assert.equal(await page.locator("#media-lyrics").getAttribute("aria-hidden"), "true", "Disconnect clears lyrics immediately");
  await page.evaluate(() => { window.__mediaFixture.media(); window.__mediaFixture.lyrics(); });
  await page.waitForTimeout(3800);
  assert.equal(await page.locator("#media-lyrics").getAttribute("aria-hidden"), "true", "Stale playback hides lyrics");
  assert.deepEqual(errors, []);
  await page.close();
  checks++;

  const reduced = await setup({ width: 1920, height: 1080 }, 1, "", "reduce");
  await reduced.page.evaluate(() => window.__mediaFixture.lyrics());
  await reduced.page.waitForTimeout(60);
  await reduced.page.evaluate(() => window.__mediaFixture.media({ position: 11 }));
  await reduced.page.waitForTimeout(60);
  assert.equal(await reduced.page.locator("#media-lyrics").evaluate((node) => node.getAnimations({ subtree: true }).length), 0);
  assert.equal(await reduced.page.locator(".lyric-pair.is-active .lyric-current").textContent(), "The next fixture line arrives in time");
  await reduced.page.close();
  checks++;
  console.log(`${checks} browser layout and behavior scenarios passed. Screenshots: ${output}`);
} finally { await browser.close(); }
