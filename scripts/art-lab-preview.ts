/** Compile and serve the standalone Studio locally, without a worker or dev module transport. */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { createArtReviewMiddleware } from "../lib/art-lab/review-server";
import { originalsConfig } from "../lib/art-lab/originals";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, ".cache/art-lab-client");
const globalsCssFile = resolve(root, "app/globals.css").replaceAll("\\", "/");
const aliases = Object.fromEntries(["link", "router", "navigation"].map(name => [`next/${name}`, resolve(root, `node_modules/vinext/dist/shims/${name}.js`)]));
// This entry uses only the site's existing palette/defaults and Studio CSS, without the marketing layout.
const baseCss = readFileSync(resolve(root, "app/globals.css"), "utf8").split(".skip-link")[0].replace(/^@import .*;\r?\n/gm, "");
const result = await build({
  configFile: false, root, base: "/", publicDir: false,
  plugins: [react(), {
    name: "local-studio-base-css",
    enforce: "pre",
    load(id) { return id.split("?")[0].replaceAll("\\", "/") === globalsCssFile ? baseCss : null; },
  }],
  css: { postcss: { plugins: [] } },
  resolve: { alias: aliases },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { outDir: output, emptyOutDir: false, rollupOptions: { input: resolve(root, "app/art/review/local-entry.tsx") } },
});
const bundles = Array.isArray(result) ? result : [result];
const files = bundles.flatMap(r => "output" in r ? r.output : []);
const entry = files.find(f => f.type === "chunk" && f.isEntry);
if (!entry) throw new Error("Studio entry was not compiled");
const styles = files.filter(f => f.type === "asset" && f.fileName.endsWith(".css")).map(f => `<link rel="stylesheet" href="/${f.fileName}">`).join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Faction Studio · Local</title>${styles}</head><body style="--font-geist:Arial"><div id="art-lab-root"></div><script type="module" src="/${entry.fileName}"></script></body></html>`;
const api = createArtReviewMiddleware({ root: process.env.RTSAI_ART_DIR ?? resolve(root, "../RTSAI-Art"), env: "development", originals: originalsConfig(root), webRoot: root, previewMod: resolve(root, process.env.RTSAI_PREVIEW_MOD_DIR ?? "../RTSAI-Mod-wt-art-preview") });
const port = Number(process.env.RTSAI_STUDIO_PORT ?? 3461);
const mime: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".vxl": "application/octet-stream", ".hva": "application/octet-stream", ".pal": "application/octet-stream", ".shp": "application/octet-stream", ".wasm": "application/wasm" };
createServer((req, res) => {
  if (req.url?.startsWith("/api/art-review/")) { void api(req, res); return; }
  if (req.method !== "GET") { res.writeHead(405).end(); return; }
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (path === "/art/review" || path === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(html); return; }
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { res.writeHead(400).end(); return; }
  for (const directory of [output, resolve(root, "public")]) {
    const file = resolve(directory, `.${decoded}`);
    if (!file.startsWith(directory + sep) || !existsSync(file)) continue;
    try { res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(readFileSync(file)); return; } catch { /* directory or missing file */ }
  }
  res.writeHead(404).end();
}).listen(port, "127.0.0.1", () => console.log(`Local Studio: http://127.0.0.1:${port}/art/review`));
