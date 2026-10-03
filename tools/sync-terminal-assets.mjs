import { copyFile, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const target = new URL("wallpaper/vendor/xterm/", root);
await mkdir(target, { recursive: true });
for (const [source, destination] of [
  ["@xterm/xterm/lib/xterm.js", "xterm.js"],
  ["@xterm/xterm/css/xterm.css", "xterm.css"],
  ["@xterm/xterm/LICENSE", "LICENSE"],
  ["@xterm/addon-fit/lib/addon-fit.js", "addon-fit.js"],
  ["@xterm/addon-fit/LICENSE", "addon-fit.LICENSE"],
]) await copyFile(new URL(`node_modules/${source}`, root), new URL(destination, target));
