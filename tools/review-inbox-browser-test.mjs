#!/usr/bin/env node
// The Review inbox end to end, in a real browser with a fake microphone, against the local preview
// (tools/review-preview.mjs: the real page, the real firestore.rules, the Firebase emulators):
//   a session adds four clips -> the owner answers them with keys only (Looks good, a suspect waved off and one
//   confirmed, a voice note pinned to a second, a typed note, Skip, Undo) -> the session reads the notes, fetches the
//   voice note's audio, stores a transcript, sends the clip back as fixed -> the owner checks it again -> closed.
// Plus the owner-only rule: a stranger reads nothing, the owner cannot rewrite what a clip shows.
//
//   node tools/review-preview.mjs --data <folder>          (first, in another terminal)
//   node tools/review-inbox-browser-test.mjs --data <folder> [--mic <speech.wav>] [--shots <dir>] [--keep]
// Its clips live on the front "test" and are removed at the end (--keep leaves them).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const game = path.resolve(repo, "../RTSAI-WebGame");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const data = path.resolve(opt("data") ?? (console.error("usage: node tools/review-inbox-browser-test.mjs --data <the preview's folder>"), process.exit(1)));
const site = opt("site", "http://127.0.0.1:3472"), clipsUrl = opt("clips-url", "http://127.0.0.1:3473");
const shots = opt("shots");
if (shots) fs.mkdirSync(shots, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.RTSAI_PLAYWRIGHT_MODULE ?? path.join(game, "web/node_modules/playwright-core/index.mjs")).href);
const { browserExecutable } = await import(pathToFileURL(path.join(game, "tools/browser-launch.mjs")).href);

const run = Date.now().toString(36), id = (n) => `test-${run}-${n}`;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "review-test-"));
const review = (...args) => execFileSync(process.execPath, [path.join(repo, "tools/review.mjs"), ...args, "--emulator", "--serve-dir", path.join(data, "clips"), "--serve-url", clipsUrl], { cwd: repo, encoding: "utf8" });
const steps = [];
const step = (name) => { steps.push(name); console.log(`ok  ${name}`); };

// ---- four small clips and a microphone
for (const n of [1, 2, 3, 4, 5]) {
  execSync(`ffmpeg -y -v error -f lavfi -i "testsrc2=size=640x360:rate=30:duration=8" -c:v libx264 -pix_fmt yuv420p -crf 32 -movflags +faststart clip${n}.mp4`, { cwd: work });
  execSync(`ffmpeg -y -v error -ss 2 -i clip${n}.mp4 -frames:v 1 -vf scale=320:-1 clip${n}.jpg`, { cwd: work });
}
let mic = opt("mic");
if (!mic) { mic = path.join(work, "mic.wav"); execSync(`ffmpeg -y -v error -f lavfi -i "sine=frequency=330:duration=30" -ar 48000 -ac 1 "${mic}"`); }
const side = (faction, name, units) => ({ faction, name, units });
fs.writeFileSync(path.join(work, "clips.json"), JSON.stringify({
  front: "test", by: "review-inbox-browser-test", build: { label: "test fixture", page: "0000000", runtime: "rt-test", data: "data-test" },
  clips: [
    { id: id("a"), title: "Fixture one", why: "Gets a Looks good.", file: "clip1.mp4", poster: "clip1.jpg", seconds: 8, mode: { id: "direct", label: "Direct attack" },
      sides: [side("iran", "Iran", [{ id: "t1", name: "Test tank", count: 4, cls: "vehicle" }]), side("america", "America", [{ id: "a1", name: "Test jet", count: 2, cls: "aircraft" }])], repro: { map: "web-arena", seed: 7, link: `${site}/play/?mode=sandbox` } },
    { id: id("b"), title: "Fixture two", why: "Gets a voice note.", file: "clip2.mp4", poster: "clip2.jpg", seconds: 8, mode: { id: "siege", label: "Siege" },
      sides: [side("iran", "Iran", [{ id: "t2", name: "Test launcher", count: 3, cls: "vehicle" }]), side("america", "America", [{ id: "d1", name: "Test bunker", count: 2, cls: "defence" }])],
      suspects: [{ t: 5, text: "The launcher on the left never fires." }, { t: 6.5, text: "No blast is drawn where the rockets land." }] },
    { id: id("c"), title: "Fixture three", why: "Gets a typed note.", file: "clip3.mp4", poster: "clip3.jpg", seconds: 8, mode: { id: "naval", label: "Naval" } },
    { id: id("d"), title: "Fixture four", why: "Is skipped.", file: "clip4.mp4", poster: "clip4.jpg", seconds: 8, chips: [{ label: "Sea", value: "open water" }] },
  ],
}, null, 2));
review("add", work);
step("a session adds four clips with one command");

