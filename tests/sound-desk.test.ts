import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { pcmWav } from "../lib/art-lab/wav";
import { applySoundAction, emptySoundReview, licenceVerdict, pendingSlots, readSoundReview, slotStatus, validateSoundAction } from "../lib/sound-desk/model";
import { familyLabel, soundFamily, weaponLabel } from "../lib/sound-desk/slots";
import { createSoundReviewMiddleware } from "../lib/sound-desk/server";
import { weaponLabel as demoLabel } from "../lib/weapon-demo";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test replies are read field by field
type Reply = { status: number; type: string; body: Buffer; json: () => any };
async function call(handler: ReturnType<typeof createSoundReviewMiddleware>, method: string, url: string, body?: unknown, host = "localhost:3470"): Promise<Reply> {
  const req = new IncomingMessage(new Socket());
  req.method = method; req.url = url; req.headers = { host, ...(body !== undefined ? { "content-type": "application/json" } : {}) };
  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];
  const done = new Promise<Reply>(resolve => {
    res.end = ((chunk?: unknown) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(chunk as string));
      const b = Buffer.concat(chunks);
      resolve({ status: res.statusCode, type: String(res.getHeader("content-type") ?? ""), body: b, json: () => JSON.parse(b.toString("utf8")) });
      return res;
    }) as typeof res.end;
  });
  const pending = handler(req, res);
  if (body !== undefined) req.push(JSON.stringify(body));
  req.push(null);
  await pending;
  return done;
}
const clip = (n = 2205, value = 1200) => Buffer.from(pcmWav(new Int16Array(n).map((_, i) => Math.round(value * Math.sin(i / 7))), 1, 22050));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** A tiny standalone mod (a modern tank, its voice set, a weapon with stand-in sounds, a death effect, an announcer), a
 *  bake-off with one RA2 reference and one CC0 candidate, a CC0 library, and an empty RTSAI-Art. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sound-desk-"));
  const put = (path: string, data: string | Buffer) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), data); };
  put("mod/mods/rtsai/mod.yaml", "Rules:\n\tra2|rules.yaml\nSequences:\nWeapons:\n\tra2|weapons.yaml\nVoices:\n\tra2|voices.yaml\nNotifications:\n\tra2|notifications.yaml\n");
  put("mod/mods/rtsai/rules.yaml", "r2tank:\n\tVoiced:\n\t\tVoiceSet: TankVoice\n\tArmament@gun:\n\t\tWeapon: TankGun\n\tArmament@coax:\n\t\tWeapon: Coax\n\tFireWarheadsOnDeath:\n\t\tWeapon: Boom\n");
  put("mod/mods/rtsai/weapons.yaml", "TankGun:\n\tReport: vgriatta.wav\n\tWarhead@1: SpreadDamage\n\t\tImpactSounds: gexp14a.wav\nCoax:\n\tReport: igiat1a.wav, igiat1b.wav, igiat1c.wav\nBoom:\n\tWarhead@1: CreateEffect\n\t\tImpactSounds: ra2|audio/sfx/boom.wav\n");
  put("mod/mods/rtsai/voices.yaml", "TankVoice:\n\tDefaultVariant: .wav\n\tVoices:\n\t\tSelect: ra2|modern-factions/audio/sel-zh, ra2|modern-factions/audio/sel-en\n\t\tMove: ra2|modern-factions/audio/sel-en\n\t\tAttack: ra2|modern-factions/audio/sel-en\n");
  put("mod/mods/rtsai/notifications.yaml", "Speech:\n\tDefaultVariant: .wav\n\tPrefixes:\n\t\tchina: ra2|modern-factions/audio/eva/china/\n\tNotifications:\n\t\tNuclearMissileLaunched: 002\n\t\tNuclearMissileReady: 002\n\t\tAtomBombReady: 003\n");
  for (const f of ["modern-factions/audio/sel-zh.wav", "modern-factions/audio/sel-en.wav", "modern-factions/audio/eva/china/002.wav", "modern-factions/audio/eva/china/003.wav", "audio/sfx/boom.wav", "standalone/audio/sfx/igiat1a.wav", "standalone/audio/sfx/igiat1b.wav", "standalone/audio/sfx/igiat1c.wav", "standalone/audio/sfx/vgriatta.wav"]) put(`mod/mods/rtsai/${f}`, clip());
  put("mod/mods/rtsai/modern-factions/audio/PROVENANCE.json", JSON.stringify({
    voice_lines: [{ filename: "sel-zh.wav", language: "zh-CN", text: "装甲就位。", translation: "Armor in position.", engine: "Chatterbox", license: "MIT", voice: { speaker: "china-crew" } }, { filename: "sel-en.wav", language: "en-US", text: "Armor ready.", engine: "Kokoro", license: "Apache-2.0" }],
    announcers: [{ filename: "eva/china/002.wav", text: "Nuclear missile launched.", language: "en-US", license: "Apache-2.0", voice: { speaker: "china-eva" } }, { filename: "eva/china/003.wav", text: "Nuclear missile ready.", language: "en-US", license: "Apache-2.0" }],
    sound_effects: [],
  }));
  put("mod/mods/rtsai/standalone/audio/PROVENANCE.json", JSON.stringify({ files: Object.fromEntries(["igiat1a", "igiat1b", "igiat1c", "vgriatta"].map(n => [`sfx/${n}.wav`, { license: "GPL-3.0 (project code); output has no third-party rights", generator: "tools/standalone-sfx.py", role: "machine gun" }])) }));
  put("mod/mods/rtsai/audio/sfx/PROVENANCE.json", JSON.stringify({ files: { "boom.wav": { license: "GPL-3.0 (project code)", generator: "x" } } }));
  const rifle = clip(4410, 9000), ref = clip(3000, 5000);
  put("bakeoff/sfx/rifle_burst/cc0-layered.wav", rifle);
  put("bakeoff/sfx/rifle_burst/ra2-igiat1a.wav", ref);
  put("bakeoff/manifest.json", JSON.stringify({ candidates: [
    { id: "A.rifle_burst.cc0-layered", group: "A", slot: "rifle_burst", slot_label: "Assault rifle burst", source: "cc0-layered", reference: false, licence: "CC0 1.0", recipe: { layers: [{ src: "oga-ffsl/AK-47/C_29P.wav" }] }, files: { wav_master: "sfx/rifle_burst/cc0-layered.wav" } },
    { id: "A.rifle_burst.ra2-igiat1a", group: "A", slot: "rifle_burst", source: "ra2-reference", reference: true, licence: "EA (Command & Conquer: Red Alert 2). LISTENING REFERENCE ONLY: never ship, never commit", files: { wav_master: "sfx/rifle_burst/ra2-igiat1a.wav" } },
  ] }));
  const mg = clip(6000, 7000);
  put("sources/oga-ffsl/mg-burst.wav", mg);
  put("sources/SOURCES.json", JSON.stringify([{ local_path: join(root, "sources/oga-ffsl/mg-burst.wav"), library: "OpenGameArt", title: "MG burst", licence: "CC0 1.0", sha256: sha(mg), url: "https://opengameart.org/x" }]));
  mkdirSync(join(root, "art"), { recursive: true });
  const handler = (env = "development") => createSoundReviewMiddleware({ artRoot: join(root, "art"), modRoot: join(root, "mod"), webRoot: process.cwd(), bakeoffDir: join(root, "bakeoff"), sourcesDir: join(root, "sources"), openraAi: null, voicePython: null, gpuLogs: null, env });
  return { root, handler, rifle, mg };
}
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("sound desk model: decisions mirror review.json per slot; choose, reject, keep, note, clear; licences", () => {
  const facts = { slot: "fire:r2tank:Coax", label: "Coax · fire", faction: "china", actor: "r2tank", kind: "fire" as const, current: ["igiat1a.wav"] };
  const candidate = { id: "bakeoff:A.rifle_burst.cc0-layered", source: "bakeoff" as const, title: "Assault rifle burst", path: "D:/x.wav", sha256: "ab", licence: "CC0 1.0" };
  let f = emptySoundReview();
  f = applySoundAction(f, { type: "choose", slots: [facts], candidate }, "2026-10-14T00:00:00Z");
  assert.equal(slotStatus(f.slots[facts.slot]), "use");
  assert.deepEqual(pendingSlots(f), [facts.slot]);
  f = applySoundAction(f, { type: "reject", slots: [facts], candidate: candidate.id }, "2026-10-14T00:01:00Z");
  assert.equal(f.slots[facts.slot].chosen, null, "rejecting the chosen candidate takes the choice back");
  assert.deepEqual(f.slots[facts.slot].rejected, [candidate.id]);
  f = applySoundAction(f, { type: "keep", slots: [facts] });
  assert.equal(slotStatus(f.slots[facts.slot]), "keep");
  f = applySoundAction(f, { type: "note", slots: [facts], text: "  A light MG, please " });
  assert.equal(f.slots[facts.slot].notes[0].text, "A light MG, please");
  assert.deepEqual(f.slots[facts.slot].log.map(l => l.action), ["choose", "reject", "keep", "note"]);
  f = applySoundAction(f, { type: "size", actors: ["r2tank"], size: "large" });
  assert.equal(f.deathSizes.r2tank, "large");
  assert.deepEqual(readSoundReview(JSON.parse(JSON.stringify(f))), f, "the file round-trips");
  assert.match(validateSoundAction({ type: "choose", slots: [facts], candidate: { ...candidate, licence: "EA (Command & Conquer: Red Alert 2). LISTENING REFERENCE ONLY" } }) ?? "", /Refused/);
  assert.match(validateSoundAction({ type: "choose", slots: [{ ...facts, slot: "../../etc" }], candidate }) ?? "", /Bad slot/);
  assert.equal(validateSoundAction({ type: "choose", slots: [facts], candidate }), null);
  assert.deepEqual(["CC0 1.0", "MIT", "Apache-2.0 (Kokoro-82M)", "GPL-3.0 (project code)", "Stability AI Community License", "openai output"].map(l => licenceVerdict(l)), ["ok", "ok", "ok", "ok", "conditional", "conditional"]);
  assert.deepEqual(["EA (Command & Conquer: Red Alert 2)", "CC BY-NC 4.0", "", "MIT base model + CC0 data (pilot checkpoint, not for shipping)"].map(l => licenceVerdict(l)), ["refused", "refused", "refused", "refused"]);
  assert.equal(licenceVerdict("CC0 1.0", true), "refused", "a reference is never offered");
  assert.equal(familyLabel(["igiat1a.wav", "igiat1b.wav", "igiat1c.wav"]), "igiat1a–c");
  assert.equal(soundFamily("mods/rtsai/standalone/audio/sfx/vintatta.wav"), "vintatt");
  assert.equal(weaponLabel("R2QilinCoax"), "Qilin Coax");
  assert.equal(demoLabel("R2QilinCoax__sd_1bcb68"), "Qilin Coax", "a Sound desk variant reads as its weapon in the Attack demo");
});

