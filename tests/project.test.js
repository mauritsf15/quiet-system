import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Wallpaper Engine manifest points to an existing web entry", async () => {
  const manifest = JSON.parse(await readFile(new URL("../wallpaper/project.json", import.meta.url), "utf8"));
  assert.equal(manifest.type, "web");
  assert.equal(manifest.file, "index.html");
  assert.equal(manifest.general.supportsaudioprocessing, false);
  assert.deepEqual(manifest.general.properties, {});
});
