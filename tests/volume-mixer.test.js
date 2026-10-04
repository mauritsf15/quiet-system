import test from "node:test";
import assert from "node:assert/strict";
import { installVolumeMixer } from "../wallpaper/src/audio/volume-mixer.js";

test("mixer restores expansion, labels separate sessions, writes mute and final volume, and disposes", async (t) => {
  const originals = Object.fromEntries(["document", "fetch", "localStorage"].map(name => [name, globalThis[name]]));
  class Element extends EventTarget {
    children = []; attributes = {}; isConnected = true;
    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    remove() { this.isConnected = false; }
  }
  const elements = new Map(["volume-mixer", "mixer-summary", "mixer-status", "mixer-controls"].map(id => [id, new Element()]));
  globalThis.document = { getElementById: id => elements.get(id), createElement: () => new Element(), activeElement: null };
  const saved = new Map([["quiet-volume-mixer-open", "true"]]);
  globalThis.localStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  const writes = [];
  const frame = { available: true, deviceId: "speakers", deviceName: "Speakers", volume: .7, muted: false,
    sessions: [{ id: "one", name: "Browser", volume: .5, muted: false }, { id: "two", name: "Browser", volume: .6, muted: false }] };
  globalThis.fetch = async (path, options) => {
    if (options?.body) {
      const change = JSON.parse(options.body); writes.push(change);
      Object.assign(change.sessionId ? frame.sessions.find(session => session.id === change.sessionId) : frame, change);
    }
    return { ok: true, json: async () => path === "/api/session" ? { token: "test-token" } : frame };
  };
  const dispose = installVolumeMixer({ localCompanion: true });
  t.after(() => { dispose(); Object.assign(globalThis, originals); });
  await new Promise(setImmediate);
  assert.equal(elements.get("volume-mixer").open, true);
  const rows = elements.get("mixer-controls").children;
  assert.equal(rows.length, 3);
  assert.equal(rows[1].children[0].textContent, "Browser (1)");
  assert.equal(rows[2].children[0].textContent, "Browser (2)");
  rows[1].children[1].value = "23";
  rows[1].children[1].dispatchEvent(new Event("input"));
  rows[1].children[1].dispatchEvent(new Event("change"));
  await new Promise(setImmediate);
  assert.equal(writes[0].volume, .23);
  assert.equal(writes[0].sessionId, "one");
  rows[2].children[3].dispatchEvent(new Event("click"));
  await new Promise(setImmediate);
  assert.equal(writes[1].muted, true);
  assert.equal(writes[1].sessionId, "two");
  assert.equal(frame.sessions[0].muted, false);
  elements.get("volume-mixer").open = false;
  elements.get("volume-mixer").dispatchEvent(new Event("toggle"));
  assert.equal(saved.get("quiet-volume-mixer-open"), "false");
});
