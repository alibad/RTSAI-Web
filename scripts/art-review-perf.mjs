#!/usr/bin/env node
/**
 * Performance check for the Art Lab Review screen (local dev server only), driven with real mouse and keyboard
 * input in a visible-rendering Chromium page (headless, requestAnimationFrame running).
 *
 *   PLAYWRIGHT_CORE=<path to a playwright-core package> CHROME_PATH=<chrome.exe> \
 *     node scripts/art-review-perf.mjs [http://localhost:3461] [--json out.json]
 *
 * Measures, per unit (r2qilin in China, the largest roster: voxels + sprite candidates + its RA2 Reference;
 * r2mantis: the asset chain with its GLB 3D-model step and a GLB-made VXL candidate; r2cnrifle: a GLB-made SHP
 * infantry candidate in the Animations step; r2bastion: a GLB-made SHP defence; r2sang: infantry sprite;
 * mtnk: an original RA2 voxel unit; e1: an original RA2 infantry):
 *   - long tasks (PerformanceObserver "longtask") after load, during every interaction;
 *   - drag-rotate with the mouse: frames per second, worst frame gap, and that the facing really changed;
 *   - input-to-paint for clicks and key presses (Event Timing API) on slot, version, compare and 3D switches;
 *   - WebGL contexts created on the page (must be at most 1);
 *   - idle main-thread time (CDP Performance.getMetrics TaskDuration over 4 s with nothing playing);
 *   - the unit rail of the largest faction: picker switches by keyboard, roster filters, J x10, scrolling;
 *   - the asset chain: every step by keyboard (1-7), the GLB load on the main stage, orbit drag, player colours;
 *   - the review board: load, J/K and arrow navigation, faction switches, hover to 2x, the poster export. It never
 *     presses a decision key (U, R, C, Z): decisions are the owner's.
 * Exits non-zero when a budget fails.
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const base = (args.find(a => /^https?:/.test(a)) ?? "http://localhost:3461").replace(/\/$/, "");
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
// --gpu: the machine's real GPU through ANGLE/D3D11 (what a desktop Chrome uses); default: SwiftShader, the
// software renderer, as a deterministic worst case in which WebGL work also delays compositing.
const gpu = args.includes("--gpu");
const require = createRequire(import.meta.url);
const pwPath = process.env.PLAYWRIGHT_CORE ?? "playwright-core";
const { chromium } = require(pwPath);

const BUDGET = { longTaskMs: 50, respondMs: 100, minDragFps: 55, idleCpuPct: 2, webglContexts: 1 };

const init = () => {
  try { localStorage.setItem("rtsai-art-review-coach-v3", "1"); } catch { /* ignore */ }
  window.__perf = { long: [], events: [], contexts: 0, frames: [] };
  new PerformanceObserver(list => { for (const e of list.getEntries()) window.__perf.long.push({ at: e.startTime, ms: e.duration }); }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) if (["click", "keydown", "pointerdown", "pointerup"].includes(e.name)) window.__perf.events.push({ name: e.name, ms: e.duration, at: e.startTime });
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const had = this.__ctxType;
    const ctx = getContext.call(this, type, ...rest);
    if (ctx && !had && /webgl/i.test(type)) window.__perf.contexts++;
    if (ctx) this.__ctxType = type;
    return ctx;
  };
};

function stats(frames) {
  const gaps = frames.slice(1).map((t, i) => t - frames[i]);
  const total = frames.length > 1 ? frames.at(-1) - frames[0] : 0;
  return { frames: frames.length, fps: total ? Math.round(((frames.length - 1) * 1000) / total) : 0, worstGapMs: Math.round(Math.max(0, ...gaps)) };
}

