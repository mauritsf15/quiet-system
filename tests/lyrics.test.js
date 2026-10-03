import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLyricLines, selectLyricPair, PlaybackClock } from "../wallpaper/src/media/lyrics-controller.js";

const lines = normalizeLyricLines([
  { at: 20, text: "" }, { at: 5, text: "First fixture line" },
  { at: 25, text: "Final fixture line" }, { at: 10, text: "Second fixture line" }, { at: 30, text: "" },
]);
const media = (extra = {}) => ({ trackKey: "spotify:one", state: "playing", position: 5, duration: 100, playbackRate: 1, capturedAt: 10000, ...extra });

test("lyrics normalization rejects malformed entries and preserves instrumental blanks", () => {
  assert.deepEqual(normalizeLyricLines([{ at: null, text: "bad" }, { at: -1, text: "bad" }, { at: 2, text: 3 }, { at: 3, text: " ok " }]), [{ at: 3, text: "ok" }]);
  assert.deepEqual(normalizeLyricLines(null), []);
  assert.equal(lines[2].text, "");
});

test("intro previews the first lyric without inventing a current line", () => {
  assert.deepEqual(selectLyricPair(lines, 0), { index: -1, current: "", next: "First fixture line" });
});

test("line boundaries select current and upcoming lyrics exactly", () => {
  assert.deepEqual(selectLyricPair(lines, 5), { index: 0, current: "First fixture line", next: "Second fixture line" });
  assert.deepEqual(selectLyricPair(lines, 10), { index: 1, current: "Second fixture line", next: "Final fixture line" });
});

test("instrumental gaps clear the current line and preview the next nonempty line", () => {
  assert.deepEqual(selectLyricPair(lines, 21), { index: 2, current: "", next: "Final fixture line" });
  assert.deepEqual(selectLyricPair(lines, 31), { index: 4, current: "", next: "" });
  assert.deepEqual(selectLyricPair(lines, null), { index: -1, current: "", next: "" });
});

test("playback interpolates between packets and accounts for capture latency", () => {
  const clock = new PlaybackClock();
  clock.accept(media(), 1000, 10200);
  assert.equal(clock.read(1000), 5.2);
  assert.equal(clock.read(2000), 6.2);
});

test("paused playback freezes and ignores network latency", () => {
  const clock = new PlaybackClock();
  clock.accept(media({ state: "paused", position: 8 }), 1000, 10200);
  assert.equal(clock.read(3000), 8);
});

test("small timing corrections settle smoothly without restarting the clock", () => {
  const clock = new PlaybackClock();
  clock.accept(media(), 1000, 10000);
  clock.accept(media({ position: 6.1, capturedAt: 11000 }), 2000, 11000);
  assert.equal(clock.seek, false);
  assert.equal(clock.read(2000), 6);
  assert.ok(Math.abs(clock.read(2200) - 6.3) < 0.00001);
});

test("seeks and player changes snap to the new pair", () => {
  const clock = new PlaybackClock();
  clock.accept(media(), 1000, 10000);
  clock.accept(media({ position: 25, capturedAt: 11000 }), 2000, 11000);
  assert.equal(clock.seek, true);
  assert.equal(selectLyricPair(lines, clock.read(2000)).current, "Final fixture line");
  clock.accept(media({ trackKey: "other:one", position: 1, capturedAt: 11000 }), 2000, 11000);
  assert.equal(clock.read(2000), 1);
  assert.equal(clock.seek, true);
});

test("stale playback is detected even if an old frame arrives again", () => {
  const clock = new PlaybackClock();
  clock.accept(media(), 1000, 10000);
  assert.equal(clock.isFresh(4500), true);
  assert.equal(clock.isFresh(4501), false);
  clock.accept(media(), 5000, 14000);
  assert.equal(clock.isFresh(5000), false);
  clock.reset();
  assert.equal(clock.read(5000), null);
});

test("playback rate and track duration bound the lyric clock", () => {
  const clock = new PlaybackClock();
  clock.accept(media({ playbackRate: 2, duration: 7 }), 1000, 10000);
  assert.equal(clock.read(3000), 7);
});
