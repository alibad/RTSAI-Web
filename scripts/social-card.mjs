/**
 * Renders public/social-card.png (1200 x 630, the Open Graph and Twitter image) from the approved faction art:
 * the seven faction lineups and flags in public/faction-art, the RTS AI mark, and the site's type (Geist).
 *
 *   node scripts/social-card.mjs            # needs Playwright: PLAYWRIGHT_MODULE=<path to the playwright package>
 *
 * Only project art and MIT/approved flags are used (docs/faction-art.md). Re-run after the lineups change.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const art = JSON.parse(readFileSync(join(web, "data/faction-art.json"), "utf8"));
const order = ["china", "iran", "turkey", "saudi-arabia", "yemen", "israel", "hezbollah"];
const flagId = id => (id === "saudi-arabia" ? "saudi" : id);
// Inline data URIs: a page set from a string may not load file:// images.
const mime = { ".webp": "image/webp", ".svg": "image/svg+xml", ".png": "image/png" };
const file = path => `data:${mime[path.slice(path.lastIndexOf("."))]};base64,${readFileSync(join(web, "public", path)).toString("base64")}`;

const lineups = order.map((id, i) => `<img class="unit u${i}" src="${file(art.lineups[id].webp["1440"])}" alt="">`).join("");
const flags = order.map(id => `<img class="flag" src="${file(art.flags[flagId(id)].src)}" alt="">`).join("");
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@500;700&family=Geist+Mono:wght@500&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #111411; }
  body { position: relative; font-family: Geist, "Segoe UI", Arial, sans-serif; color: #f0eee6; }
  .grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(240,238,230,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(240,238,230,.045) 1px, transparent 1px); background-size: 60px 60px; }
  .glow { position: absolute; left: -10%; right: -10%; bottom: -30%; height: 75%; background: radial-gradient(ellipse 55% 60% at 50% 70%, rgba(239,91,63,.28), transparent 70%); }
  .copy { position: absolute; left: 64px; top: 54px; z-index: 3; }
  .brand { display: flex; align-items: center; gap: 16px; font-weight: 700; font-size: 34px; letter-spacing: .06em; }
  .brand img { width: 56px; height: 56px; }
  .brand b { color: #ef5b3f; }
  .kicker { margin-top: 14px; color: #f1d28b; font: 500 15px "Geist Mono", monospace; letter-spacing: .16em; text-transform: uppercase; }
  h1 { margin: 22px 0 0; font-size: 62px; line-height: .98; letter-spacing: -.045em; font-weight: 700; }
  h1 em { color: #ef5b3f; font-style: normal; font-weight: 500; }
  .flags { display: flex; gap: 10px; margin-top: 26px; }
  .flag { width: 44px; height: 33px; object-fit: cover; border-radius: 2px; box-shadow: 0 0 0 1px rgba(240,238,230,.25), 0 6px 14px rgba(0,0,0,.5); }
  .front { position: absolute; left: -60px; right: -60px; bottom: -14px; height: 300px; z-index: 2; -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 22%); }
  .unit { position: absolute; bottom: 0; width: 470px; }
  .u0 { left: 0; } .u1 { left: 190px; bottom: 70px; width: 380px; filter: brightness(.7); } .u2 { left: 330px; }
  .u3 { left: 560px; bottom: 70px; width: 380px; filter: brightness(.7); } .u4 { left: 690px; } .u5 { left: 900px; bottom: 70px; width: 380px; filter: brightness(.7); } .u6 { left: 980px; }
  .u0, .u2, .u4, .u6 { z-index: 2; } .u1, .u3, .u5 { z-index: 1; }
  .url { position: absolute; right: 56px; top: 64px; z-index: 3; color: #9da097; font: 500 16px "Geist Mono", monospace; letter-spacing: .06em; }
</style></head><body>
  <div class="grid"></div><div class="glow"></div>
  <div class="copy">
    <div class="brand"><img src="${file("brand/rtsai-mark-256.png")}" alt=""><span>RTS <b>AI</b></span></div>
    <div class="kicker">Modern real-time strategy</div>
    <h1>Seven real-world factions.<br><em>One fictional war.</em></h1>
    <div class="flags">${flags}</div>
  </div>
  <div class="url">rtsai.net</div>
  <div class="front">${lineups}</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: "png" });
await browser.close();
writeFileSync(join(web, "public/social-card.png"), png);
console.log(`public/social-card.png: ${png.length} bytes`);
