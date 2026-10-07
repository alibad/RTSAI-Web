// Sound check: every sound the mod's rules reference resolves to a file, decodes, and plays in a browser.
//
//   node scripts/check-sounds.mjs                     # rules + files only (no browser)
//   RTSAI_STUDIO_URL=http://127.0.0.1:3471 node scripts/check-sounds.mjs --browser [--strict]
//
// For the 122 modern actors (their faction's prefixes), every roster actor of the original factions, and each
// faction's announcer: resolve voices, weapon reports and impacts, death and deploy sounds from RTSAI-Mod main's
// rules (lib/art-lab/sounds.ts). Project clips must exist in the mod and decode (PCM or IMA ADPCM WAV). Original
// RA2 clips are extracted into the private, gitignored originals cache (never published) and must decode; a name
// the player's RA2 content does not hold is reported. With --browser, every distinct clip is fetched from the local
// Studio and decoded by Chrome's Web Audio (SwiftShader, no GPU). Project failures fail the run; missing originals
// fail it only with --strict. Prints a JSON summary; writes the full list to .cache/sound-check/report.json.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { register } from "tsx/esm/api";

register();
const { originalsConfig, cachedFile, extractOriginals } = await import("../lib/art-lab/originals.ts");
const { soundData, describe } = await import("../lib/art-lab/sounds-server.ts");
const { actorSounds, factionSpeech } = await import("../lib/art-lab/sounds.ts");
const { toPcmWav, wavInfo } = await import("../lib/art-lab/wav.ts");
const { artLab } = await import("../lib/art-lab/manifest.ts");

const args = process.argv.slice(2);
const browserCheck = args.includes("--browser"), strict = args.includes("--strict");
const web = resolve(".");
const cfg = originalsConfig(web);
const loaded = soundData(cfg.modRoot);
const roster = JSON.parse(readFileSync(resolve("data/factions.generated.json"), "utf8")).rosters;

/** Every (actor, faction) the game can field in RA2 mode, and every announcer. */
const uses = new Map(); // file -> { origin, clip, by: Set<string> }
const add = (file, by) => {
  const u = uses.get(file.file) ?? { origin: file.origin, by: new Set() };
  u.by.add(by); uses.set(file.file, u);
};
const engineFaction = id => (id === "saudi-arabia" ? "saudi" : id);
const factions = roster.factions.filter(f => f.mode === "ra2");
let actorCount = 0;
for (const f of factions) {
  const faction = engineFaction(f.id);
  for (const key of f.actors) {
    const actor = key.split(":")[1];
    const s = actorSounds(loaded.data, loaded.audio, actor, faction);
    actorCount++;
    for (const g of s.groups) if (g.played) for (const file of g.files) add(file, `${faction}:${actor} ${g.label}`);
  }
  for (const n of factionSpeech(loaded.audio, faction)) for (const file of n.files) add(file, `${faction} announcer ${n.notification}`);
}
const modern = Object.keys(artLab.actors).length;

const problems = [], missingOriginals = [], formats = {};
// Original names the player's content lacks are noted once by the extractor (missing.json).
const originalNames = [...uses].filter(([, u]) => u.origin === "original").map(([f]) => f);
const notFound = new Set(await extractOriginals(cfg, originalNames));
for (const [file, u] of uses) {
  let bytes = null;
  if (u.origin === "project") {
    if (!loaded.read.exists(file)) { problems.push({ file, problem: "missing from the mod", by: [...u.by].slice(0, 3) }); continue; }
    bytes = new Uint8Array(readFileSync(join(cfg.modRoot, file)));
  } else {
    if (notFound.has(file)) { missingOriginals.push({ file, by: [...u.by].slice(0, 3) }); continue; }
    const p = cachedFile(cfg, file);
    if (!p) { missingOriginals.push({ file, by: [...u.by].slice(0, 3) }); continue; }
    bytes = new Uint8Array(readFileSync(p));
  }
  try {
    const info = wavInfo(bytes);
    formats[`${u.origin}:${info.format === 17 ? "ima-adpcm" : info.format === 1 ? "pcm" : info.format}`] = (formats[`${u.origin}:${info.format === 17 ? "ima-adpcm" : info.format === 1 ? "pcm" : info.format}`] ?? 0) + 1;
    const pcm = wavInfo(toPcmWav(bytes));
    if (!(pcm.seconds > 0.02)) problems.push({ file, problem: `decodes to ${pcm.seconds.toFixed(3)} s`, by: [...u.by].slice(0, 3) });
  } catch (error) { (u.origin === "project" ? problems : missingOriginals).push({ file, problem: `does not decode: ${error.message}`, by: [...u.by].slice(0, 3) }); }
}

