import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";

const playwrightPath = process.env.QUIET_PLAYWRIGHT_PATH;
if (!playwrightPath) throw new Error("Set QUIET_PLAYWRIGHT_PATH to playwright/index.mjs.");
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const root = resolve("wallpaper");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const browser = await chromium.launch({ channel: "msedge", headless: true });

async function setup(context, viewport, role) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:9876") return route.abort();
    if (url.pathname.startsWith("/wallpaper/")) {
      const file = resolve(root, decodeURIComponent(url.pathname.slice("/wallpaper/".length)) || "index.html");
      if (!file.startsWith(root + sep)) return route.abort();
      try { return await route.fulfill({ contentType: types[extname(file)], body: await readFile(file) }); }
      catch { return route.fulfill({ status: 404, body: "Not found" }); }
    }
    if (url.pathname === "/api/session") return route.fulfill({ json: { token: "appearance-fixture" } });
    return route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem("quiet-system-appearance-v3", JSON.stringify({ scale: 1, weather: false }));
    const terminals = [], sent = [];
    let terminalConstructor;
    Object.defineProperty(window, "Terminal", {
      configurable: true,
      get: () => terminalConstructor,
      set(value) {
        terminalConstructor = new Proxy(value, {
          construct(target, args) {
            const terminal = Reflect.construct(target, args);
            terminals.push(terminal);
            return terminal;
          },
        });
      },
    });
    class FixtureSocket extends EventTarget {
      static OPEN = 1;
      constructor(url) {
        super(); this.url = url; this.readyState = 0;
        setTimeout(() => {
          this.readyState = 1; this.dispatchEvent(new Event("open"));
          if (new URL(url).pathname === "/commands") this.packet({ type: "ready" });
        }, 0);
      }
      packet(packet) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(packet) })); }
      send(value) {
        const packet = JSON.parse(value);
        sent.push(packet);
        if (packet.type !== "run") return;
        this.packet({ type: "start", id: packet.id });
        const text = packet.command === "fixture completed" ? `RESULT-${"x".repeat(packet.cols * 2 - 30)}-END` : "Fixture session running";
        this.packet({ type: "stdout", id: packet.id, text: `${text}\r\n` });
        if (packet.command === "fixture completed") this.packet({ type: "exit", id: packet.id, code: 0 });
      }
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    }
    window.WebSocket = FixtureSocket;
    window.__terminalAppearanceFixture = {
      terminals, sent,
      snapshot() {
        return terminals.map((terminal) => {
          const host = terminal.element.parentElement;
          const screen = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
          const buffer = terminal.buffer.active;
          return {
            fontSize: terminal.options.fontSize, cursor: terminal.options.theme.cursor,
            cols: terminal.cols, rows: terminal.rows, height: host.clientHeight,
            screenWidth: screen.width, hostWidth: host.clientWidth,
            cellHeight: screen.height / terminal.rows,
            usedRows: buffer.baseY + buffer.cursorY + 1,
            text: Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index).translateToString(true)).join(""),
          };
        });
      },
    };
  });
  await page.goto(`http://127.0.0.1:9876/wallpaper/${role ? "?role=" + role : ""}`);
  await page.waitForFunction(() => document.getElementById("command-connection").textContent === "READY");
  return { page, errors };
}

async function setAppearance(page, scale, accent) {
  await page.evaluate(({ scale, accent }) => {
    for (const [id, value] of [["setting-scale", scale], ["setting-accent", accent]]) {
      const control = document.getElementById(id);
      control.value = value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, { scale, accent });
  await page.waitForFunction(({ scale, accent }) => window.__terminalAppearanceFixture.terminals.every((terminal) =>
    Math.abs(terminal.options.fontSize - 14 * scale) < .01 && terminal.options.theme.cursor === accent), { scale, accent });
}

try {
  for (const [name, viewport, role] of [
    ["single-display", { width: 1920, height: 1080 }, ""],
    ["two-display-span", { width: 3840, height: 1080 }, ""],
    ["separate-command-display", { width: 1920, height: 1080 }, "commands"],
  ]) {
    const context = await browser.newContext();
    const { page, errors } = await setup(context, viewport, role);
    await page.locator("#command-input").fill("fixture completed");
    await page.locator("#command-form").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => document.querySelector(".entry-status")?.textContent.startsWith("completed") && document.querySelector(".entry-terminal")?.style.height);
    await page.locator("#command-input").fill("fixture active");
    await page.locator("#command-form").evaluate((form) => form.requestSubmit());
    await page.waitForFunction(() => window.__terminalAppearanceFixture.terminals.length === 2);
    const before = await page.evaluate(() => window.__terminalAppearanceFixture.snapshot());
    await setAppearance(page, 1.15, "#ee7777");
    const after = await page.evaluate(() => window.__terminalAppearanceFixture.snapshot());
    for (const entry of after) {
      assert.equal(entry.fontSize, 16.1, `${name}: existing output follows interface scale`);
      assert.equal(entry.cursor, "#ee7777", `${name}: existing cursor follows accent`);
      assert.ok(entry.cols < before[after.indexOf(entry)].cols, `${name}: output refits to larger text`);
      assert.ok(entry.screenWidth <= entry.hostWidth + 1, `${name}: terminal text stays within output width`);
    }
    assert.equal(after[0].text, before[0].text, `${name}: completed output survives reflow`);
    assert.ok(after[0].height >= after[0].usedRows * after[0].cellHeight, `${name}: all short completed output rows remain visible`);
    assert.ok(after[0].height > before[0].height, `${name}: compact output expands after reflow`);
    const packets = await page.evaluate(() => window.__terminalAppearanceFixture.sent);
    const activeId = packets.filter((packet) => packet.type === "run")[1].id;
    const resize = packets.filter((packet) => packet.type === "resize").at(-1);
    assert.equal(resize.id, activeId, `${name}: only the running session receives resized dimensions`);
    assert.equal(resize.cols, after[1].cols);
    assert.equal(resize.rows, after[1].rows);
    assert.deepEqual(packets.filter((packet) => packet.type === "run").map((packet) => packet.command), ["fixture completed", "fixture active"]);

    const controller = await context.newPage();
    await controller.route("**/*", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Preference fixture</title>" }));
    await controller.goto("http://127.0.0.1:9876/preference-fixture");
    await controller.evaluate(() => localStorage.setItem("quiet-system-appearance-v3", JSON.stringify({ scale: .85, accent: "#77ee77", weather: false })));
    await page.waitForFunction(() => window.__terminalAppearanceFixture.terminals.every((terminal) =>
      Math.abs(terminal.options.fontSize - 11.9) < .01 && terminal.options.theme.cursor === "#77ee77"));
    const remote = await page.evaluate(() => window.__terminalAppearanceFixture.snapshot());
    assert.equal(remote[0].text, before[0].text, `${name}: completed output survives remote appearance changes`);
    assert.ok(remote[0].screenWidth <= remote[0].hostWidth + 1);
    assert.deepEqual(errors, [], `${name}: no browser errors`);
    await context.close();
  }
  console.log("3 terminal appearance browser scenarios passed with stub command traffic.");
} finally { await browser.close(); }
