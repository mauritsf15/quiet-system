import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.QUIET_PLAYWRIGHT_PATH) throw new Error("Set QUIET_PLAYWRIGHT_PATH to playwright/index.mjs.");
const { chromium } = await import(pathToFileURL(process.env.QUIET_PLAYWRIGHT_PATH).href);
const root = resolve("wallpaper");
const output = resolve("artifacts/weather-setup");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") {
      const file = resolve(root, decodeURIComponent(url.pathname).replace(/^\//, "") || "index.html");
      if (!file.startsWith(root + sep)) return route.abort();
      try { return await route.fulfill({ body: await readFile(file), contentType: ({ ".html": "text/html", ".css": "text/css", ".js": "text/javascript" })[extname(file)] || "text/plain" }); }
      catch { return route.fulfill({ status: 404, body: "Not found" }); }
    }
    if (url.hostname === "geocoding-api.open-meteo.com") return route.fulfill({ json: { results: [
      { name: "Berlin", country: "Germany", latitude: 52.52, longitude: 13.405 },
      { name: "Berlin", country: "United States", latitude: 44.47, longitude: -71.18 },
    ] } });
    if (url.hostname === "api.open-meteo.com") return route.fulfill({ json: { current: { temperature_2m: 18, weather_code: 0 } } });
    return route.abort();
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
      getCurrentPosition(_success, failure) { failure({ code: 1 }); },
    } });
  });
  await page.goto("http://127.0.0.1:4173/index.html");
  await page.getByRole("button", { name: "Open appearance settings" }).click();
  await page.locator("#location-detect").click();
  await page.locator("#location-status").filter({ hasText: "Search for your city" }).waitFor();
  await page.locator("#setting-city").fill("Berlin");
  await page.locator("#setting-city").press("Enter");
  await page.locator("#location-results").waitFor({ state: "visible" });
  await page.locator("#location-results").selectOption("0");
  await page.locator("#location-status").filter({ hasText: "Weather for Berlin, Germany" }).waitFor();
  await page.locator("#weather-line").filter({ hasText: "18°C" }).waitFor();
  assert.equal(await page.locator("#settings-dialog").evaluate((dialog) => dialog.open), true);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("quiet-system-appearance-v3")).location.name), "Berlin, Germany");
  await page.screenshot({ path: resolve(output, "settings-desktop.png") });
  await page.setViewportSize({ width: 390, height: 660 });
  const box = await page.locator("#settings-dialog").boundingBox();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 390 && box.y + box.height <= 661, "Settings fit a narrow display");
  await page.locator("#location-detect").scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "settings-narrow.png") });
  await page.reload();
  await page.getByRole("button", { name: "Open appearance settings" }).click();
  await page.locator("#location-status").filter({ hasText: "Weather for Berlin, Germany" }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Weather setup verified: denied location fallback, city selection, forecast, persistence, keyboard search, and narrow layout.");
} finally { await browser.close(); }
