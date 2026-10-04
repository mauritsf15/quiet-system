import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.QUIET_PLAYWRIGHT_PATH) throw new Error("Set QUIET_PLAYWRIGHT_PATH to playwright/index.mjs.");
const { chromium } = await import(pathToFileURL(process.env.QUIET_PLAYWRIGHT_PATH).href);
const root = resolve("wallpaper"), output = resolve("artifacts/playback-controls");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };
const art = (color) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${color}"/></svg>`)}`;
let scenarios = 0;

async function setup(viewport = { width: 1920, height: 1080 }, scale = 1, role = "", reducedMotion = "no-preference", local = true) {
  const page = await browser.newPage({ viewport, reducedMotion });
  const errors = [], commands = [];
  let mode = "success", releaseSlow;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/wallpaper/")) {
      const file = resolve(root, decodeURIComponent(url.pathname.slice("/wallpaper/".length)) || "index.html");
      if (!file.startsWith(root + "\\")) return route.abort();
      try { return await route.fulfill({ contentType: types[extname(file)], body: await readFile(file) }); }
      catch { return route.fulfill({ status: 404, body: "Not found" }); }
    }
    if (url.pathname === "/api/session") return route.fulfill({ json: { token: "fixture" } });
    if (url.pathname === "/api/audio-mixer") return route.fulfill({ json: { available: false, sessions: [] } });
    if (url.pathname === "/api/media/control") {
      const body = route.request().postDataJSON();
      commands.push(body);
      if (mode === "timeout") return; // Hold until the client's timeout cancels the request.
      if (mode === "failure") return route.fulfill({ status: 409, json: { error: "Fixture player rejection" } });
      await page.evaluate((body) => {
        if (body.action === "seek") window.__playback.media({ position: body.positionSeconds });
        if (body.action === "play" || body.action === "pause") window.__playback.media({ state: body.action === "play" ? "playing" : "paused" });
      }, body);
      return route.fulfill({ json: { applied: true } });
    }
    if (url.pathname === "/art/slow") {
      await new Promise((complete) => { releaseSlow = complete; });
      return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="red"/></svg>' }).catch(() => {});
    }
    return route.abort();
  });
  await page.addInitScript(({ scale }) => {
    localStorage.setItem("quiet-system-appearance-v3", JSON.stringify({ scale, weather: false }));
    const sockets = new Map();
    class Socket extends EventTarget {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url) {
        super(); this.readyState = 0; sockets.set(new URL(url).pathname, this);
        queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
      }
      send() {}
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    }
    window.WebSocket = Socket;
    let media = { enabled: true, state: "paused", title: "Fixture Song", artist: "Fixture Artist", album: "Fixture Album",
      thumbnail: "", position: 7, duration: 120, playbackRate: 1, capturedAt: Date.now(), trackKey: "fixture", sessionId: "spotify",
      sourceAppId: "Spotify.exe", mediaType: "music", capabilities: { play: true, pause: true, previous: true, next: true, seek: true }, seekMin: 0, seekMax: 120 };
    window.__playback = {
      media(extra = {}) {
        media = { ...media, ...extra, capturedAt: Date.now() };
        sockets.get("/live")?.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "media", data: media }) }));
      },
      close() { sockets.get("/live").close(); },
      reconnect() { this.media({ enabled: true, state: "paused" }); },
      lyrics() {
        sockets.get("/live")?.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "lyrics", data: {
          trackKey: media.trackKey, available: true, lines: [{ at: 5, text: "A quiet signal moves across the room" }, { at: 10, text: "The next fixture line arrives in time" }],
        } }) }));
      },
    };
  }, { scale });
  await page.goto(`http://127.0.0.1:${local ? 9876 : 4173}/wallpaper/${role ? "?role=" + role : ""}`);
  await page.waitForSelector("body.is-ready");
  await page.evaluate(() => { window.__playback.media(); window.__playback.lyrics?.(); });
  return { page, errors, commands, mode: (value) => { mode = value; }, releaseSlow: () => releaseSlow?.() };
}

