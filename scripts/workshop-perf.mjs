#!/usr/bin/env node
/**
 * Performance check for the Workshop battlefield with unit art (adapted from art-review-perf.mjs), driven with real
 * mouse and keyboard input in a headless Chromium page with SwiftShader (the deterministic worst case).
 *
 *   PLAYWRIGHT_CORE=<path to a playwright-core package> CHROME_PATH=<chrome.exe> \
 *     node --import tsx scripts/workshop-perf.mjs [http://127.0.0.1:3480] [--units 60] [--json out.json] [--gpu]
 *
 * Point it at the local app (Studio preview with the site behind it: local art) or at the site alone (public art).
 * It loads a seeded scene with --units actors (default 60: both sides, every category) and measures:
 *   - time until every placed actor shows its art (or its marker), and the frames rasterized;
 *   - idle main-thread time in edit mode (CDP TaskDuration over 4 s): must be near zero;
 *   - pan (shift-drag) and wheel zoom: frames per second and the worst frame gap;
 *   - a running battle (8 s): fps, long tasks, input-to-paint of clicks made during it;
 *   - input-to-paint (Event Timing) for tool buttons and opening and choosing in the UI kit pickers;
 *   - WebGL contexts created by the page (budget: at most 1; the unit art itself uses none).
 * Exits non-zero when a budget fails.
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { generateScene, makePiece, placementIssue, scenarioJson } from "../lib/workshop.ts";
import { rosterActors, rosterFactions } from "../lib/game-content.ts";

const args = process.argv.slice(2);
const base = (args.find(a => /^https?:/.test(a)) ?? "http://127.0.0.1:3480").replace(/\/$/, "");
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const unitCount = args.includes("--units") ? Number(args[args.indexOf("--units") + 1]) : 60;
const gpu = args.includes("--gpu");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "playwright-core");

const BUDGET = { longTaskMs: 50, respondMs: 100, minFps: 55, idleCpuPct: 2, webglContexts: 1 };

/** A battle line: China against Russia, cycling through each faction's ground actors, aircraft and defences. */
function battleScene(count) {
  const scene = generateScene("ra2", 7, 64, "plains");
  scene.title = "Performance battle";
  for (const [team, factionId, x0, dir] of [["blue", "china", 28, 1], ["red", "russia", 35, -1]]) {
    const faction = rosterFactions("ra2").find(f => f.id === factionId);
    const actors = rosterActors(faction).filter(a => a.category !== "structure" && a.category !== "ship" && a.behavior.weapons.some(w => (w.damage ?? 0) > 0));
    let placed = 0;
    for (let i = 0; placed < count / 2 && i < 400; i++) {
      const actor = actors[i % actors.length];
      const piece = makePiece(scene, actor.key, factionId, team, { x: x0 - dir * Math.floor(placed / 10) * 2, y: 22 + (placed % 10) * 2 });
      if (!placementIssue(scene, piece)) { scene.pieces.push(piece); placed++; }
      else { piece.x += dir; if (!placementIssue(scene, piece)) { scene.pieces.push(piece); placed++; } }
    }
  }
  return scene;
}

