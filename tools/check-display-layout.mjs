import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";

const playwrightPath = process.env.QUIET_PLAYWRIGHT_PATH;
if (!playwrightPath) throw new Error("Set QUIET_PLAYWRIGHT_PATH to playwright/index.mjs.");
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const root = resolve("wallpaper");
const output = resolve("artifacts/display-audit/after");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
let checks = 0;

async function setup(context, viewport, role, scale) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === "http://127.0.0.1:9876" && url.pathname.startsWith("/wallpaper/")) {
      const file = resolve(root, decodeURIComponent(url.pathname.slice("/wallpaper/".length)) || "index.html");
      if (!file.startsWith(root + sep)) return route.abort();
      try { return await route.fulfill({ contentType: types[extname(file)], body: await readFile(file) }); }
      catch { return route.fulfill({ status: 404, body: "Not found" }); }
    }
    if (url.pathname === "/api/session") return route.fulfill({ json: { token: "display-fixture" } });
    return route.abort();
  });
  await page.addInitScript(({ scale }) => {
    localStorage.setItem("quiet-system-appearance-v3", JSON.stringify({ scale, weather: false }));
    const sockets = [];
    class FixtureSocket extends EventTarget {
      static OPEN = 1;
      constructor(url) {
        super(); this.url = url; this.readyState = 0; sockets.push(this);
        setTimeout(() => {
          this.readyState = 1; this.dispatchEvent(new Event("open"));
          if (new URL(url).pathname === "/commands") this.packet({ type: "ready", username: "fixture", hostname: "desktop", cwd: "C:\\Users\\fixture" });
        }, 0);
      }
      packet(packet) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(packet) })); }
      send() {}
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    }
    window.WebSocket = FixtureSocket;
    window.__displayFixture = {
      paths: () => sockets.map((socket) => new URL(socket.url).pathname).sort(),
      populate() {
        const telemetry = sockets.find((socket) => new URL(socket.url).pathname === "/");
        telemetry?.packet({ type: "telemetry", data: {
          timestamp: Date.now(), system: { username: "fixture", hostname: "desktop", os: "Windows 11", uptimeSeconds: 3600 },
          cpu: { usage: 34, temperature: 55, clockMHz: 4200, powerW: 63 },
          gpu: { usage: 72, temperature: 64, vramUsedGB: 6, vramTotalGB: 12, powerW: 186 },
          memory: { usage: 58, usedGB: 18, totalGB: 32 },
          network: { downloadMbps: 9999, uploadMbps: 9999, interface: "Ethernet" },
          storage: { usage: 92, usedGB: 920, totalGB: 1000, temperature: 42, readMBps: 20, writeMBps: 10 },
        } });
        const live = sockets.find((socket) => new URL(socket.url).pathname === "/live");
        live?.packet({ type: "media", data: { enabled: true, state: "paused", title: "A long song title that should stay inside its panel and end in an ellipsis",
          artist: "Fixture Artist with a long name", duration: 180, position: 7, capturedAt: Date.now(), trackKey: "fixture-song", mediaType: "music" } });
        live?.packet({ type: "lyrics", data: { trackKey: "fixture-song", available: true, lines: [
          { at: 5, text: "A quiet signal moves across the room" }, { at: 10, text: "The next line arrives in time" },
        ] } });
        live?.packet({ type: "audio", available: true, levels: Array.from({ length: 48 }, (_, index) => (index % 7) / 7) });
      },
    };
  }, { scale });
  await page.goto(`http://127.0.0.1:9876/wallpaper/${role ? "?role=" + role : ""}`);
  await page.waitForSelector("body.is-ready");
  if (role !== "dashboard") await page.waitForFunction(() => document.getElementById("command-connection").textContent === "READY");
  await page.evaluate(() => window.__displayFixture.populate());
  await page.waitForTimeout(30);
  return { page, errors };
}

