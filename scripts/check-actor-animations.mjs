#!/usr/bin/env node
/**
 * Browser check of the Studio's Animations step (chain step 5, the ActionRow) against the current candidates.
 * Local only; screenshots contain only project-authored art (the page runs with ?authored=1 and original RA2
 * routes are blocked). It never presses a decision key (U, R, C, Z) and never sends a review action.
 *
 *   node scripts/check-actor-animations.mjs [--software] [--actor r2cnportable] [--spin r2mohajer,r2mantis]
 *   RTSAI_STUDIO_URL=http://127.0.0.1:3450 node scripts/check-actor-animations.mjs --software
 *
 * For one infantry candidate (the actor's newest native candidate made from its 3D model) it checks:
 *   - the action buttons are exactly the candidate's own actions (labels and count from its sequences);
 *   - play, pause and scrubbing (the idle articulates across its cycle; play advances the clock);
 *   - house recolour (another player colour changes the picture, red restores it);
 *   - Fire changes between frames, Die plays once and holds its last frame;
 * and, for each --spin actor, that its spin (a drone's propeller, a radar) moves when scrubbed: the candidate the
 * local preview copy plays, voxel (HVA frames under the preview's rules) or prerendered sprite (looping frames). Any page error fails the run. --software renders with SwiftShader and never touches the GPU,
 * which another session may hold (C:/Users/Admin/Code/AI/logs/gpu-claim.txt); without it the GPU is claimed.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { register } from "tsx/esm/api";

register();
const { candidateVehicleSprite, candidateSprite, candidatesForSlot } = await import("../lib/art-lab/review.ts");
const { fromModel } = await import("../lib/art-lab/chain.ts");
const { spriteAnimations } = await import("../lib/art-lab/sprite-anim.ts");
const { artLab, renderSpec, spriteWithUrls } = await import("../lib/art-lab/manifest.ts");

const args = process.argv.slice(2);
const flag = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const base = (process.env.RTSAI_STUDIO_URL ?? "http://127.0.0.1:3461").replace(/\/$/, "");
const actor = flag("--actor") ?? "r2cnportable";
const spinActors = (flag("--spin") ?? "r2mohajer,r2mantis").split(",").filter(Boolean);
const software = args.includes("--software");
const claim = "C:/Users/Admin/Code/AI/logs/gpu-claim.txt", token = `RTSAI animation check pid=${process.pid}`;
const existingClaim = existsSync(claim) ? readFileSync(claim, "utf8").trim() : "";
if (existingClaim && !software) throw Error("GPU claimed by another session; rerun with --software");
if (!software && existsSync(claim)) writeFileSync(claim, token + "\n");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? "C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core");
const output = resolve(".cache/animation-check");
mkdirSync(output, { recursive: true });

// The candidate the Studio opens by default: the newest native one made from the 3D model, else the newest native.
const state = await (await fetch(`${base}/api/art-review/state?mode=ra2`)).json();
const pick = id => {
  const ws = state.units.find(u => u.actor === id);
  const natives = [...candidatesForSlot(ws, "model")].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return natives.find(c => fromModel(c, ws?.candidates)) ?? natives[0] ?? null;
};
const lab = artLab.actors[actor];
assert.ok(lab, `${actor} is not a new RA2 actor`);
const candidate = pick(actor);
assert.ok(candidate && candidate.kind === "sprite", `${actor} has no native sprite candidate`);
// The Studio draws new units with the dev roster's live rules when it has them (as ReviewApp's unit index does).
const roster = await (await fetch(`${base}/api/art-review/roster?mode=ra2`)).json();
const live = roster.stock?.[actor];
const spec = live?.spec ?? renderSpec(lab), sprite = live ? live.sprite : spriteWithUrls(lab);
const made = candidateVehicleSprite(spec, candidate, sprite) ?? candidateSprite(spec, sprite, candidate);
assert.ok(made, `${actor}:${candidate.id} is not drawable from its own sequences`);
const expected = spriteAnimations(made.sprite).map(a => a.label);

const fingerprint = canvas => canvas.evaluate(c => {
  const bytes = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let hash = 2166136261;
  for (const b of bytes) hash = Math.imul(hash ^ b, 16777619);
  return hash >>> 0;
});

let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
    args: software ? ["--disable-gpu", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  const renderer = await page.evaluate(() => { const gl = document.createElement("canvas").getContext("webgl2"), info = gl?.getExtension("WEBGL_debug_renderer_info"); return gl && info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unavailable"; });
  if (software) assert.match(renderer, /SwiftShader/i, "software mode must never use the claimed GPU");
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem("rtsai-art-review-coach-v3", "1"); } catch { /* storage off */ } });
  // Loopback only (no fonts or flags from elsewhere); original RA2 and Classic art is never requested.
  const origin = new URL(base).hostname;
  await page.route("**/*", r => (new URL(r.request().url()).hostname === origin ? r.continue() : r.abort()));
  for (const type of ["ra2", "classic"]) await page.route(`**/api/art-review/${type}/**`, r => r.abort());
  // Fail loudly if anything would write a review decision.
  await page.route("**/api/art-review/action", r => { errors.push("a review action was sent"); return r.abort(); });

  const open = async (id, version) => {
    await page.goto(`${base}/art/review?mode=ra2&authored=1&faction=${artLab.actors[id].factionId}&unit=${id}&step=anim&v=${version}`);
    await page.locator('section[aria-label="Actions"]').waitFor({ timeout: 30000 });
    // One version on the stage, so the picture is the candidate's alone.
    const single = page.getByRole("radio", { name: "Single" });
    if (await single.count() && !(await single.isDisabled())) await single.click();
    await page.waitForTimeout(400);
  };
  const actions = page.locator('section[aria-label="Actions"] [role="group"][aria-label="Play an action"] button');
  const play = name => actions.filter({ hasText: new RegExp(`^${name}$`) }).first().click();
  const timeline = page.getByRole("slider", { name: "Animation time" });
  const pause = async () => { const b = page.getByRole("button", { name: "Pause animation", exact: true }); if (await b.count()) await b.click(); };
  const canvas = page.locator(".lab-stage canvas").first();
  // A range input only takes values on its step.
  const snap = async ms => { const step = Number(await timeline.getAttribute("step")) || 1; return String(Math.round(ms / step) * step); };
  const at = async ms => { await timeline.fill(await snap(ms)); await page.waitForTimeout(180); return fingerprint(canvas); };

  // 1. The candidate's own actions, exactly.
  await open(actor, candidate.id);
  // The Studio redraws the unit with the dev roster's live rules once that arrives; wait for it to settle.
  let labels = [];
  for (const end = Date.now() + 30000; Date.now() < end; await page.waitForTimeout(250)) {
    labels = (await actions.allTextContents()).map(t => t.trim());
    if (JSON.stringify(labels) === JSON.stringify(expected)) break;
  }
  assert.deepEqual(labels, expected, "the action buttons are the candidate's own actions");

  // 2. Idle: scrub across the cycle, then play and pause.
  const idle = labels.find(l => /^Idle/.test(l)) ?? labels[0];
  await play(idle);
  await timeline.waitFor();
  await pause();
  const max = Number(await timeline.getAttribute("max"));
  const idleHashes = [];
  for (let i = 0; i < 10; i++) idleHashes.push(await at(Math.round((max * i) / 10)));
  assert.ok(new Set(idleHashes).size > 1, `${idle} articulates across its cycle`);
  await timeline.fill(await snap(max / 2));
  const before = Number(await timeline.inputValue());
  await page.getByRole("button", { name: "Play animation", exact: true }).click();
  await page.waitForTimeout(600);
  assert.notEqual(Number(await timeline.inputValue()), before, "playing advances the clock");
  await pause();
  const paused = Number(await timeline.inputValue());
  await page.waitForTimeout(400);
  assert.equal(Number(await timeline.inputValue()), paused, "pause holds the clock");
  await page.locator(".lab-stage").screenshot({ path: resolve(output, `${actor}-idle.png`) });

  // 3. House recolour: the player-colour panels change, red restores the picture.
  const red = await fingerprint(canvas);
  const colours = page.getByRole("radiogroup", { name: "Player colour" }).first();
  await colours.getByRole("radio", { name: "Blue", exact: true }).click();
  await page.waitForTimeout(300);
  const blue = await fingerprint(canvas);
  assert.notEqual(blue, red, "another house colour changes the picture");
  await colours.getByRole("radio", { name: "Red", exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await fingerprint(canvas), red, "red restores it");

  // 4. Fire articulates; Die plays once and holds its last frame.
  const fire = labels.find(l => l === "Fire");
  assert.ok(fire, "the candidate has a Fire action");
  await play(fire);
  await pause();
  const fireMax = Number(await timeline.getAttribute("max"));
  const fireHashes = [];
  for (let i = 0; i < 6; i++) fireHashes.push(await at(Math.round((fireMax * i) / 6)));
  assert.ok(new Set(fireHashes).size > 1, "Fire changes between frames");
  const die = labels.find(l => /^Die/.test(l));
  assert.ok(die, "the candidate has a Die action");
  await play(die);
  await page.getByRole("button", { name: "Play animation", exact: true }).waitFor({ timeout: 15000 });
  const dead = await fingerprint(canvas);
  await page.waitForTimeout(400);
  assert.equal(await fingerprint(canvas), dead, "Die holds its last frame");
  await page.locator('section[aria-label="Actions"]').screenshot({ path: resolve(output, `${actor}-actions.png`) });

  // 5. Spins the preview copy's rules play: drone propellers (WithVoxelHelicopterBody), radars (WithAnimatedVoxelModel).
  const spins = [];
  // The candidate the local preview copy plays (installed bytes), else the default one.
  const preview = await (await fetch(`${base}/api/art-review/preview?mode=ra2`)).json();
  for (const id of spinActors) {
    const installed = preview.actors?.[id]?.model;
    const c = state.units.find(u => u.actor === id)?.candidates.find(x => x.id === installed) ?? pick(id);
    if (!c || !["voxel", "sprite"].includes(c.kind)) { spins.push({ actor: id, skipped: "no game-model candidate" }); continue; }
    await open(id, c.id);
    // The preview copy's rules arrive with the preview status, a moment after the page.
    await actions.filter({ hasText: /spin|Propeller|Moving parts/i }).first().waitFor({ timeout: 20000 }).catch(() => undefined);
    const spin = (await actions.allTextContents()).map(t => t.trim()).find(l => /spin|Propeller|Moving parts/i.test(l));
    assert.ok(spin, `${id}: the candidate's spin is offered`);
    await play(spin);
    await pause();
    const spinMax = Number(await timeline.getAttribute("max"));
    const hashes = [];
    for (let i = 0; i < 4; i++) hashes.push(await at(Math.round((spinMax * i) / 4)));
    assert.ok(new Set(hashes).size > 1, `${id}: ${spin} moves when scrubbed`);
    spins.push({ actor: id, candidate: c.id, kind: c.kind, inPreview: c.id === installed, action: spin, frames: new Set(hashes).size });
  }

  assert.deepEqual(errors, [], "no page errors");
  const report = { studio: base, renderer, candidate: { actor, id: candidate.id, actions: labels }, idleFrames: new Set(idleHashes).size, playPause: true, recolour: true, fireFrames: new Set(fireHashes).size, dieHeld: true, spins, pageErrors: errors, originalScreenshots: 0 };
  writeFileSync(resolve(output, "browser.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  try { await browser?.close(); } finally { if (existsSync(claim) && readFileSync(claim, "utf8").trim() === token) writeFileSync(claim, ""); }
}