let browser = null;
if (browserCheck) {
  const base = (process.env.RTSAI_STUDIO_URL ?? "http://127.0.0.1:3461").replace(/\/$/, "");
  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? "C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core");
  const b = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await b.newPage();
  await page.goto(`${base}/studio.webmanifest`).catch(() => page.goto(base));
  const urls = [...uses].filter(([f]) => !notFound.has(f) && !missingOriginals.some(m => m.file === f) && !problems.some(p => p.file === f)).map(([file, u]) => ({ file, url: describe({ clip: file, file, origin: u.origin }, loaded).url }));
  const result = await page.evaluate(async list => {
    // One OfflineAudioContext decodes every clip as the Studio's AudioContext would; nothing is heard.
    const ctx = new OfflineAudioContext(1, 1, 44100), failed = [];
    let decoded = 0, seconds = 0;
    for (let i = 0; i < list.length; i += 8) await Promise.all(list.slice(i, i + 8).map(async ({ file, url }) => {
      try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); const buf = await ctx.decodeAudioData(await r.arrayBuffer()); decoded++; seconds += buf.duration; }
      catch (e) { failed.push({ file, problem: `browser: ${e.message}` }); }
    }));
    return { decoded, seconds: Math.round(seconds), failed };
  }, urls);
  // Sound with motion in the Studio: nothing before a gesture; a clip plays from the Sounds step, each Fire cycle
  // plays a report, Die its death sound, and picking a unit its select line. Clips are counted, never heard.
  const studio = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = []; studio.on("pageerror", e => pageErrors.push(e.message));
  await studio.addInitScript(() => {
    try { localStorage.setItem("rtsai-art-review-coach-v3", "1"); localStorage.removeItem("rtsai-studio-sound"); } catch { /* storage unavailable */ }
    window.__started = 0; const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) { window.__started++; return start.apply(this, a); };
  });
  const motionActor = args.includes("--motion-actor") ? args[args.indexOf("--motion-actor") + 1] : "r2cnrifle";
  await studio.goto(`${base}/art/review?mode=ra2&authored=1&faction=${artLab.actors[motionActor].factionId}&unit=${motionActor}&step=sounds`);
  await studio.locator(".sounds-panel .sound-clip").first().waitFor({ timeout: 60000 });
  await studio.waitForTimeout(1500);
  const started = () => studio.evaluate(() => window.__started);
  const motion = { beforeGesture: await started() };
  assert.equal(motion.beforeGesture, 0, "no sound before a user gesture");
  let n = await started(); await studio.locator(".sound-play").first().click(); await studio.waitForTimeout(1500); motion.play = (await started()) - n;
  await studio.locator(".chain-step").nth(4).click(); await studio.waitForTimeout(800);
  for (const label of ["Fire", "Die"]) {
    const button = studio.locator(".studio-action-list button").filter({ hasText: new RegExp(`^${label}$`) });
    n = await started(); await button.first().click(); await studio.waitForTimeout(2500); motion[label.toLowerCase()] = (await started()) - n;
  }
  n = await started(); await studio.locator(".lab-rail li button").nth(1).click(); await studio.waitForTimeout(2500); motion.select = (await started()) - n;
  assert.ok(motion.play >= 1 && motion.fire >= 2 && motion.die === 1 && motion.select === 1, `sound with motion: ${JSON.stringify(motion)}`);
  assert.deepEqual(pageErrors, [], "no page errors");
  await b.close();
  browser = { decoded: result.decoded, seconds: result.seconds, motion: { actor: motionActor, ...motion } };
  problems.push(...result.failed);
}

const summary = {
  actors: actorCount, modernActors: modern, factions: factions.length,
  files: uses.size, project: [...uses.values()].filter(u => u.origin === "project").length, original: originalNames.length,
  formats, browser, problems: problems.length, missingOriginals: missingOriginals.map(m => `${m.file} (${m.by[0]}${m.by.length > 1 ? ", …" : ""})`),
};
mkdirSync(resolve(".cache/sound-check"), { recursive: true });
writeFileSync(resolve(".cache/sound-check/report.json"), JSON.stringify({ ...summary, problemList: problems, missingList: missingOriginals }, null, 1));
console.log(JSON.stringify(summary, null, 1));
assert.equal(problems.length, 0, `${problems.length} sounds fail: ${problems.slice(0, 5).map(p => `${p.file}: ${p.problem}`).join("; ")}`);
if (strict) assert.equal(missingOriginals.length, 0, `${missingOriginals.length} original sounds are not in the local RA2 content`);
