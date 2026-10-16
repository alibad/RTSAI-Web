/** Compile and serve the standalone Studio locally, without a worker or dev module transport. */
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createArtReviewMiddleware } from "../lib/art-lab/review-server";
import { createSoundReviewMiddleware, soundDeskConfig } from "../lib/sound-desk/server";
import { originalsConfig } from "../lib/art-lab/originals";
import { isPlayPath, proxyTo } from "../lib/play-proxy";
import { createLocalOwnerContentHandler } from "../lib/studio-content-server";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, ".cache/art-lab-client");
const globalsCssFile = resolve(root, "app/globals.css").replaceAll("\\", "/");
const aliases = Object.fromEntries(["link", "router", "navigation"].map(name => [`next/${name}`, resolve(root, `node_modules/vinext/dist/shims/${name}.js`)]));
// This entry uses only the site's existing palette/defaults and Studio CSS, without the marketing layout. Tailwind adds
// its theme and utility layers for the shadcn UI kit (app/components/ui) only: no preflight, and no utilities generated
// from Studio class names. A Studio file that puts extra Tailwind classes on kit components adds an @source line here.
const kitCss = [
  `@import "tailwindcss/theme.css" layer(theme);`,
  `@import "tailwindcss/utilities.css" layer(utilities) source(none);`,
  `@source "./components/ui";`,
  `@import "./components/ui/kit.css";`,
].join("\n") + "\n";
const baseCss = kitCss + readFileSync(resolve(root, "app/globals.css"), "utf8").split(".skip-link")[0].replace(/^@import .*;\r?\n/gm, "");
const result = await build({
  configFile: false, root, base: "/", publicDir: false,
  plugins: [react(), tailwindcss(), {
    name: "local-studio-base-css",
    enforce: "pre",
    load(id) { return id.split("?")[0].replaceAll("\\", "/") === globalsCssFile ? baseCss : null; },
  }],
  css: { postcss: { plugins: [] } },
  // "@/..." resolves as in tsconfig.json and components.json, for files the shadcn CLI adds.
  resolve: { alias: [...Object.entries(aliases).map(([find, replacement]) => ({ find, replacement })), { find: /^@\//, replacement: `${root.replaceAll("\\", "/")}/` }] },
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: { outDir: output, emptyOutDir: false, rollupOptions: { input: { studio: resolve(root, "app/art/review/local-entry.tsx"), content: resolve(root, "app/studio/content/local-entry.tsx") } } },
});
const bundles = Array.isArray(result) ? result : [result];
const files = bundles.flatMap(r => "output" in r ? r.output : []);
const entry = files.find(f => f.type === "chunk" && f.isEntry && f.name === "studio");
if (!entry) throw new Error("Studio entry was not compiled");
const contentEntry = files.find(f => f.type === "chunk" && f.isEntry && f.name === "content");
if (!contentEntry) throw new Error("Shared content entry was not compiled");
const styles = files.filter(f => f.type === "asset" && f.fileName.endsWith(".css")).map(f => `<link rel="stylesheet" href="/${f.fileName}">`).join("");
// The installed local app (scripts/local-app.ps1) puts the production website behind the Studio on one origin.
const site = process.env.RTSAI_SITE_ORIGIN ? new URL(process.env.RTSAI_SITE_ORIGIN) : null;
const manifest = JSON.stringify({
  id: "/art/review", name: "RTS AI Studio", short_name: "RTS AI",
  description: "Local Faction Studio and website: explore the factions, test encounters and review new art.",
  start_url: "/art/review", scope: "/", display: "standalone", background_color: "#111411", theme_color: "#111411",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
});
const head = `<link rel="manifest" href="/studio.webmanifest"><meta name="theme-color" content="#111411"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Faction Studio · Local</title>${head}${styles}</head><body style="--font-geist:Arial"${site ? ` data-site="1"` : ""}><div id="art-lab-root"></div><script type="module" src="/${entry.fileName}"></script></body></html>`;
const contentHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Shared content - Local Studio</title>${head}${styles}</head><body style="background:#111411;font-family:Arial"><div id="shared-content-root"></div><script type="module" src="/${contentEntry.fileName}"></script></body></html>`;
const api = createArtReviewMiddleware({ root: process.env.RTSAI_ART_DIR ?? resolve(root, "../RTSAI-Art"), env: "development", originals: originalsConfig(root), webRoot: root, previewMod: resolve(root, process.env.RTSAI_PREVIEW_MOD_DIR ?? "../RTSAI-Mod-wt-art-preview") });
// The admin Faction viewer's Sound desk (decisions to RTSAI-Art/sound-review.json; the mod is read in place).
const desk = createSoundReviewMiddleware({ ...soundDeskConfig(root), env: "development" });
const port = Number(process.env.RTSAI_STUDIO_PORT ?? 3461);
const ownerContent = createLocalOwnerContentHandler(`http://127.0.0.1:${port}`);
const mime: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".vxl": "application/octet-stream", ".hva": "application/octet-stream", ".pal": "application/octet-stream", ".shp": "application/octet-stream", ".wasm": "application/wasm" };
/** Everything the Studio does not serve goes to the website; its redirects stay on this origin. */
function toSite(req: IncomingMessage, res: ServerResponse, target: URL) {
  const url = new URL(req.url ?? "/", target);
  const upstream = request(url, { method: req.method, headers: { ...req.headers, host: url.host } }, up => {
    const headers = { ...up.headers };
    if (typeof headers.location === "string") headers.location = headers.location.replace(target.origin, "");
    res.writeHead(up.statusCode ?? 502, headers);
    up.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("The local website is still starting. Reload in a moment.");
  });
  req.pipe(upstream);
}

// The browser game (RTSAI-WebGame, `node server/serve.mjs` on 127.0.0.1:3490) under /play on this origin.
const toGame = proxyTo(new URL(process.env.RTSAI_WEBGAME_ORIGIN ?? `http://127.0.0.1:${process.env.RTSAI_WEBGAME_PORT ?? 3490}`),
  "The browser game is not running (RTSAI-WebGame on port 3490). Start it, or restart the local app.");

createServer((req, res) => {
  if (['/api/studio/content', '/api/studio/session'].includes(req.url?.split('?')[0] ?? '')) {
    void (async () => {
      const parts: Buffer[] = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 4096) { res.writeHead(413).end(); return; } parts.push(Buffer.from(chunk)); }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
      const method = req.method ?? 'GET';
      const reply = await ownerContent(new Request(`http://${req.headers.host}${req.url}`, { method, headers,
        ...(['GET', 'HEAD'].includes(method) ? {} : { body: Buffer.concat(parts).toString('utf8') }) }), req.socket.remoteAddress);
      res.writeHead(reply.status, Object.fromEntries(reply.headers)); res.end(await reply.text());
    })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
    return;
  }
  if (req.url?.startsWith("/api/art-review/")) { void api(req, res); return; }
  if (req.url?.startsWith("/api/sound-review/")) { void desk(req, res); return; }
  if (isPlayPath(req.url)) { toGame(req, res); return; }
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (req.method === "GET") {
    if (path === "/studio/content") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "frame-ancestors 'none'" }).end(contentHtml); return; }
    // One manifest for the installed app, whichever page it is installed from.
    if (path === "/studio.webmanifest" || (site && path === "/manifest.webmanifest")) { res.writeHead(200, { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" }).end(manifest); return; }
    if (path === "/art/review" || path === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(html); return; }
    let decoded: string;
    try { decoded = decodeURIComponent(path); } catch { res.writeHead(400).end(); return; }
    for (const directory of [output, resolve(root, "public")]) {
      const file = resolve(directory, `.${decoded}`);
      if (!file.startsWith(directory + sep) || !existsSync(file)) continue;
      try { res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" }).end(readFileSync(file)); return; } catch { /* directory or missing file */ }
    }
  }
  if (site) { toSite(req, res, site); return; }
  res.writeHead(req.method === "GET" ? 404 : 405).end();
}).listen(port, "127.0.0.1", () => console.log(`Local Studio: http://127.0.0.1:${port}/art/review${site ? ` · website from ${site.origin}` : ""}`));