async function run(page, client, label, url, rail = false, chain = null) {
  const out = { unit: label, steps: [] };
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector(".lab-stage canvas", { timeout: 20000 });
  await page.waitForTimeout(3500);
  await page.evaluate(() => { window.__perf.long = []; window.__perf.events = []; });
  const box = await page.locator(".lab-stage").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height * 0.45;

  const readFacing = () => page.locator(".lab-corner.is-br .lab-readout").first().getAttribute("title");
  const step = async (name, fn, { record = true } = {}) => {
    await page.evaluate(record => {
      window.__perf.long = []; window.__perf.events = []; window.__perf.frames = [];
      const gen = (window.__perf.gen = (window.__perf.gen ?? 0) + 1);
      if (!record) return;
      const tick = t => { if (window.__perf.gen !== gen) return; window.__perf.frames.push(t); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, record);
    const t0 = Date.now();
    const extra = await fn();
    const wall = Date.now() - t0;
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => { window.__perf.gen++; return { long: window.__perf.long, events: window.__perf.events, frames: window.__perf.frames }; });
    const s = { name, wallMs: wall, longTasks: r.long.map(l => Math.round(l.ms)), events: r.events.map(e => `${e.name} ${Math.round(e.ms)}`), worstEventMs: Math.round(Math.max(0, ...r.events.map(e => e.ms))), ...stats(r.frames), ...extra };
    out.steps.push(s);
    console.log(`${label.padEnd(8)} ${name.padEnd(30)} long>50: ${s.longTasks.filter(x => x > BUDGET.longTaskMs).length ? s.longTasks.join(",") : "none"}  input→paint max ${s.worstEventMs} ms  ${s.fps} fps (worst gap ${s.worstGapMs} ms)${extra ? "  " + JSON.stringify(extra) : ""}`);
    return s;
  };

  const drag = async (shift = false) => {
    const before = await readFacing();
    await page.mouse.move(cx - 160, cy);
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.down();
    for (let i = 1; i <= 90; i++) { await page.mouse.move(cx - 160 + i * 4, cy); await page.waitForTimeout(16); }
    await page.mouse.up();
    if (shift) await page.keyboard.up("Shift");
    const after = await readFacing();
    return { facing: `${before} → ${after}` };
  };

  await step("idle (4 s)", async () => {
    const m0 = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
    await page.waitForTimeout(4000);
    const m1 = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
    return { idleCpuPct: Math.round(((m1.TaskDuration - m0.TaskDuration) / 4) * 1000) / 10 };
  }, { record: false });
  await step("drag rotate", () => drag(false));
  await step("shift+drag turret", () => drag(true));
  await step("wheel zoom", async () => { await page.mouse.move(cx, cy); for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(60); } for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); } return { zoom: await page.locator(".lab-corner.is-br .lab-readout").last().textContent() }; });
  await step("versions → → → →", async () => { for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(120); } for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(120); } });
  for (const mode of ["Side by side", "Swipe", "Lineup", "Single"]) {
    const button = page.getByRole("radio", { name: mode });
    if (await button.isDisabled().catch(() => true)) continue;
    await step(`compare: ${mode}`, async () => { await button.click(); await page.waitForTimeout(400); });
  }
  const threeD = page.getByRole("button", { name: "3D", exact: true });
  if (await threeD.count()) {
    await step("3D orbit on", async () => { await threeD.click(); await page.waitForTimeout(500); return { webglCanvasOnStage: await page.locator(".lab-stage-gl canvas").count() }; });
    await step("orbit drag", async () => {
      const shot0 = await page.locator(".lab-stage-gl canvas").screenshot();
      await page.mouse.move(cx - 100, cy); await page.mouse.down();
      for (let i = 1; i <= 50; i++) { await page.mouse.move(cx - 100 + i * 4, cy + i); await page.waitForTimeout(16); }
      await page.mouse.up();
      const shot1 = await page.locator(".lab-stage-gl canvas").screenshot();
      return { orbitChanged: !shot0.equals(shot1) };
    });
    await step("explode", async () => { await page.getByRole("button", { name: "Explode", exact: true }).click(); await page.waitForTimeout(400); return { labels: await page.locator(".lab-part-label").count() }; });
    await step("3D off", async () => { await page.getByRole("button", { name: "3D", exact: true }).click(); await page.waitForTimeout(300); });
  }
  const openList = () => page.locator("[data-slot=select-content][data-open], [data-slot=combobox-content][data-open]").last();
  const anim = page.getByRole("combobox", { name: "Animation" });
  // UI-kit selects: open the field, then pick the option by its name in the open list (the version strip has options too).
  const optionsOf = async field => { await field.click(); const names = await openList().getByRole("option").allTextContents(); await page.keyboard.press("Escape"); return names.map(n => n.trim()); };
  // A choice must close the list (a stage that swallows the portalled pointer events would leave it open). Focus then
  // stays on the field, which keeps its keys as a native <select> did; blur it so the next shortcut reaches the Studio.
  const closed = async (field, name) => {
    if (!(await page.waitForFunction(el => el.getAttribute("aria-expanded") !== "true", await field.elementHandle(), { timeout: 5000 }).then(() => true, () => false))) throw Error(`choosing "${name}" left its list open`);
    const handle = await field.elementHandle();
    await page.waitForFunction(el => document.activeElement === el, handle, { timeout: 2000 }).catch(() => undefined); // focus returns after the close animation
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  };
  const pick = async (field, name) => { await field.click(); await openList().getByRole("option", { name, exact: true }).click(); await closed(field, name); };
  if (await anim.count()) {
    // Infantry walk; otherwise the second action the version has (a defence's build-up or fire).
    const labels = await optionsOf(anim);
    const play = labels.includes("Walk") ? "Walk" : labels[1] ?? labels[0];
    const rest = labels[0];
    await step(`animation: ${play}`, async () => { await pick(anim, play); await page.waitForTimeout(800); });
    await step("playing (2 s)", async () => {
      const m0 = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
      await page.waitForTimeout(2000);
      const m1 = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
      return { cpuPct: Math.round(((m1.TaskDuration - m0.TaskDuration) / 2) * 1000) / 10 };
    }, { record: false });
    await step(`animation: ${rest}`, async () => { await pick(anim, rest); await page.waitForTimeout(300); });
  }
  if (rail) {
    await step("rail: picker → Türkiye → China", async () => {
      // The faction field is a searchable list: open it, type the name, Enter picks the first match.
      for (const target of ["Türkiye", "China"]) {
        await page.getByRole("combobox", { name: "Faction" }).click();
        await page.waitForTimeout(150);
        await page.keyboard.type(target);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(500);
      }
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      return { units: await page.locator(".lab-rail li").count() };
    });
    await step("rail: roster filters", async () => {
      const seen = {};
      const select = page.getByRole("combobox", { name: "Roster filter" });
      for (const value of ["Original", "New", "Has candidates", "Needs decision", "All artwork"]) {
        await select.click();
        const option = openList().getByRole("option", { name: new RegExp(`^${value} ·`) });
        if (!(await option.count()) || (await option.getAttribute("aria-disabled")) === "true" || (await option.getAttribute("data-disabled")) !== null) { await page.keyboard.press("Escape"); continue; }
        await option.click();
        await closed(select, value);
        await page.waitForTimeout(200);
        seen[value] = await page.locator(".lab-rail li").count();
      }
      return seen;
    });
    await step("rail: J ×10", async () => { await page.mouse.click(cx, cy - 200); for (let i = 0; i < 10; i++) { await page.keyboard.press("j"); await page.waitForTimeout(120); } });
    await step("rail: scroll", async () => {
      const r = await page.locator(".lab-rail").boundingBox();
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(30); }
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(30); }
    });
  }
  if (chain) {
    await step("chain steps 2 4 5 6 7 8 1 4", async () => { for (const k of ["2", "4", "5", "6", "7", "8", "1", "4"]) { await page.keyboard.press(k); await page.waitForTimeout(400); } return { steps: await page.locator(".chain-step").count() }; });
    if (chain.anim) {
      await step(`animations step: ${chain.anim}`, async () => {
        await page.keyboard.press("5"); await page.waitForTimeout(400);
        await page.locator(".studio-action-row button", { hasText: chain.anim }).first().click(); await page.waitForTimeout(800);
      });
      await step("animation playing (2 s)", async () => {
        const m0 = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
        await page.waitForTimeout(2000);
        const m1 = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
        return { cpuPct: Math.round(((m1.TaskDuration - m0.TaskDuration) / 2) * 1000) / 10 };
      }, { record: false });
      await step("player colours ×6 (P)", async () => { for (let i = 0; i < 6; i++) { await page.keyboard.press("p"); await page.waitForTimeout(150); } });
      await step("back to game model (4)", async () => { await page.keyboard.press("4"); await page.waitForTimeout(400); });
    }
    if (chain.glb) {
      await step("3D model step: GLB load (3)", async () => {
        const t0 = Date.now();
        await page.keyboard.press("3");
        await page.locator(".glb-viewport canvas").waitFor({ timeout: 60000 });
        await page.locator(".glb-note").waitFor({ state: "detached", timeout: 60000 }).catch(() => undefined);
        return { loadMs: Date.now() - t0 };
      });
      const glb = await page.locator(".glb-viewport").boundingBox();
      await step("GLB orbit drag", async () => {
        const canvas = page.locator(".glb-viewport canvas");
        const shot0 = await canvas.screenshot();
        const x = glb.x + glb.width / 2, y = glb.y + glb.height / 2;
        await page.mouse.move(x - 120, y); await page.mouse.down();
        for (let i = 1; i <= 60; i++) { await page.mouse.move(x - 120 + i * 4, y + (i % 10)); await page.waitForTimeout(16); }
        await page.mouse.up();
        const shot1 = await canvas.screenshot();
        return { orbitChanged: !shot0.equals(shot1) };
      });
      await step("GLB player colours", async () => { for (const name of ["Blue", "Green", "Gold", "Sky", "Purple", "Red"]) { await page.getByRole("radio", { name, exact: true }).first().click(); await page.waitForTimeout(120); } });
      await step("GLB idle (3 s)", async () => {
        const m0 = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
        await page.waitForTimeout(3000);
        const m1 = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
        return { idleCpuPct: Math.round(((m1.TaskDuration - m0.TaskDuration) / 3) * 1000) / 10 };
      }, { record: false });
      await step("back to game model (4)", async () => { await page.keyboard.press("4"); await page.waitForTimeout(600); return { stageCanvas: await page.locator(".lab-stage canvas").count() }; });
    }
  } else {
    await step("slots 2 → 3 → 1", async () => { for (const k of ["2", "3", "1"]) { await page.keyboard.press(k); await page.waitForTimeout(400); } });
  }
  await step("spin (1.5 s)", async () => { await page.keyboard.press(" "); await page.waitForTimeout(1500); await page.keyboard.press(" "); });
  out.webglContexts = await page.evaluate(() => window.__perf.contexts);
  out.canvases = await page.evaluate(() => document.querySelectorAll("canvas").length);
  console.log(`${label.padEnd(8)} WebGL contexts created: ${out.webglContexts}; canvases on the page: ${out.canvases}`);
  return out;
}