try {
  for (const [name, viewport, role] of [
    ["desktop", { width: 1920, height: 1080 }, ""], ["compact", { width: 1366, height: 768 }, ""],
    ["small", { width: 1280, height: 720 }, ""], ["narrow", { width: 800, height: 900 }, ""],
    ["dashboard", { width: 1920, height: 1080 }, "dashboard"], ["dashboard-small", { width: 400, height: 800 }, "dashboard"],
  ]) {
    for (const scale of [.85, 1, 1.15]) {
      const { page, errors } = await setup(viewport, scale, role);
      await page.evaluate((src) => window.__playback.media({ thumbnail: src }), art("#83adbf"));
      await page.waitForTimeout(220);
      const geometry = await page.evaluate(() => {
        const box = (selector) => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
        };
        return { media: box(".media-panel"), controls: box(".media-controls"), lyrics: box(".media-lyrics"),
          spectrum: box(".audio-spectrum-panel"), times: box(".media-times"),
          overflow: document.querySelector(".dashboard").scrollWidth > document.querySelector(".dashboard").clientWidth + 1 };
      });
      assert.ok(geometry.controls.bottom <= geometry.media.bottom + 1, `${name} ${scale}: controls fit vertically`);
      assert.ok(geometry.controls.right <= geometry.media.right + 1, `${name} ${scale}: controls fit horizontally`);
      assert.ok(geometry.lyrics.bottom <= geometry.times.y, `${name} ${scale}: lyrics do not overlap timeline`);
      assert.ok(geometry.times.bottom <= geometry.controls.y + 1, `${name} ${scale}: controls follow timestamps`);
      assert.ok(geometry.media.bottom <= geometry.spectrum.y, `${name} ${scale}: controls do not overlap spectrum`);
      assert.equal(geometry.overflow, false, `${name} ${scale}: no horizontal overflow`);
      assert.equal(await page.getByRole("button", { name: "Play", exact: true }).isEnabled(), true);
      if (scale === 1) await page.screenshot({ path: resolve(output, `${name}.png`) });
      assert.deepEqual(errors, []);
      scenarios++;
      await page.close();
    }
  }

  const fixture = await setup();
  const { page, commands, errors } = fixture;
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
  await page.waitForFunction(() => !document.getElementById("media-toggle").disabled);
  assert.equal(commands.at(-1).action, "play");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.waitForFunction(() => !document.getElementById("media-toggle").disabled);
  assert.equal(await page.locator("#media-state").textContent(), "PAUSED");
  for (const [label, action] of [["Previous track", "previous"], ["Next track", "next"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForFunction(() => !document.getElementById("media-toggle").disabled);
    assert.equal(commands.at(-1).action, action);
  }
  const beforeSeek = commands.length;
  await page.locator("#media-seek").evaluate((node) => { node.value = "45"; node.dispatchEvent(new Event("input", { bubbles: true })); });
  assert.equal(await page.locator("#media-position").textContent(), "0:45");
  await page.evaluate(() => window.__playback.media({ position: 8 }));
  assert.equal(await page.locator("#media-seek").inputValue(), "45");
  assert.equal(commands.length, beforeSeek, "Scrubbing does not send intermediate commands");
  await page.locator("#media-seek").dispatchEvent("change");
  await page.waitForFunction(() => !document.getElementById("media-seek").disabled);
  assert.equal(commands.length, beforeSeek + 1);
  assert.deepEqual(commands.at(-1), { sessionId: "spotify", trackKey: "fixture", action: "seek", positionSeconds: 45 });
  await page.locator("#media-seek").focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => !document.getElementById("media-seek").disabled);
  assert.equal(commands.at(-1).action, "seek", "Keyboard changes commit seeks");

  await page.locator("#media-seek").evaluate((node) => { node.value = "80"; node.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.evaluate(() => window.__playback.media({ trackKey: "new-track", position: 2 }));
  assert.equal(await page.locator("#media-seek").inputValue(), "2", "Track switches cancel scrub drafts");
  await page.locator("#media-seek").evaluate((node) => { node.value = "90"; node.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.locator("#media-seek").dispatchEvent("change");
  assert.ok(commands.at(-1).positionSeconds !== 80 && commands.at(-1).positionSeconds !== 90, "Continued stale drag never seeks the new track");
  await page.evaluate(() => window.__playback.media({ capabilities: null }));
  assert.equal(await page.locator("#media-toggle").isDisabled(), true, "Old companions disable controls");
  await page.evaluate(() => window.__playback.media({ capabilities: { play: true, pause: true, previous: false, next: true, seek: false } }));
  assert.equal(await page.locator("#media-previous").isDisabled(), true);
  assert.equal(await page.locator("#media-seek").isDisabled(), true);
  assert.equal(await page.locator("#media-next").isEnabled(), true);
  await page.evaluate(() => window.__playback.close());
  assert.equal(await page.locator("#media-toggle").isDisabled(), true);
  await page.evaluate(() => window.__playback.reconnect());
  assert.equal(await page.locator("#media-toggle").isEnabled(), true);

  fixture.mode("failure");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => !document.getElementById("media-toggle").disabled);
  assert.equal(await page.locator("#media-control-status").textContent(), "Fixture player rejection");
  fixture.mode("timeout");
  const beforeTimeout = commands.length;
  await page.evaluate(() => { document.getElementById("media-toggle").click(); document.getElementById("media-toggle").click(); });
  await page.waitForTimeout(100);
  assert.equal(commands.length, beforeTimeout + 1, "Pending commands suppress duplicate input");
  await page.waitForFunction(() => !document.getElementById("media-toggle").disabled, { timeout: 5000 });
  assert.match(await page.locator("#media-control-status").textContent(), /too long/);
  fixture.mode("success");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForFunction(() => !document.getElementById("media-toggle").disabled);
  assert.equal(await page.locator("#media-control-status").textContent(), "", "Retry recovers after timeout");

  await page.evaluate(() => window.__playback.media({ thumbnail: "http://127.0.0.1:9876/art/slow" }));
  await page.waitForTimeout(100);
  const newest = art("blue");
  await page.evaluate((src) => window.__playback.media({ thumbnail: src }), newest);
  await page.waitForFunction((src) => document.querySelector("#album-art img")?.src === src, newest);
  fixture.releaseSlow();
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#album-art img").getAttribute("src"), newest, "Late artwork cannot replace a newer track");
  const timing = await page.locator("#media-next").evaluate((node) => getComputedStyle(node).transitionDuration);
  assert.equal(timing.split(",").every((value) => parseFloat(value) <= .12), true);
  assert.deepEqual(errors, []);
  await page.close();
  scenarios++;

  const reduced = await setup(undefined, 1, "", "reduce");
  await reduced.page.evaluate((src) => window.__playback.media({ thumbnail: src, state: "playing" }), art("green"));
  await reduced.page.waitForTimeout(100);
  assert.equal(await reduced.page.locator("#album-art").evaluate((node) => node.getAnimations({ subtree: true }).length), 0);
  assert.equal(await reduced.page.locator("#media-state").evaluate((node) => node.getAnimations().length), 0);
  assert.equal(await reduced.page.locator("#media-next").evaluate((node) => getComputedStyle(node).transitionDuration), "0s");
  await reduced.page.close();
  scenarios++;

  const preview = await setup(undefined, 1, "", "no-preference", false);
  assert.equal(await preview.page.locator("#media-toggle").isDisabled(), true, "Browser preview never sends system controls");
  assert.equal(preview.commands.length, 0);
  await preview.page.close();
  scenarios++;
  console.log(`${scenarios} playback behavior and layout scenarios passed. Screenshots: ${output}`);
} finally { await browser.close(); }