test("sound desk API: slots from the rules, a library without RA2 references, decisions round-trip through RTSAI-Art", async () => {
  const { root, handler, rifle, mg } = fixture();
  try {
    const h = handler();
    const state = await call(h, "GET", "/api/sound-review/state");
    assert.equal(state.status, 200);
    assert.deepEqual(state.json().file, emptySoundReview());
    const unit = (await call(h, "GET", "/api/sound-review/unit?actor=r2tank&faction=china")).json().slots as { id: string; label: string; current: { ref: string; path: string | null; id: string | null }[]; regen: string | null; line: { text: string } | null }[];
    const by = (id: string) => unit.find(s => s.id === id)!;
    assert.deepEqual(unit.map(s => s.id), ["clip:mods/rtsai/modern-factions/audio/sel-zh.wav", "clip:mods/rtsai/modern-factions/audio/sel-en.wav", "fire:r2tank:TankGun", "impact:r2tank:TankGun", "fire:r2tank:Coax", "impact:r2tank:Coax", "death:r2tank"]);
    assert.equal(by("clip:mods/rtsai/modern-factions/audio/sel-en.wav").label, "Selected · Move · Attack", "a line the set plays for several orders is one slot");
    assert.equal(by("clip:mods/rtsai/modern-factions/audio/sel-zh.wav").line?.text, "装甲就位。");
    assert.equal(by("clip:mods/rtsai/modern-factions/audio/sel-zh.wav").regen, "voice");
    assert.deepEqual(by("fire:r2tank:Coax").current.map(c => c.path), ["mods/rtsai/standalone/audio/sfx/igiat1a.wav", "mods/rtsai/standalone/audio/sfx/igiat1b.wav", "mods/rtsai/standalone/audio/sfx/igiat1c.wav"], "a bare name is the standalone stand-in, never an RA2 original");
    assert.deepEqual(by("death:r2tank").current.map(c => c.path), ["mods/rtsai/audio/sfx/boom.wav"]);
    const eva = (await call(h, "GET", "/api/sound-review/faction?faction=china")).json();
    assert.deepEqual(eva.clips.map((c: { id: string; notifications: string[] }) => [c.id, c.notifications]), [["eva:china:002", ["NuclearMissileLaunched", "NuclearMissileReady"]], ["eva:china:003", ["AtomBombReady"]]]);
    assert.equal(eva.notifications.find((n: { id: string }) => n.id === "notify:NuclearMissileReady").clip, "002");
    assert.equal((await call(h, "GET", "/api/sound-review/faction?faction=america")).status, 400, "the announcer desk covers the modern factions");

    const lib = (await call(h, "GET", "/api/sound-review/library")).json();
    assert.deepEqual(lib.bakeoff.map((c: { id: string }) => c.id), ["bakeoff:A.rifle_burst.cc0-layered"], "RA2 listening references are never offered");
    assert.equal(lib.cc0[0].title, "MG burst");
    assert.ok(lib.project.some((c: { id: string }) => c.id === "project:mods/rtsai/standalone/audio/sfx/igiat1a.wav"), "the mod's own sounds can go anywhere");

    const facts = { slot: "fire:r2tank:Coax", label: "r2tank · Coax · fire", faction: "china", actor: "r2tank", kind: "fire", current: ["igiat1a.wav", "igiat1b.wav", "igiat1c.wav"] };
    const chosen = await call(h, "POST", "/api/sound-review/action", { type: "choose", candidate: lib.cc0[0].id, slots: [facts], trim: { start: 0.01, end: 0.2 } });
    assert.equal(chosen.status, 200, chosen.body.toString());
    const onDisk = JSON.parse(readFileSync(join(root, "art", "sound-review.json"), "utf8"));
    const c = onDisk.slots["fire:r2tank:Coax"].chosen;
    assert.equal(c.source, "cc0");
    assert.equal(c.sha256, sha(mg), "the desk records the bytes it chose");
    assert.equal(c.licence, "CC0 1.0");
    assert.equal(c.origin, "https://opengameart.org/x");
    assert.deepEqual(c.trim, { start: 0.01, end: 0.2 });
    const bake = await call(h, "POST", "/api/sound-review/action", { type: "choose", candidate: "bakeoff:A.rifle_burst.cc0-layered", slots: [{ ...facts, slot: "impact:r2tank:Coax", kind: "impact" }] });
    assert.equal(bake.json().file.slots["impact:r2tank:Coax"].chosen.sha256, sha(rifle));
    assert.deepEqual(bake.json().file.slots["impact:r2tank:Coax"].chosen.recipe, { layers: [{ src: "oga-ffsl/AK-47/C_29P.wav" }] }, "with the recipe that made it");
    assert.equal(bake.json().pending, 2);
    assert.equal((await call(h, "POST", "/api/sound-review/action", { type: "choose", candidate: "bakeoff:A.rifle_burst.ra2-igiat1a", slots: [facts] })).status, 404, "an RA2 reference cannot be chosen");
    const forged = await call(h, "POST", "/api/sound-review/action", { type: "choose", candidate: { id: "bakeoff:x", source: "bakeoff", title: "x", path: "D:/x.wav", sha256: null, licence: "EA (Command & Conquer: Red Alert 2)" }, slots: [facts] });
    assert.equal(forged.status, 400);
    await call(h, "POST", "/api/sound-review/action", { type: "note", text: "Coax: a light MG", slots: [facts] });
    await call(h, "POST", "/api/sound-review/action", { type: "choose", candidate: "eva-clip:003", slots: [{ slot: "notify:NuclearMissileReady", label: "Nuclear Missile Ready", faction: null, actor: null, kind: "notify", current: ["mods/rtsai/modern-factions/audio/eva/china/002.wav"] }] });
    await call(h, "POST", "/api/sound-review/action", { type: "size", actors: ["r2tank"], size: "large" });
    const back = (await call(h, "GET", "/api/sound-review/state")).json();
    assert.deepEqual(back.file, JSON.parse(readFileSync(join(root, "art", "sound-review.json"), "utf8")), "state answers what is on disk");
    assert.equal(back.file.slots["notify:NuclearMissileReady"].chosen.path, "003");
    assert.equal(back.file.deathSizes.r2tank, "large");
    assert.deepEqual(back.file.slots["fire:r2tank:Coax"].log.map((l: { action: string }) => l.action), ["choose", "note"]);

    const wav = await call(h, "GET", `/api/sound-review/audio?c=${encodeURIComponent("project:mods/rtsai/standalone/audio/sfx/igiat1a.wav")}`);
    assert.equal(wav.status, 200);
    assert.equal(wav.type, "audio/wav");
    assert.equal((await call(h, "GET", `/api/sound-review/audio?c=${encodeURIComponent("bakeoff:A.rifle_burst.ra2-igiat1a")}`)).status, 404, "nor played");
    assert.equal((await call(h, "GET", `/api/sound-review/audio?c=${encodeURIComponent("project:mods/rtsai/../../secret.wav")}`)).status, 404);
    if (hasFfmpeg) {
      const peaks = (await call(h, "GET", `/api/sound-review/peaks?c=${encodeURIComponent(lib.cc0[0].id)}`)).json();
      assert.equal(peaks.peaks.length, 64);
      assert.ok(peaks.seconds > 0.2 && peaks.seconds < 0.3, String(peaks.seconds));
    }
    const shared = (await call(h, "GET", "/api/sound-review/regenerate", undefined)).status;
    assert.equal(shared, 404);
    assert.equal((await call(h, "POST", "/api/sound-review/regenerate", { kind: "voice", path: "mods/rtsai/standalone/audio/sfx/igiat1a.wav", text: "x" })).status, 400, "only the factions' own lines can be said again");
    assert.equal((await call(h, "GET", "/api/sound-review/state", undefined, "rtsai.net")).status, 403, "local pages only");
    assert.equal((await call(handler("production"), "GET", "/api/sound-review/state")).status, 404, "no API in production");
    assert.ok(existsSync(join(root, "art", "sound-review.json")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("public builds stub the Sound desk out of the Faction viewer", () => {
  const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(config, /ViewerAdmin\|SoundDesk/, "the admin stub plugin replaces the SoundDesk module");
  assert.match(config, /SoundDesk: \["SoundDesk", "SoundDeskToggle"\]/, "with both of its exports");
  assert.match(config, /\/api\/sound-review/, "the dev API is mounted by the serve-only plugin");
  const viewer = readFileSync(new URL("../app/components/art/viewer/FactionViewer.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(viewer, /api\/sound-review/, "the public viewer itself never names the API");
});