// ---- the owner's browser
const browser = await chromium.launch({ executablePath: browserExecutable(), headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${mic}`, "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1155, height: 1063 }, permissions: ["microphone"] });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
const title = () => page.locator(".rv-name h2").textContent();
// An answer key counts only once the page has finished saving the last one.
const ready = (id) => page.waitForSelector(`[data-testid="${id}"]:not([disabled])`, { timeout: 30000 });
const playing = () => page.waitForFunction(() => { const v = document.querySelector('[data-testid="rv-video"]'); return v && v.currentTime > 0.4; }, null, { timeout: 30000 });
const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
let failure = null;
try {
  await page.goto(`${site}/admin/review?front=test`);
  await page.waitForSelector('[data-testid="review-inbox"]', { timeout: 120000 });
  assert.equal(await title(), "Fixture one");
  await playing();
  assert.equal(await page.locator(".rv-vs").count(), 2, "both sides are drawn");
  assert.equal(await page.locator(".rv-unit").count(), 2);
  await shot("1-clip");
  step("the inbox opens on the first clip, playing, with both sides drawn");

  // One screen, never a scroll: the owner's short window (20 Nov 2026: 1426x445), a laptop's, and this test's.
  for (const [w, h] of [[1426, 445], [1280, 720], [1155, 1063]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    const fit = await page.evaluate(() => {
      const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
      const v = box('[data-testid="rv-video"]'), good = box('[data-testid="rv-good"]'), skip = box('[data-testid="rv-skip"]');
      return { scroll: document.documentElement.scrollHeight - innerHeight, inner: Math.max(0, document.querySelector(".rv").scrollHeight - document.querySelector(".rv").clientHeight),
        top: v.top, bottom: v.bottom, height: v.height, width: v.width, answers: Math.max(good.bottom, skip.bottom) <= innerHeight && good.right <= innerWidth };
    });
    assert.ok(fit.scroll <= 0 && fit.inner <= 0, `${w}x${h}: the page does not scroll (${JSON.stringify(fit)})`);
    assert.ok(fit.top >= 0 && fit.bottom <= h, `${w}x${h}: the whole clip is on screen`);
    assert.ok(fit.height >= h * 0.5, `${w}x${h}: the clip takes at least half the window's height (${Math.round(fit.height)} px)`);
    assert.ok(fit.answers, `${w}x${h}: the answers are on screen`);
    await shot(`1-layout-${w}x${h}`);
  }
  step("one screen at 1426x445, 1280x720 and 1155x1063: no scroll, the whole clip and the answers in view");

  await ready("rv-good");
  await page.keyboard.press("g");
  await page.waitForFunction(() => document.querySelector(".rv-name h2")?.textContent === "Fixture two");
  step("G answers Looks good and moves to the next clip");

  await playing();
  assert.equal(await page.locator('[data-testid="rv-marker"]').count(), 2, "the session's two suspects are numbered markers on the scrubber");
  // A marker jumps to its moment and shows its sentence over the clip, with Wrong / Fine.
  await page.locator('[data-testid="rv-marker"]').nth(1).click();
  await page.locator('[data-testid="rv-suspect"]').getByText("Fine").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="rv-marker"]').length === 1);
  await page.keyboard.press("1"); // the key jumps to suspect 1
  await page.locator('[data-testid="rv-suspect"]').getByText("Wrong").click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="rv-note-mark"]').length === 1 && !document.querySelector('[data-testid="rv-marker"]'));
  step("a suspect is waved off, another confirmed as a note (markers on the scrubber, the sentence over the clip)");

  await page.evaluate(() => { const v = document.querySelector('[data-testid="rv-video"]'); v.pause(); v.currentTime = 3; });
  await page.keyboard.press("v");
  await page.waitForSelector('[data-testid="rv-recording"]');
  await page.waitForTimeout(5000);
  await shot("2-recording");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".rv-name h2")?.textContent === "Fixture three", null, { timeout: 30000 });
  step("V records a voice note pinned at 0:03; Enter saves it and moves on");

  await playing();
  await page.keyboard.press("t");
  const save = page.locator('[data-testid="rv-save"]');
  assert.ok(await save.isDisabled(), "an empty note cannot be saved");
  assert.match(await save.textContent(), /Type a note or add a picture first/, "and the button says why");
  await page.locator(".rv-talk textarea").fill("The ship turns on the spot.");
  await page.waitForTimeout(400); // the colour fades in over 0.12 s
  const look = await save.evaluate((b) => { const s = getComputedStyle(b); return { disabled: b.disabled, background: s.backgroundColor, color: s.color }; });
  assert.deepEqual(look, { disabled: false, background: "rgb(255, 122, 92)", color: "rgb(29, 11, 6)" }, "Save is a solid button with dark text");
  step("T types a note; Save says why it waits, then shows solid with dark text (7.4:1)");

  // Grab the clip's frame at the note's second and circle the problem in the markup editor.
  await page.locator('[data-testid="rv-grab"]').click();
  await page.waitForSelector(".fbk-annotator canvas", { timeout: 20000 });
  await page.locator('.fbk-tool[aria-label="Ellipse"]').click();
  const box = await page.locator(".fbk-annotator canvas").boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();
  await shot("3a-markup");
  await page.locator(".fbk-done").click();
  await page.waitForFunction(() => document.querySelectorAll(".rv-pics .fbk-shot").length === 1);
  // Paste a screenshot (Ctrl+V): one picture opens in the markup editor too.
  await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 320; c.height = 200;
    const g = c.getContext("2d"); g.fillStyle = "#c0392b"; g.fillRect(0, 0, 320, 200);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer(); dt.items.add(new File([blob], "screenshot.png", { type: "image/png" }));
    window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt }));
  });
  await page.waitForSelector(".fbk-annotator canvas", { timeout: 20000 });
  await page.locator(".fbk-done").click();
  await page.waitForFunction(() => document.querySelectorAll(".rv-pics .fbk-shot").length === 2);
  await shot("3b-pictures");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".rv-name h2")?.textContent === "Fixture four");
  step("a grabbed frame is circled and a screenshot pasted into the note; Enter saves both with the words");

  await ready("rv-skip");
  await page.keyboard.press("s");
  await page.waitForSelector('[data-testid="rv-done"]');
  await shot("3-done");
  await page.keyboard.press("z");
  await page.waitForFunction(() => document.querySelector(".rv-name h2")?.textContent === "Fixture four");
  await ready("rv-skip");
  await page.keyboard.press("s");
  await page.waitForSelector('[data-testid="rv-done"]');
  step("S skips; Z takes the answer back; the inbox ends on All caught up");

  // ---- the session reads it back
  const status = JSON.parse(review("status", "--front", "test", "--json")).filter((c) => c.id.startsWith(`test-${run}-`));
  assert.deepEqual(status.map((c) => c.state), ["good", "noted", "noted", "skipped"]);
  const feedback = JSON.parse(review("feedback", "--front", "test", "--json")).filter((c) => c.id.startsWith(`test-${run}-`));
  assert.equal(feedback.length, 2);
  const b = feedback.find((c) => c.id === id("b"));
  assert.deepEqual(b.dismissed, [1], "the waved-off suspect is recorded");
  const voice = b.notes.find((n) => n.said === "voice"), suspect = b.notes.find((n) => n.said === "suspect");
  assert.ok(voice && suspect, "the confirmed suspect and the voice note are both open notes");
  assert.equal(suspect.text, "The launcher on the left never fires.");
  assert.ok(Math.abs(voice.t - 3) < 0.6, `the voice note is pinned where the owner started talking (got ${voice.t})`);
  assert.ok(voice.audio.bytes > 3000 && voice.audio.seconds > 4, "the voice note has audio");
  const typedNote = feedback.find((c) => c.id === id("c")).notes[0];
  assert.equal(typedNote.text, "The ship turns on the spot.");
  assert.deepEqual(typedNote.files.map((f) => [f.kind, f.type]), [["picture", "image/jpeg"], ["picture", "image/jpeg"]]);
  assert.deepEqual([typedNote.files[0].width, typedNote.files[0].height], [640, 360], "the grabbed frame is the clip's own picture");
  const text = review("feedback", "--front", "test");
  assert.match(text, /Iran: 3× Test launcher\s+vs\s+America: 2× Test bunker\s+\[Siege\]/);
  assert.match(text, /build: test fixture, page 0000000, rt-test, data-test/);
  assert.match(text, new RegExp(`2 attached \\(picture 640x360 \\d+ KB, picture 320x200 \\d+ KB\\): node tools/review.mjs files ${id("c")} ${typedNote.id}`));
  const pictures = path.join(work, "pictures");
  review("files", id("c"), typedNote.id, "--out", pictures);
  const got = fs.readdirSync(pictures).sort();
  assert.equal(got.length, 2);
  for (const f of got) assert.deepEqual([...fs.readFileSync(path.join(pictures, f)).subarray(0, 3)], [0xff, 0xd8, 0xff], `${f} is a JPEG`);
  if (shots) for (const f of got) fs.copyFileSync(path.join(pictures, f), path.join(shots, `note-${f.split("-").pop()}`));
  step("the feedback command lists the open notes with each clip's facts, time, transcript and pictures; `files` fetches them");

  const out = path.join(work, "note.webm");
  review("audio", id("b"), voice.id, "--out", out);
  const probe = JSON.parse(execSync(`ffprobe -v error -show_entries stream=codec_name:format=duration -of json "${out}"`, { encoding: "utf8" }));
  assert.equal(probe.streams[0].codec_name, "opus");
  // A browser recording has no duration in its header: decode it to measure.
  const decoded = execSync(`ffmpeg -v error -i "${out}" -f null - -stats 2>&1 || true`, { encoding: "utf8" });
  step(`the voice note's audio comes back out as a playable file (${fs.statSync(out).size} bytes, opus${/time=(\S+)/.exec(decoded)?.[1] ? `, ${/time=(\S+)/.exec(decoded)[1]}` : ""})`);
  if (opt("keep-audio")) fs.copyFileSync(out, opt("keep-audio"));

  review("transcript", id("b"), voice.id, "--text", "A transcript made locally.");
  review("fixed", id("b"), "--reply", "The launcher fires now.", "--in", "abc1234", "--video", path.join(work, "clip5.mp4"), "--poster", path.join(work, "clip5.jpg"));
  await page.goto(`${site}/admin/review?front=test`);
  await page.waitForSelector(".rv-banner");
  assert.equal(await title(), "Fixture two");
  assert.match(await page.locator(".rv-banner").textContent(), /Fixed · check again/);
  assert.equal(await page.locator(".rv-mark.is-recheck").count(), 2);
  // A fixed clip opens on what was fixed, over the clip.
  await page.evaluate(() => { const v = document.querySelector('[data-testid="rv-video"]'); v.pause(); v.currentTime = 0; });
  await page.waitForFunction(() => /A transcript made locally\./.test(document.querySelector('[data-testid="rv-captions"]')?.textContent ?? "")
    && /Fixed: The launcher fires now\. \(abc1234\)/.test(document.querySelector('[data-testid="rv-captions"]')?.textContent ?? ""), null, { timeout: 10000 });
  assert.equal(await page.locator(".rv-before").count(), 1, "before and after can be compared");
  await shot("4-recheck");
  await ready("rv-good");
  await page.keyboard.press("g");
  await page.waitForSelector('[data-testid="rv-done"]');
  const after = JSON.parse(review("status", "--front", "test", "--json")).find((c) => c.id === id("b"));
  assert.equal(after.state, "good");
  assert.equal(after.round, 2);
  assert.deepEqual(after.notes.map((n) => n.state), ["fixed", "fixed"]);
  step("a fixed clip comes back first as Fixed, check again; G closes its notes");

  // ---- the owner-only rule, from outside the page
  const auth = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1", fsApi = "http://127.0.0.1:8085/v1/projects/demo-rtsai/databases/(default)/documents";
  const post = async (url, body, headers = {}) => (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })).json();
  const stranger = await post(`${auth}/accounts:signUp?key=demo`, { email: `stranger-${run}@test.dev`, password: "test-password-1", returnSecureToken: true });
  await post(`${auth}/projects/demo-rtsai/accounts:update`, { localId: stranger.localId, emailVerified: true }, { Authorization: "Bearer owner" });
  const strangerToken = (await post(`${auth}/accounts:signInWithPassword?key=demo`, { email: `stranger-${run}@test.dev`, password: "test-password-1", returnSecureToken: true })).idToken;
  const ownerEmail = /OWNER_EMAILS = \["([^"]+)"\]/.exec(fs.readFileSync(path.join(repo, "lib/admin.ts"), "utf8"))[1];
  const ownerToken = (await post(`${auth}/accounts:signInWithPassword?key=demo`, { email: ownerEmail, password: "review-preview", returnSecureToken: true })).idToken;
  const as = (token, method, url, body) => fetch(`${fsApi}${url}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.status);
  assert.equal(await as(null, "GET", `/reviewClips/${id("a")}`), 403, "signed out: no");
  assert.equal(await as(strangerToken, "GET", `/reviewClips/${id("a")}`), 403, "another verified account: no");
  assert.equal(await as(strangerToken, "GET", `/reviewClips/${id("b")}/notes`), 403);
  assert.equal(await as(strangerToken, "GET", `/reviewClips/${id("b")}/audio/${voice.id}_0`), 403);
  assert.equal(await as(strangerToken, "GET", `/reviewClips/${id("c")}/files/${typedNote.files[0].id}_0`), 403, "nor the pictures");
  assert.equal(await as(ownerToken, "GET", `/reviewClips/${id("c")}/files/${typedNote.files[0].id}_0`), 200);
  assert.equal(await as(strangerToken, "PATCH", `/reviewClips/${id("a")}?updateMask.fieldPaths=state`, { fields: { state: { stringValue: "good" } } }), 403);
  assert.equal(await as(ownerToken, "GET", `/reviewClips/${id("a")}`), 200, "the owner: yes");
  assert.equal(await as(ownerToken, "PATCH", `/reviewClips/${id("a")}?updateMask.fieldPaths=title`, { fields: { title: { stringValue: "Rewritten" } } }), 403, "the owner's browser cannot rewrite what a clip shows");
  assert.equal(await as(ownerToken, "PATCH", `/reviewClips/test-${run}-new`, { fields: { title: { stringValue: "x" } } }), 403, "nor add a clip");
  step("the data rule: only the owner's verified sign-in reads or answers; a stranger gets nothing");

  assert.deepEqual(pageErrors, [], "the page threw nothing");
} catch (e) {
  failure = e;
  if (shots) await page.screenshot({ path: path.join(shots, "failure.png") }).catch(() => {});
} finally {
  await browser.close();
  if (!argv.includes("--keep")) { try { review("remove", id("a"), id("b"), id("c"), id("d")); } catch { /* best effort */ } }
  fs.rmSync(work, { recursive: true, force: true });
}
if (failure) { console.error(`\nFAILED after "${steps.at(-1) ?? "start"}":\n`, failure); process.exit(1); }
console.log(`\nRESULT ${JSON.stringify({ passed: true, steps: steps.length })}`);