async function runBoard(page, client) {
  const out = { unit: "board", steps: [] };
  await page.goto(`${base}/art/review?mode=ra2&faction=china&view=board`, { waitUntil: "load" });
  await page.waitForSelector(".board-tile", { timeout: 30000 });
  await page.waitForTimeout(6000);
  const step = async (name, fn, { record = true } = {}) => {
    await page.evaluate(record => {
      window.__perf.long = []; window.__perf.events = []; window.__perf.frames = [];
      const gen = (window.__perf.gen = (window.__perf.gen ?? 0) + 1);
      if (!record) return;
      const tick = t => { if (window.__perf.gen !== gen) return; window.__perf.frames.push(t); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, record);
    const extra = await fn();
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => { window.__perf.gen++; return { long: window.__perf.long, events: window.__perf.events, frames: window.__perf.frames }; });
    const s = { name, longTasks: r.long.map(l => Math.round(l.ms)), worstEventMs: Math.round(Math.max(0, ...r.events.map(e => e.ms))), ...stats(r.frames), ...extra };
    out.steps.push(s);
    console.log(`board    ${name.padEnd(30)} long>50: ${s.longTasks.filter(x => x > BUDGET.longTaskMs).length ? s.longTasks.join(",") : "none"}  input→paint max ${s.worstEventMs} ms  ${s.fps} fps (worst gap ${s.worstGapMs} ms)${extra ? "  " + JSON.stringify(extra) : ""}`);
  };
  const idle = async seconds => {
    const m0 = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
    await page.waitForTimeout(seconds * 1000);
    const m1 = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
    return { idleCpuPct: Math.round(((m1.TaskDuration - m0.TaskDuration) / seconds) * 1000) / 10 };
  };
  await step("idle (4 s)", () => idle(4), { record: false });
  await page.locator(".board-tile.is-focused > button").focus();
  await step("J ×10", async () => { for (let i = 0; i < 10; i++) { await page.keyboard.press("j"); await page.waitForTimeout(120); } return { focused: await page.locator(".board-tile.is-focused .board-name b").textContent() }; });
  await step("arrows ↓ ↑ ← →", async () => { for (const k of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]) { await page.keyboard.press(k); await page.waitForTimeout(150); } });
  await step("hover 6 tiles (2×)", async () => { const tiles = page.locator(".board-tile > button"); for (let i = 0; i < 6; i++) { await tiles.nth(i).hover(); await page.waitForTimeout(150); } });
  await step("faction: Türkiye → China", async () => { for (const f of ["Türkiye", "China"]) { await page.locator(".board-factions button", { hasText: f }).click(); await page.waitForTimeout(1500); } return { tiles: await page.locator(".board-tile").count() }; });
  await step("poster PNG", async () => { const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: /Poster PNG/ }).click()]); return { file: d.suggestedFilename() }; });
  await step("play card open/close", async () => { await page.getByRole("button", { name: /Play the new look/ }).click(); await page.waitForTimeout(300); await page.keyboard.press("Escape"); await page.waitForTimeout(200); });
  await step("idle after (4 s)", () => idle(4), { record: false });
  out.webglContexts = await page.evaluate(() => window.__perf.contexts);
  console.log(`board    WebGL contexts created: ${out.webglContexts}`);
  return out;
}

