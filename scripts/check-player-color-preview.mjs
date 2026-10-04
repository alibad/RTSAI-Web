/** Own-art-only Studio check: native palette agreement, fixed pixels, worker color switches, screenshots. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core");
const out = resolve("../RTSAI-Art/docs/role-rebuild/player-colors");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const page = await browser.newPage({ viewport: { width: 1480, height: 950 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
// Only project-owned Qilin images may appear. Block stock pixel routes as a second guard.
await page.route("**/api/art-review/ra2/**", route => route.abort());
await page.route("**/api/art-review/roster?*", async route => {
  const response = await route.fetch(), data = await response.json();
  data.factions = data.factions.filter(f => f.id === "china").map(f => ({ ...f, units: f.units.filter(u => u.id === "r2qilin"), references: [] }));
  await route.fulfill({ response, json: data });
});
await page.addInitScript(() => {
  localStorage.setItem("rtsai-art-review-coach-v3", "1");
  window.__colorPerf = { long: [], events: [] };
  new PerformanceObserver(l => window.__colorPerf.long.push(...l.getEntries().map(e => e.duration))).observe({ type: "longtask" });
  new PerformanceObserver(l => window.__colorPerf.events.push(...l.getEntries().map(e => e.duration))).observe({ type: "event", durationThreshold: 16 });
});
try {
  await page.goto("http://127.0.0.1:3461/art/review?faction=china&unit=r2qilin&slot=concept&v=cameo-v1-role-rebuild", { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector(".lab-concept-img")?.src.startsWith("blob:"), { timeout: 30000 });
  const colors = ["Red", "Blue", "Green", "Gold", "Sky", "Purple"];
  const report = [];
  await page.getByRole("button", { name: "View", exact: true }).click();
  for (const name of colors) {
    const previous = await page.locator(".lab-concept-img").getAttribute("src");
    await page.evaluate(() => { window.__colorPerf.long = []; window.__colorPerf.events = []; });
    await page.getByRole("button", { name, exact: true }).click();
    if (name !== "Red") await page.waitForFunction(previous => {
      const img = document.querySelector(".lab-concept-img");
      return img?.src.startsWith("blob:") && img.src !== previous && img.complete;
    }, previous);
    await page.waitForTimeout(150);
    const perf = await page.evaluate(() => window.__colorPerf);
    // Export ONLY the owned concept stage; no original pixels or full-page capture.
    await page.locator(".lab-stage.is-concept").screenshot({ path: resolve(out, `${name.toLowerCase()}.png`) });
    const pixels = await page.evaluate(async () => {
      const shown = document.querySelector(".lab-concept-img");
      const data = await (await fetch("/api/art-review/state?mode=ra2")).json();
      const c = data.units.find(u => u.actor === "r2qilin").candidates.find(c => c.id === "cameo-v1-role-rebuild");
      const base = await createImageBitmap(await (await fetch(c.urls[c.files.concept])).blob());
      const read = img => { const canvas = new OffscreenCanvas(base.width, base.height); const ctx = canvas.getContext("2d"); ctx.drawImage(img,0,0); return ctx.getImageData(0,0,base.width,base.height).data; };
      const original = read(base), colored = read(shown);
      const mask = new OffscreenCanvas(base.width,base.height), ctx = mask.getContext("2d");
      ctx.scale(base.width/c.playerColor.width,base.height/c.playerColor.height); ctx.fillStyle="white";
      for (const p of c.playerColor.regions) { ctx.beginPath(); p.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y)); ctx.closePath(); ctx.fill(); }
      const regions=ctx.getImageData(0,0,base.width,base.height).data;
      let changed=0, changedOutside=0, alphaChanged=0;
      for(let i=0;i<original.length;i+=4) {
        const different=original[i]!==colored[i]||original[i+1]!==colored[i+1]||original[i+2]!==colored[i+2];
        const marked=regions[i+3]>0 && original[i]>35 && original[i]>original[i+1]*1.45 && original[i]>original[i+2]*1.45;
        if(different) { changed++; if(!marked) changedOutside++; }
        if(original[i+3]!==colored[i+3]) alphaChanged++;
      }
      base.close(); return {changed,changedOutside,alphaChanged,width:shown.naturalWidth,height:shown.naturalHeight};
    });
    assert.equal(pixels.changedOutside,0,`${name}: fixed materials unchanged`);
    assert.equal(pixels.alphaChanged,0,`${name}: silhouette unchanged`);
    assert.ok(pixels.changed>0,`${name}: identification panels actually change`);
    report.push({name,...pixels,maxLongTaskMs:Math.max(0,...perf.long),maxInputPaintMs:Math.max(0,...perf.events)});
  }
  assert.deepEqual(errors,[]);
  assert.ok(report.every(r=>r.maxLongTaskMs<=50 && r.maxInputPaintMs<=100),"color controls meet Studio budgets");
  writeFileSync(resolve(out,"verification.json"),JSON.stringify({claims:"Measured: browser preview only, not native game validation",report,errors},null,2)+"\n");
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
