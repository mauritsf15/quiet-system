import test from "node:test";
import assert from "node:assert/strict";
import { smoothAudioLevel, createSpectrumRenderer } from "../wallpaper/src/audio/spectrum-renderer.js";

function rendererFixture(t, reduced = false) {
  const originals = { window: globalThis.window, document: globalThis.document };
  const frames = new Map();
  const timers = new Map();
  const motion = Object.assign(new EventTarget(), { matches: reduced });
  let id = 0;
  let now = performance.now();
  const container = { children: [], appendChild(bar) { this.children.push(bar); } };
  globalThis.document = { createElement: () => ({ style: {}, setAttribute() {} }) };
  globalThis.window = {
    matchMedia: () => motion,
    requestAnimationFrame(callback) { frames.set(++id, callback); return id; },
    cancelAnimationFrame(handle) { frames.delete(handle); },
    setTimeout(callback) { timers.set(++id, callback); return id; },
    clearTimeout(handle) { timers.delete(handle); },
  };
  const renderer = createSpectrumRenderer(container);
  t.after(() => { renderer.dispose(); Object.assign(globalThis, originals); });
  return { renderer, motion, frames, timers,
    heights: () => container.children.map(bar => parseFloat(bar.style.height)),
    advance(ms) { now += ms; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now)); },
  };
}

test("audio peaks rise faster than they fall and smoothing is independent of frame rate", () => {
  assert(smoothAudioLevel(0, 1, 35) > 1 - smoothAudioLevel(1, 0, 35));
  const single = smoothAudioLevel(0, .8, 32);
  const split = smoothAudioLevel(smoothAudioLevel(0, .8, 16), .8, 16);
  assert(Math.abs(single - split) < 1e-12);
});

test("rendered bands preserve positions and silence reaches exactly zero", t => {
  const fixture = rendererFixture(t);
  const levels = new Array(48).fill(0); levels[7] = .8; levels[36] = .4;
  fixture.renderer.update(levels);
  for (let frame = 0; frame < 40; frame++) fixture.advance(16);
  assert.equal(fixture.heights()[7], 80);
  assert.equal(fixture.heights()[36], 40);
  assert.equal(fixture.heights()[0], 0);
  fixture.renderer.update([]);
  for (let frame = 0; frame < 110; frame++) fixture.advance(16);
  assert(fixture.heights().every(value => value === 0));
  assert.equal(fixture.frames.size, 0);
});

test("disconnects clear peaks immediately and malformed values stay finite", t => {
  const fixture = rendererFixture(t, true);
  fixture.renderer.update([1, NaN, Infinity, -1, 2]);
  assert.deepEqual(fixture.heights().slice(0, 5), [100, 0, 0, 0, 100]);
  fixture.renderer.update([1], false);
  assert(fixture.heights().every(value => value === 0));
  assert.equal(fixture.timers.size, 0);
});

test("stale audio expires and disposing cancels frames and timers", t => {
  const fixture = rendererFixture(t, true);
  fixture.renderer.update([.8]);
  [...fixture.timers.values()][0]();
  assert(fixture.heights().every(value => value === 0));
  fixture.motion.matches = false;
  fixture.renderer.update([.9]);
  assert(fixture.frames.size > 0);
  fixture.renderer.dispose();
  assert.equal(fixture.frames.size, 0);
  assert.equal(fixture.timers.size, 0);
});