const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROME_PATH || undefined,
  args: gpu ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
console.log(`Renderer: ${gpu ? "real GPU (ANGLE D3D11)" : "SwiftShader (software)"}`);
const results = [];
try {
  for (const [label, query, rail, chain] of [
    ["r2qilin", "faction=china&unit=r2qilin&slot=model", true, {}],
    ["r2mantis", "faction=china&unit=r2mantis", false, { glb: true }],
    ["r2cnrifle", "faction=china&unit=r2cnrifle", false, { anim: "Fire" }],
    ["r2bastion", "faction=china&unit=r2bastion", false, { anim: "Fire" }],
    ["r2sang", "faction=saudi&unit=r2sang&slot=model", false, {}],
    ["mtnk", "faction=china&unit=mtnk&slot=model"],
    ["e1", "faction=china&unit=e1&slot=model"],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(init);
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    await client.send("Performance.enable");
    results.push(await run(page, client, label, `${base}/art/review?${query}`, rail, chain ?? null));
    await context.close();
  }
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await context.addInitScript(init);
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    await client.send("Performance.enable");
    results.push(await runBoard(page, client));
    await context.close();
  }
} finally {
  await browser.close();
}

const failures = [];
for (const r of results) {
  if (r.webglContexts > BUDGET.webglContexts) failures.push(`${r.unit}: ${r.webglContexts} WebGL contexts`);
  for (const s of r.steps) {
    const long = s.longTasks.filter(x => x > BUDGET.longTaskMs);
    if (long.length) failures.push(`${r.unit} ${s.name}: long tasks ${long.join(", ")} ms`);
    if (s.worstEventMs > BUDGET.respondMs) failures.push(`${r.unit} ${s.name}: input to paint ${s.worstEventMs} ms`);
    if (/drag/.test(s.name) && s.fps < BUDGET.minDragFps) failures.push(`${r.unit} ${s.name}: ${s.fps} fps`);
    if (s.idleCpuPct !== undefined && s.idleCpuPct > BUDGET.idleCpuPct) failures.push(`${r.unit} idle CPU ${s.idleCpuPct}%`);
    if (s.orbitChanged === false) failures.push(`${r.unit}: orbit drag did not change the 3D view`);
    // A building is one authored isometric view: it has no facing to turn (its readout is absent).
    if (s.facing && s.facing !== "null → null" && s.facing.split(" → ")[0] === s.facing.split(" → ")[1] && s.name === "drag rotate") failures.push(`${r.unit}: drag did not rotate`);
    if (/rail:/.test(s.name) && s.worstGapMs > 100) failures.push(`${r.unit} ${s.name}: a ${s.worstGapMs} ms frame gap`);
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ budget: BUDGET, results, failures }, null, 2));
console.log(failures.length ? `\nFAIL\n- ${failures.join("\n- ")}` : "\nPASS: every budget met");
process.exit(failures.length ? 1 : 0);