const init = scene => {
  try { localStorage.setItem("rtsai-workshop-scene-v1", scene); } catch { /* ignore */ }
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

const scene = battleScene(unitCount);
const browser = await chromium.launch({
  headless: true, executablePath: process.env.CHROME_PATH || undefined,
  args: gpu ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const results = { base, units: scene.pieces.length, gpu, steps: [], failures: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(init, scenarioJson(scene));
  const page = await context.newPage();
  const client = await context.newCDPSession(page);
  await client.send("Performance.enable");
  const t0 = Date.now();
  await page.goto(`${base}/workshop`, { waitUntil: "load", timeout: 120000 });
  const map = page.locator(".workshop-map");
  await map.scrollIntoViewIfNeeded();
  // Every placed actor drawn: no frames left in the art queue for a moment.
  let settled = 0, frames = 0, source = "";
  for (let i = 0; i < 600 && settled < 4; i++) {
    await page.waitForTimeout(250);
    const s = await map.evaluate(el => ({ frames: Number(el.dataset.artFrames ?? 0), pending: Number(el.dataset.artPending ?? 1), source: el.dataset.artSource ?? "" }));
    frames = s.frames; source = s.source;
    settled = s.pending === 0 && s.frames > 0 ? settled + 1 : 0;
  }
  results.artReadyMs = Date.now() - t0;
  // Long tasks from navigation through hydration and the whole art warm-up (rasterizing runs in workers).
  const load = await page.evaluate(() => ({ long: window.__perf.long.map(l => ({ at: Math.round(l.at), ms: Math.round(l.ms) })), hydrated: Math.round(performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd ?? 0) }));
  results.loadLongTasks = load.long;
  const afterHydration = load.long.filter(l => l.at > load.hydrated + 1500);
  console.log(`load: long tasks ${load.long.map(l => `${l.ms} ms @${l.at}`).join(", ") || "none"} (DOMContentLoaded ${load.hydrated} ms); during art warm-up: ${afterHydration.map(l => l.ms).join(", ") || "none"}`);
  results.warmupLongTasks = afterHydration.map(l => l.ms);
  results.artFrames = frames; results.artSource = source;
  console.log(`${scene.pieces.length} actors · art from ${source || "?"} · ${frames} frames rasterized · all drawn ${results.artReadyMs} ms after navigation`);

  const box = await page.locator(".workshop-map > canvas").boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const step = async (name, fn, { record = true } = {}) => {
    await page.evaluate(record => {
      window.__perf.long = []; window.__perf.events = []; window.__perf.frames = [];
      const gen = (window.__perf.gen = (window.__perf.gen ?? 0) + 1);
      if (!record) return;
      const tick = t => { if (window.__perf.gen !== gen) return; window.__perf.frames.push(t); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, record);
    const started = Date.now();
    const extra = (await fn()) ?? {};
    const wall = Date.now() - started;
    await page.waitForTimeout(250);
    const r = await page.evaluate(() => { window.__perf.gen++; return { long: window.__perf.long, events: window.__perf.events, frames: window.__perf.frames }; });
    const s = { name, wallMs: wall, longTasks: r.long.map(l => Math.round(l.ms)), worstEventMs: Math.round(Math.max(0, ...r.events.map(e => e.ms))), ...(record ? stats(r.frames) : {}), ...extra };
    results.steps.push(s);
    const long = s.longTasks.filter(x => x > BUDGET.longTaskMs);
    console.log(`${name.padEnd(30)} long>50: ${long.length ? long.join(",") : "none"}  input→paint max ${s.worstEventMs} ms${record ? `  ${s.fps} fps (worst gap ${s.worstGapMs} ms)` : ""}${Object.keys(extra).length ? "  " + JSON.stringify(extra) : ""}`);
    return s;
  };
  const cpu = async ms => {
    const m0 = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
    await page.waitForTimeout(ms);
    const m1 = Object.fromEntries((await client.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
    return Math.round(((m1.TaskDuration - m0.TaskDuration) / (ms / 1000)) * 1000) / 10;
  };

  const idle = await step("idle, editing (4 s)", async () => ({ idleCpuPct: await cpu(4000) }), { record: false });
  const pan = await step("pan: shift-drag", async () => {
    await page.mouse.move(cx - 150, cy); await page.keyboard.down("Shift"); await page.mouse.down();
    for (let i = 1; i <= 90; i++) { await page.mouse.move(cx - 150 + i * 3, cy + Math.sin(i / 9) * 30); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.keyboard.up("Shift");
  });
  const zoom = await step("wheel zoom in and out", async () => {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
    return { zoom: await page.locator(".workshop-map-status span").first().textContent() };
  });
  const tools = await step("tool buttons ×6", async () => {
    for (const name of ["Move", "Attack", "Pan", "Land", "Erase", "Select"]) { await page.locator(".workshop-tools").getByRole("button", { name, exact: true }).click(); await page.waitForTimeout(120); }
  });
  const pickers = await step("pickers: open and choose", async () => {
    await page.getByRole("combobox", { name: "Category" }).click(); await page.waitForTimeout(250);
    await page.getByRole("option", { name: "Vehicles" }).click(); await page.waitForTimeout(250);
    await page.getByRole("combobox", { name: "Faction" }).click(); await page.waitForTimeout(250);
    await page.keyboard.type("rus"); await page.waitForTimeout(200); await page.keyboard.press("Enter"); await page.waitForTimeout(250);
    await page.getByRole("combobox", { name: "Category" }).click(); await page.waitForTimeout(250);
    await page.getByRole("option", { name: "All actors" }).click(); await page.waitForTimeout(250);
  });
  await page.mouse.move(cx, cy); for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
  const battle = await step("battle running (8 s)", async () => {
    await page.getByRole("button", { name: "Run battle" }).click();
    await page.waitForTimeout(2500);
    await page.getByRole("combobox", { name: "Simulation speed" }).click(); await page.waitForTimeout(200);
    await page.getByRole("option", { name: "2×" }).click();
    await page.waitForTimeout(2500);
    await page.mouse.move(cx - 100, cy); await page.keyboard.down("Shift"); await page.mouse.down();
    for (let i = 1; i <= 40; i++) { await page.mouse.move(cx - 100 + i * 4, cy); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.keyboard.up("Shift");
    await page.waitForTimeout(2000);
    return { alive: await page.locator(".workshop-battle-readout dd").first().textContent(), frames: await map.evaluate(el => Number(el.dataset.artFrames ?? 0)) };
  });
  const paused = await step("paused after battle (4 s)", async () => {
    await page.getByRole("button", { name: "Pause" }).click();
    await page.waitForTimeout(500);
    return { idleCpuPct: await cpu(4000) };
  }, { record: false });
  results.webglContexts = await page.evaluate(() => window.__perf.contexts);
  console.log(`WebGL contexts created: ${results.webglContexts}`);

  const check = (ok, message) => { if (!ok) results.failures.push(message); };
  for (const s of results.steps) {
    check(!s.longTasks.some(ms => ms > BUDGET.longTaskMs), `${s.name}: long task over ${BUDGET.longTaskMs} ms (${s.longTasks.join(", ")})`);
    check(s.worstEventMs <= BUDGET.respondMs, `${s.name}: input→paint ${s.worstEventMs} ms`);
  }
  check(!results.warmupLongTasks.some(ms => ms > BUDGET.longTaskMs), `art warm-up: long task over ${BUDGET.longTaskMs} ms (${results.warmupLongTasks.join(", ")})`);
  check(idle.idleCpuPct <= BUDGET.idleCpuPct, `idle CPU ${idle.idleCpuPct}%`);
  check(paused.idleCpuPct <= BUDGET.idleCpuPct, `paused CPU ${paused.idleCpuPct}%`);
  for (const s of [pan, zoom]) check(s.fps >= BUDGET.minFps, `${s.name}: ${s.fps} fps`);
  check(battle.fps >= BUDGET.minFps, `battle: ${battle.fps} fps`);
  check(results.webglContexts <= BUDGET.webglContexts, `WebGL contexts: ${results.webglContexts}`);
  void tools; void pickers;
} finally {
  await browser.close();
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
console.log(results.failures.length ? `\nBudget failures:\n- ${results.failures.join("\n- ")}` : "\nAll budgets met.");
process.exit(results.failures.length ? 1 : 0);
