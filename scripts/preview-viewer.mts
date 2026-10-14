/** Serve the existing Faction Viewer from a compiled local bundle. No deployment or game mutations. */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viewerFaction, viewerFactionLinks } from "../lib/viewer";
import { artFactionByCatalogId } from "../lib/art-lab/manifest";
import { createArtReviewMiddleware } from "../lib/art-lab/review-server";
import { originalsConfig } from "../lib/art-lab/originals";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), output = resolve(root, ".cache/local-viewer");
const globals = resolve(root, "app/globals.css").replaceAll("\\", "/");
const baseCss = readFileSync(globals, "utf8").split(".skip-link")[0].replace(/^@import .*;\r?\n/gm, "");
const shims = ["link", "router", "navigation"].map(name => ({ find: `next/${name}`, replacement: resolve(root, `node_modules/vinext/dist/shims/${name}.js`) }));
const bundle = await build({ configFile: false, root, publicDir: false, base: "/", plugins: [react(), tailwindcss(), { name: "viewer-local-base", enforce: "pre", load(id) { return id.split("?")[0].replaceAll("\\", "/") === globals ? baseCss : null; } }], css: { postcss: { plugins: [] } }, resolve: { alias: [...shims, { find: /^@\//, replacement: `${root.replaceAll("\\", "/")}/` }] }, define: { "process.env.NODE_ENV": JSON.stringify("production"), "process.env.RTSAI_ADMIN": JSON.stringify("0") }, build: { outDir: output, emptyOutDir: false, rollupOptions: { input: resolve(root, "app/viewer/local-entry.tsx") } } });
const outputs = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(r => "output" in r ? r.output : []);
const entry = outputs.find(o => o.type === "chunk" && o.isEntry)!;
const css = outputs.filter(o => o.type === "asset" && o.fileName.endsWith(".css")).map(o => `<link rel="stylesheet" href="/${o.fileName}">`).join("");
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Faction Viewer · Local audio preview</title>${css}</head><body data-local-viewer style="--font-geist:Arial;--font-mono:monospace"><div id="local-viewer-root"></div><script type="module" src="/${entry.fileName}"></script></body></html>`;
const api = createArtReviewMiddleware({ root: resolve(root, "../RTSAI-Art"), env: "development", originals: originalsConfig(root), webRoot: root, previewMod: resolve(root, "../RTSAI-Mod-wt-art-preview") });
const mime: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".webp": "image/webp", ".wasm": "application/wasm", ".jpg": "image/jpeg" };
const port = Number(process.env.RTSAI_VIEWER_PORT ?? 3463);
createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname.startsWith("/api/art-review/")) { void api(req, res); return; }
  if (url.pathname === "/local-viewer-data") { const id = url.searchParams.get("faction") ?? "saudi-arabia", faction = viewerFaction(id); res.writeHead(faction ? 200 : 404, { "Content-Type": "application/json" }); res.end(JSON.stringify(faction ? { faction, factions: viewerFactionLinks(), artFactionId: artFactionByCatalogId(id)?.id ?? id } : { error: "Unknown faction" })); return; }
  if (url.pathname === "/" || url.pathname.startsWith("/viewer/")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end(html); return; }
  let rel: string; try { rel = decodeURIComponent(url.pathname).replace(/^\/+/, ""); } catch { res.writeHead(400).end(); return; }
  for (const base of [output, resolve(root, "public")]) { const file = resolve(base, rel); if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) continue; res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" }); res.end(readFileSync(file)); return; }
  res.writeHead(404).end("Not found");
}).listen(port, "127.0.0.1", () => console.log(`Faction Viewer http://127.0.0.1:${port}/viewer/saudi-arabia/r2m1a2s`));
