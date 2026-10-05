/**
 * Browser check of the asset chain's "3D model" step (the GLB on the Studio's main stage).
 *
 *   node scripts/check-models.mjs [http://127.0.0.1:3461] [--gpu] [--pilots]
 *
 * Default: SwiftShader (CPU), so it never needs the shared GPU. --gpu uses the real GPU and then honours
 * C:\Users\Admin\Code\AI\logs\gpu-claim.txt (refuses while another job holds it, claims it while running).
 * Pictured models and thumbnails are project authored: the Studio opens in authored-only mode and original game
 * artwork is stubbed out of the roster before navigation.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const base = (process.argv.find(a => /^https?:/.test(a)) ?? "http://127.0.0.1:3461").replace(/\/$/, "");
const gpu = process.argv.includes("--gpu");
const claim = "C:/Users/Admin/Code/AI/logs/gpu-claim.txt", token = `RTSAI model viewer check pid=${process.pid}`;
if (gpu) {
  if (readFileSync(claim, "utf8").trim()) throw Error("GPU claimed by another job; run without --gpu (SwiftShader) or wait");
  writeFileSync(claim, token + "\n");
}
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? "C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core");
const output = resolve(".cache/model-check"); mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
  args: gpu ? [] : ["--disable-gpu", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem("rtsai-art-review-coach-v3", "1"); window.__gpuContexts = 0; window.__longTasks = []; const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...args) { if ((type === "webgl2" || type === "webgl") && !this.__counted) { window.__gpuContexts++; this.__counted = true; } return get.call(this, type, ...args); }; new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(e => Math.round(e.duration)))).observe({ type: "longtask", buffered: true }); });
  const data = await (await fetch(`${base}/api/art-review/roster?mode=ra2`)).json();
  for (const s of Object.values(data.stock)) { if (s.info?.origin === "new") continue; s.sprite = null; s.spec = { ...s.spec, voxel: null, sprite: null, cameo: null }; }
  await page.route("**/api/art-review/roster?*", r => r.fulfill({ json: data }));
  for (const type of ["ra2", "classic", "mod"]) await page.route(`**/api/art-review/${type}/**`, r => r.abort());
  await page.goto(`${base}/art/review?faction=china&unit=r2mantis&mode=ra2&view=art&authored=1`);
  await page.locator(".chain-step").first().waitFor({ timeout: 30000 });
  await page.keyboard.press("3");
  await page.locator(".glb-viewport canvas").waitFor({ timeout: 30000 });
  await page.locator(".glb-note").waitFor({ state: "detached", timeout: 30000 }).catch(() => undefined);
  assert.match(await page.locator(".glb-tag").innerText(), /30k triangles/);
  assert.equal(await page.locator(".chain-step.is-active b").innerText(), "3D model");
  const stage = page.locator(".glb-stage");
  await stage.screenshot({ path: resolve(output, "mantis-glb.png") });
  for (const name of ["Red", "Blue", "Green", "Gold", "Sky", "Purple"]) {
    await stage.getByRole("radio", { name, exact: true }).click();
    assert.equal(await stage.getByRole("radio", { name, exact: true }).getAttribute("aria-checked"), "true");
    await stage.screenshot({ path: resolve(output, `mantis-${name.toLowerCase()}.png`) });
  }
  const canvas = page.locator(".glb-viewport canvas"), box = await canvas.boundingBox();
  const before = await canvas.screenshot();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down(); await page.mouse.move(box.x + box.width * .72, box.y + box.height * .55, { steps: 12 }); await page.mouse.up();
  const orbit = !before.equals(await canvas.screenshot());
  const wire = stage.getByRole("button", { name: "Wireframe", exact: true });
  await wire.click(); assert.equal(await wire.getAttribute("aria-pressed"), "true");
  await wire.click(); await stage.screenshot({ path: resolve(output, "mantis-glb-rotated.png") });
  await page.waitForTimeout(800);
  const snapshot = await page.locator(".chain-step").nth(2).locator("img").count();
  if (process.argv.includes("--pilots")) for (const actor of ["r2cnrifle", "r2bastion", "r2skyspear", "r2haiying"]) {
    await page.goto(`${base}/art/review?faction=china&unit=${actor}&mode=ra2&view=art&authored=1&step=glb`);
    await page.locator(".glb-viewport canvas").waitFor({ timeout: 30000 });
    await page.locator(".glb-note").waitFor({ state: "detached", timeout: 30000 }).catch(() => undefined);
    await page.locator(".glb-stage").screenshot({ path: resolve(output, `${actor}-glb.png`) });
  }
  await page.keyboard.press("4");
  await page.locator(".lab-stage canvas").first().waitFor();
  const report = await page.evaluate(() => ({ gpuContexts: window.__gpuContexts, longTasks: window.__longTasks }));
  assert.equal(report.gpuContexts, 1, "the GLB step shares the Studio's one WebGL context");
  assert.ok(orbit, "dragging orbits the model");
  assert.deepEqual(errors, []);
  Object.assign(report, { renderer: gpu ? "GPU" : "SwiftShader", glbLoaded: true, orbit, wireframe: true, playerColors: 6, chainThumbnail: snapshot > 0, backToGameModel: true, pageErrors: errors, screenshot: "Project-generated Mantis only; original game art omitted" });
  writeFileSync(resolve(output, "browser.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { try { await browser.close(); } finally { if (gpu && readFileSync(claim, "utf8").trim() === token) writeFileSync(claim, ""); } }
