import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = new URL("../wallpaper/", import.meta.url);
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
    const relative = pathname === "/" ? "index.html" : normalize(pathname).replace(/^[/\\]+/, "");
    const target = new URL(relative.replaceAll("\\", "/"), root);
    if (!target.href.startsWith(root.href)) throw new Error("outside root");
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    response.writeHead(200, { "content-type": types[extname(target.pathname)] ?? "application/octet-stream" });
    response.end(await readFile(target));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(4173, "127.0.0.1", () => {
  process.stdout.write("Preview: http://127.0.0.1:4173\n");
});