try {
  const scenarios = [
    ["desktop", 1920, 1080, ""], ["compact", 1366, 768, ""], ["small", 1280, 720, ""],
    ["span", 3840, 1080, ""], ["span-qhd", 5120, 1440, ""], ["ultrawide", 2560, 1080, ""],
    ["portrait", 1080, 1920, ""], ["narrow", 800, 900, ""],
    ["dashboard", 1920, 1080, "dashboard"], ["commands", 1920, 1080, "commands"],
    ["dashboard-narrow", 800, 900, "dashboard"], ["commands-narrow", 800, 900, "commands"],
    ["dashboard-small", 400, 800, "dashboard"], ["commands-small", 400, 800, "commands"],
  ];
  for (const [name, width, height, role] of scenarios) {
    for (const scale of [.85, 1, 1.15]) {
      const context = await browser.newContext({ reducedMotion: "reduce" });
      const { page, errors } = await setup(context, { width, height }, role, scale);
      const paths = await page.evaluate(() => window.__displayFixture.paths());
      assert.deepEqual(paths, role === "commands" ? ["/commands"] : role === "dashboard" ? ["/", "/live"] : ["/", "/commands", "/live"], `${name}: only visible services connect`);
      const geometry = await page.evaluate(() => {
        const box = (selector) => {
          const node = document.querySelector(selector), rect = node.getBoundingClientRect();
          return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height,
            scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight };
        };
        return { dashboard: box(".dashboard"), commands: box(".command-panel"), form: box(".command-form"),
          media: box(".media-panel"), info: box(".media-info"), times: box(".media-times"),
          font: parseFloat(getComputedStyle(document.querySelector(".brand strong")).fontSize),
          columns: getComputedStyle(document.querySelector(".resources")).gridTemplateColumns.split(" ").length };
      });
      assert.ok(Math.abs(geometry.font - 16 * .96 * scale) < .1, `${name}: interface scale changes rem text`);
      if (role) {
        const panel = role === "dashboard" ? geometry.dashboard : geometry.commands;
        assert.equal(panel.height, height, `${name}: separate display uses full height`);
        assert.equal(panel.width, width, `${name}: separate display uses full width`);
      }
      if (!role && width / height >= 2) assert.equal(geometry.commands.x, width / 2, `${name}: span seam is centered`);
      if (role !== "commands") {
        for (const selector of [".dashboard-head", "#settings-button", ".media-panel", ".audio-spectrum", ".sparkline"])
          assert.equal(await page.locator(selector).first().isVisible(), true, `${name}: ${selector} remains available`);
        assert.ok(geometry.dashboard.scrollWidth <= geometry.dashboard.clientWidth + 1, `${name}: dashboard has no horizontal overflow`);
        assert.ok(geometry.info.x >= geometry.media.x && geometry.info.right <= geometry.media.right + 1, `${name}: media stays in panel`);
        assert.ok(geometry.info.y >= geometry.media.y - 1 && geometry.times.bottom <= geometry.media.bottom + 1, `${name}: media text fits vertically`);
        assert.ok(geometry.columns <= 2 || geometry.dashboard.clientWidth >= 1000, `${name}: metrics use their own panel width`);
      }
      if (role !== "dashboard") {
        assert.ok(geometry.commands.scrollWidth <= geometry.commands.clientWidth + 1, `${name}: commands have no horizontal overflow`);
        assert.ok(geometry.form.right <= width && geometry.form.bottom <= height, `${name}: command input stays on screen`);
        assert.equal(await page.locator("#shell-identity").textContent(), "fixture@desktop");
      }
      assert.deepEqual(errors, [], `${name}: no browser errors`);
      if (scale === 1) await page.screenshot({ path: resolve(output, `${name}.png`) });
      await context.close();
      checks++;
    }
  }

  const context = await browser.newContext();
  const dashboard = await setup(context, { width: 1920, height: 1080 }, "dashboard", 1);
  const commands = await setup(context, { width: 1920, height: 1080 }, "commands", 1);
  await dashboard.page.locator("#settings-button").click();
  await dashboard.page.locator("#setting-scale").fill("1.15");
  await dashboard.page.locator("#setting-scale").dispatchEvent("input");
  await commands.page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--scale").trim() === "1.15");
  assert.equal(await commands.page.locator("#setting-scale").inputValue(), "1.15", "preferences synchronize across same-origin display pages");
  await context.close();
  checks++;
  console.log(`${checks} display layout and browser behavior scenarios passed. Screenshots: ${output}`);
} finally { await browser.close(); }
