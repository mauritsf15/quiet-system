import test from "node:test";
import assert from "node:assert/strict";
import { createHistory } from "../wallpaper/src/core/history.js";
import { duration, networkRate, temperature, uptime } from "../wallpaper/src/core/format.js";
import { sparkline, progressBar } from "../wallpaper/src/graphs/sparkline.js";
import { pixelsToAscii } from "../wallpaper/src/media/ascii-art.js";

test("history keeps only the configured number of samples", () => {
  const history = createHistory(3);
  for (const usage of [10, 20, 30, 40]) {
    history.push({ cpu: { usage }, gpu: null, memory: null, network: null });
  }
  assert.deepEqual(history.get("cpu"), [20, 30, 40]);
});

test("formatters keep missing data graceful", () => {
  assert.equal(temperature(null), "--");
  assert.equal(temperature(20, "f"), "68°F");
  assert.equal(duration(134), "2:14");
  assert.equal(networkRate(8, "mbs"), "1.0 MB/s");
  assert.equal(uptime(183_600), "uptime 2d 03h");
});

test("terminal graphs have stable widths", () => {
  assert.equal(sparkline([0, 50, 100], { width: 5 }).length, 5);
  assert.equal(progressBar(50, 10), "[━━━━━·····]");
});

test("ASCII conversion maps dark and light pixels to ramp endpoints", () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 255, 255, 255,
  ]);
  assert.equal(pixelsToAscii(pixels, 2, 1), " @");
});

test("ASCII conversion keeps a uniform midtone visible", () => {
  const pixels = new Uint8ClampedArray([128, 128, 128, 255]);
  assert.notEqual(pixelsToAscii(pixels, 1, 1), " ");
});
