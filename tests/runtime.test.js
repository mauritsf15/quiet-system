import test from "node:test";
import assert from "node:assert/strict";
import { displayRole, startDisplayRuntime } from "../wallpaper/src/core/display-runtime.js";
import { installCommandTerminal } from "../wallpaper/src/components/command-terminal.js";
import { installDashboard } from "../wallpaper/src/components/dashboard.js";
import { createStore } from "../wallpaper/src/core/store.js";
import { initialState } from "../wallpaper/src/core/state.js";

function runtimeFixture(options = {}) {
  const started = [];
  const stopped = [];
  const samples = [];
  const services = Object.fromEntries([
    "installMediaIntegration", "startTelemetryClient", "startDemoTelemetry", "startWeatherService",
    "installDashboard", "installCommandTerminal", "renderResources",
  ].map((name) => [name, (...args) => {
    started.push(name);
    if (name === "startTelemetryClient" || name === "startDemoTelemetry") args[1]({ timestamp: 1 });
    return () => stopped.push(name);
  }]));
  const store = { subscribe(listener) {
    started.push("subscribeResources");
    listener({});
    return () => stopped.push("subscribeResources");
  } };
  const dispose = startDisplayRuntime({ role: "auto", localCompanion: true, store,
    history: { push: (sample) => samples.push(sample) }, services, ...options });
  return { started, stopped, samples, dispose };
}

test("unknown display roles retain the complete one-screen layout", () => {
  for (const value of [null, "", "left", "AUTO"]) assert.equal(displayRole(value), "auto");
  assert.equal(displayRole("dashboard"), "dashboard");
  assert.equal(displayRole("commands"), "commands");
  const fixture = runtimeFixture();
  assert.ok(fixture.started.includes("installDashboard"));
  assert.ok(fixture.started.includes("installCommandTerminal"));
  assert.deepEqual(fixture.samples, [{ timestamp: 1 }]);
  fixture.dispose();
  assert.deepEqual(fixture.stopped, ["startTelemetryClient", "startWeatherService", "installDashboard", "subscribeResources", "installCommandTerminal"]);
});

test("separate command displays only start the command service", () => {
  const fixture = runtimeFixture({ role: "commands" });
  assert.deepEqual(fixture.started, ["installCommandTerminal"]);
  assert.deepEqual(fixture.samples, []);
  fixture.dispose();
  assert.deepEqual(fixture.stopped, ["installCommandTerminal"]);
});

test("separate dashboard displays do not start or focus a hidden terminal", () => {
  const fixture = runtimeFixture({ role: "dashboard" });
  assert.deepEqual(fixture.started, ["startTelemetryClient", "startWeatherService", "installDashboard", "subscribeResources", "renderResources"]);
});

test("browser preview keeps simulated dashboard data and disables live commands", () => {
  const fixture = runtimeFixture({ localCompanion: false });
  assert.ok(fixture.started.includes("startDemoTelemetry"));
  assert.ok(fixture.started.includes("installMediaIntegration"));
  assert.ok(fixture.started.includes("installCommandTerminal"));
  assert.ok(!fixture.started.includes("startTelemetryClient"));
  const explicitLive = runtimeFixture({ localCompanion: false, telemetryMode: "live" });
  assert.ok(explicitLive.started.includes("startTelemetryClient"));
  assert.ok(!explicitLive.started.includes("startDemoTelemetry"));
});

function terminalFixture(t, fetchSession) {
  const originals = Object.fromEntries(["window", "document", "WebSocket", "fetch", "MutationObserver"].map((name) => [name, globalThis[name]]));
  const elements = new Map();
  class Element extends EventTarget {
    value = "";
    textContent = "";
    setAttribute() {}
    focus() { this.focused = true; }
    replaceChildren() {}
  }
  const sockets = [];
  const observers = [];
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    constructor(url) { super(); this.url = url; sockets.push(this); }
    close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
  }
  globalThis.document = Object.assign(new EventTarget(), { documentElement: {}, getElementById(id) {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  } });
  globalThis.window = { clearTimeout, setTimeout };
  globalThis.WebSocket = Socket;
  globalThis.fetch = fetchSession;
  t.after(() => Object.assign(globalThis, originals));
  const dispose = installCommandTerminal({ localCompanion: true });
  return { elements, sockets, observers, dispose };
}

test("commands-only pages receive identity from their command connection", async (t) => {
  const fixture = terminalFixture(t, async () => ({ ok: true, json: async () => ({ token: "fixture-token" }) }));
  await new Promise(setImmediate);
  assert.equal(fixture.sockets.length, 1);
  fixture.sockets[0].dispatchEvent(new MessageEvent("message", {
    data: JSON.stringify({ type: "ready", username: "desktop-user", hostname: "desktop-host", cwd: "C:\\Users\\desktop-user" }),
  }));
  assert.equal(fixture.elements.get("shell-identity").textContent, "desktop-user@desktop-host");
  assert.equal(fixture.elements.get("command-connection").textContent, "READY");
  fixture.dispose();
  assert.equal(fixture.observers[0].disconnected, true);
});

test("closing a page during its session request cannot open an orphan command connection", async (t) => {
  let resolve;
  const response = new Promise((complete) => { resolve = complete; });
  const fixture = terminalFixture(t, () => response);
  fixture.dispose();
  resolve({ ok: true, json: async () => ({ token: "late-token" }) });
  await new Promise(setImmediate);
  assert.equal(fixture.sockets.length, 0);
});

test("losing the live media connection clears the playing state until fresh media arrives", (t) => {
  const originals = Object.fromEntries(["window", "document", "WebSocket"].map((name) => [name, globalThis[name]]));
  class Element {
    style = {};
    children = [];
    textContent = "";
    classList = { add() {}, remove() {}, contains() { return false; } };
    appendChild(child) { this.children.push(child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
    querySelector() { return new Element(); }
    querySelectorAll() { return [new Element(), new Element()]; }
  }
  const elements = new Map();
  const sockets = [];
  class Socket extends EventTarget {
    constructor() { super(); sockets.push(this); }
    close() { this.dispatchEvent(new Event("close")); }
  }
  globalThis.document = { createElement: () => new Element(), getElementById(id) {
    if (id === "volume-mixer" || id === "media-controls") return null;
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  } };
  globalThis.window = { setInterval, clearInterval, setTimeout, clearTimeout,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }) };
  globalThis.WebSocket = Socket;
  const store = createStore(initialState);
  const dispose = installDashboard(store, { localCompanion: true });
  t.after(() => { dispose(); Object.assign(globalThis, originals); });
  sockets[0].dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "media", data: {
    enabled: true, state: "playing", title: "Current song", artist: "Current artist", trackKey: "song-one", position: 10, duration: 100,
  } }) }));
  assert.equal(elements.get("media-state").textContent, "PLAYING");
  sockets[0].close();
  assert.equal(store.getState().media.enabled, false);
  assert.equal(elements.get("media-state").textContent, "MEDIA UNAVAILABLE");
  assert.equal(elements.get("media-title").textContent, "Nothing playing");
  sockets[0].dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "media", data: {
    enabled: true, state: "paused", title: "Current song", artist: "Current artist", trackKey: "song-one", position: 10, duration: 100,
  } }) }));
  assert.equal(elements.get("media-state").textContent, "PAUSED");
});
