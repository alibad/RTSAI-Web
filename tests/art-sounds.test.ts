import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createArtReviewMiddleware } from "../lib/art-lab/review-server";
import { loadModData, type ModReader } from "../lib/art-lab/resolve";
import { actorSounds, factionSpeech, loadAudioData, musicTracks } from "../lib/art-lab/sounds";
import { applyNativeVerdict, emptyNativeReview, exportVoiceSheet, parseCsv, parseVoiceSheet } from "../lib/art-lab/voice-review";
import { pcmWav, toPcmWav, wavInfo } from "../lib/art-lab/wav";

type Reply = { status: number; type: string; body: Buffer };
async function call(handler: ReturnType<typeof createArtReviewMiddleware>, method: string, url: string, init: { body?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  const req = new IncomingMessage(new Socket());
  req.method = method; req.url = url; req.headers = { host: "localhost:3461", ...init.headers };
  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];
  const done = new Promise<Reply>(resolve => {
    res.end = ((chunk?: unknown) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(chunk as string));
      resolve({ status: res.statusCode, type: String(res.getHeader("content-type") ?? ""), body: Buffer.concat(chunks) });
      return res;
    }) as typeof res.end;
  });
  const pending = handler(req, res);
  if (init.body !== undefined) req.push(init.body);
  req.push(null);
  await pending;
  return done;
}

/** One IMA ADPCM block (mono): header sample/step index, then nibbles. */
function imaWav(first: number, index: number, nibbles: number[], blockAlign = 4 + nibbles.length / 2): Uint8Array {
  const data = new Uint8Array(blockAlign);
  data[0] = first & 255; data[1] = (first >> 8) & 255; data[2] = index; data[3] = 0;
  for (let i = 0; i < nibbles.length; i += 2) data[4 + i / 2] = nibbles[i] | (nibbles[i + 1] << 4);
  const out = new Uint8Array(48 + data.length);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => { for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i); };
  tag(0, "RIFF"); v.setUint32(4, 40 + data.length, true); tag(8, "WAVE");
  tag(12, "fmt "); v.setUint32(16, 20, true); v.setUint16(20, 17, true); v.setUint16(22, 1, true); v.setUint32(24, 22050, true);
  v.setUint32(28, 11100, true); v.setUint16(32, blockAlign, true); v.setUint16(34, 4, true); v.setUint16(36, 2, true); v.setUint16(38, nibbles.length + 1, true);
  tag(40, "data"); v.setUint32(44, data.length, true); out.set(data, 48);
  return out;
}

test("wav: IMA ADPCM decodes to 16-bit PCM the way the reference decoder does; PCM passes through", () => {
  // From 1000 at step index 0 (step 7): nibble 7 adds 7>>3 + 7 + 3 + 1 = 11, the index rises by 8; nibble 8|1 then
  // subtracts (step 16): 16>>3 + 16>>2 = 6.
  const pcm = toPcmWav(imaWav(1000, 0, [7, 9, 0, 0, 0, 0, 0, 0]));
  const info = wavInfo(pcm);
  assert.deepEqual([info.format, info.channels, info.sampleRate, info.bitsPerSample, info.frames], [1, 1, 22050, 16, 9]);
  const samples = new Int16Array(pcm.buffer.slice(pcm.byteOffset + 44));
  assert.deepEqual([...samples.slice(0, 3)], [1000, 1011, 1005]);
  const plain = pcmWav(new Int16Array([1, -2, 3]), 1, 44100);
  assert.equal(toPcmWav(plain), plain, "PCM is served unchanged");
  assert.throws(() => wavInfo(new Uint8Array(12)), /not a RIFF/);
});

/** A tiny mod: one modern actor with a voice set, a weapon, death sounds; the faction's announcer; music. */
function tinyMod() {
  const root = mkdtempSync(join(tmpdir(), "rtsai-sounds-"));
  const put = (path: string, text: string) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  put("mods/rtsai/mod.yaml", "Rules:\n\tra2|rules.yaml\nSequences:\nWeapons:\n\tra2|weapons.yaml\nVoices:\n\tra2|voices.yaml\nNotifications:\n\tra2|notifications.yaml\nMusic:\n\tra2|music.yaml\n");
  put("mods/rtsai/rules.yaml", [
    "r2tank:", "\tVoiced:", "\t\tVoiceSet: TankVoice", "\tArmament:", "\t\tWeapon: Cannon", "\tFireWarheadsOnDeath:", "\t\tWeapon: Boom",
    "r2rifle:", "\tVoiced:", "\t\tVoiceSet: EngVoice", "\tDeathSounds:", "\tDeathSounds@burned:", "\t\tVoice: Burned", "",
  ].join("\n"));
  put("mods/rtsai/weapons.yaml", "Cannon:\n\tReport: ra2|audio/fire.wav, vgriatta.wav\n\tWarhead@1: SpreadDamage\n\t\tImpactSounds: gexp14a.wav\nBoom:\n\tWarhead@1: CreateEffect\n\t\tImpactSounds: ra2|audio/boom.wav\n");
  put("mods/rtsai/voices.yaml", [
    "^Deaths:", "\tVoices:", "\t\tBurned: ienadia", "\t\tDie: igidia", "\tDisablePrefixes: Burned",
    "TankVoice:", "\tInherits: ^Deaths", "\tDefaultVariant: .wav", "\tVoices:", "\t\tSelect: ra2|audio/sel-zh, ra2|audio/sel-en", "\t\tMove: ra2|audio/sel-en",
    "EngVoice:", "\tInherits: ^Deaths", "\tDefaultVariant: .wav", "\tPrefixes:", "\t\tchina: iena", "\tVoices:", "\t\tSelect: sea", "",
  ].join("\n"));
  put("mods/rtsai/notifications.yaml", "Speech:\n\tDefaultVariant: .wav\n\tPrefixes:\n\t\tchina: ra2|audio/eva/china/\n\t\tamerica: ceva\n\tNotifications:\n\t\tBaseAttack: 054\n");
  put("mods/rtsai/music.yaml", "grinder: Grinder\n\tExtension: wav\n");
  const clip = Buffer.from(pcmWav(new Int16Array(2205).fill(100), 1, 22050));
  for (const f of ["audio/fire.wav", "audio/boom.wav", "audio/sel-zh.wav", "audio/sel-en.wav", "audio/eva/china/054.wav"]) { mkdirSync(dirname(join(root, "mods/rtsai", f)), { recursive: true }); writeFileSync(join(root, "mods/rtsai", f), clip); }
  put("docs/voice-review.csv", "﻿file,faction,language,engine,role,intended_text,english_line,asr_transcript,cer,detected_language,whisper_translation,low_confidence_words,literal_meaning,verdict,action,notes,native_speaker\r\nsel-zh.wav,China,zh-CN,chatterbox,crew,\"准备好了, 出发\",Ready,准备好了,0.000,zh,Ready,,Ready to go,ok,none,,\r\n");
  const reader: ModReader = { text: p => readFileSync(join(root, p), "utf8"), bytes: p => new Uint8Array(readFileSync(join(root, p))), exists: p => existsSync(join(root, p)) };
  return { root, reader };
}

test("sounds: voices, weapons, death and announcer resolve as the engine plays them", () => {
  const { root, reader } = tinyMod();
  try {
    const data = loadModData(reader), audio = loadAudioData(reader, data);
    const tank = actorSounds(data, audio, "r2tank", "china");
    const by = (id: string) => tank.groups.find(g => g.id === id);
    assert.equal(tank.voiceSet, "TankVoice");
    assert.deepEqual(by("voice:Select")?.files.map(f => [f.file, f.origin]), [["mods/rtsai/audio/sel-zh.wav", "project"], ["mods/rtsai/audio/sel-en.wav", "project"]]);
    assert.deepEqual(tank.groups.map(g => g.id).slice(0, 2), ["voice:Select", "voice:Move"], "orders first");
    assert.equal(by("voice:Die")?.played, false, "a vehicle without DeathSounds never plays its inherited death cries");
    assert.deepEqual(by("weapon:report")?.files.map(f => [f.file, f.origin]), [["mods/rtsai/audio/fire.wav", "project"], ["vgriatta.wav", "original"]]);
    assert.deepEqual(by("weapon:impact")?.files.map(f => f.file), ["gexp14a.wav"]);
    assert.deepEqual(by("death:explosion")?.files.map(f => f.file), ["mods/rtsai/audio/boom.wav"]);
    const rifle = actorSounds(data, audio, "r2rifle", "china");
    assert.deepEqual(rifle.groups.find(g => g.id === "voice:Select")?.files.map(f => f.file), ["ienasea.wav"], "faction prefix");
    assert.deepEqual(rifle.groups.find(g => g.id === "voice:Burned")?.files.map(f => [f.file, rifle.groups.find(g => g.id === "voice:Burned")?.played]), [["ienadia.wav", true]], "DisablePrefixes keeps the death cry unprefixed");
    assert.equal(rifle.groups.find(g => g.id === "voice:Die")?.played, true);
    assert.deepEqual(factionSpeech(audio, "china").map(n => n.files[0].file), ["mods/rtsai/audio/eva/china/054.wav"]);
    assert.deepEqual(factionSpeech(audio, "america").map(n => [n.files[0].file, n.files[0].origin]), [["ceva054.wav", "original"]]);
    assert.deepEqual(musicTracks(audio).map(t => [t.title, t.file.file, t.file.origin]), [["Grinder", "grinder.wav", "original"]]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("voice sheet: CSV quoting, verdicts that need a note, and an export that fills native_speaker", () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n'), [["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
  const sheet = "file,language,intended_text,native_speaker\r\nx-zh.wav,zh-CN,\"你好, 世界\",\r\ny-zh.wav,zh-CN,好,\r\n";
  assert.equal(parseVoiceSheet(sheet)[0].intended, "你好, 世界");
  let review = emptyNativeReview();
  assert.throws(() => applyNativeVerdict(review, "x-zh.wav", "wrong", " ", null, "2026-10-07T00:00:00Z"), /what is wrong/i);
  assert.throws(() => applyNativeVerdict(review, "../x.wav", "ok", "", null, "2026-10-07T00:00:00Z"), /Bad clip/);
  review = applyNativeVerdict(review, "x-zh.wav", "wrong", "Tone sounds like a question", "Lin", "2026-10-07T10:00:00Z");
  review = applyNativeVerdict(review, "y-zh.wav", "ok", "", null, "2026-10-07T10:00:00Z");
  const out = parseCsv(exportVoiceSheet(sheet, review));
  assert.deepEqual(out.map(r => r[3]), ["native_speaker", "Wrong: Tone sounds like a question (Lin 2026-10-07)", "OK (2026-10-07)"]);
  assert.equal(applyNativeVerdict(review, "y-zh.wav", null, "", null, "x").reviews["y-zh.wav"], undefined, "a verdict can be withdrawn");
});

test("sound routes: clips as PCM, never outside the mod; verdicts go to the art workspace, not the mod", async () => {
  const { root } = tinyMod();
  const art = mkdtempSync(join(tmpdir(), "rtsai-art-"));
  try {
    const handler = createArtReviewMiddleware({ root: art, env: "development", originals: { modRoot: root, supportDir: root, cacheDir: join(root, ".cache") } });
    const sounds = JSON.parse((await call(handler, "GET", "/api/art-review/sounds?mode=ra2&actor=r2tank&faction=china")).body.toString("utf8"));
    const select = sounds.groups.find((g: { id: string }) => g.id === "voice:Select").files[0];
    assert.deepEqual([select.line.text, select.line.english, select.line.verdict], ["准备好了, 出发", "Ready", "ok"]);
    const clip = await call(handler, "GET", select.url.replace(/^\/api\/art-review/, "/api/art-review"));
    assert.equal(clip.status, 200); assert.equal(clip.type, "audio/wav"); assert.equal(wavInfo(new Uint8Array(clip.body)).format, 1);
    for (const bad of ["path=mods%2Frtsai%2F..%2F..%2Fsecret.wav", "path=docs%2Fvoice-review.csv", "original=..%2Fx.wav"]) assert.equal((await call(handler, "GET", `/api/art-review/sound?${bad}`)).status, 404, bad);
    const post = (body: unknown) => call(handler, "POST", "/api/art-review/voice-review", { body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    assert.equal((await post({ clip: "sel-zh.wav", verdict: "wrong", note: "" })).status, 400);
    assert.equal((await post({ clip: "sel-zh.wav", verdict: "ok", reviewer: "Lin" })).status, 200);
    const saved = JSON.parse(readFileSync(join(art, "voice-review.json"), "utf8"));
    assert.equal(saved.reviews["sel-zh.wav"].verdict, "ok");
    assert.equal(readFileSync(join(root, "docs/voice-review.csv"), "utf8").includes("Lin"), false, "the mod's sheet is never written");
    const exported = await call(handler, "GET", "/api/art-review/voice-review/export");
    assert.match(exported.type, /text\/csv/); assert.match(exported.body.toString("utf8"), /OK \(Lin \d{4}-\d{2}-\d{2}\)/);
    const prod = createArtReviewMiddleware({ root: art, env: "production", originals: { modRoot: root, supportDir: root, cacheDir: root } });
    assert.equal((await call(prod, "GET", "/api/art-review/sound?path=mods%2Frtsai%2Faudio%2Ffire.wav")).status, 404, "no sound route in production");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(art, { recursive: true, force: true }); }
});

test("public faction audio: only the project's own, licensed clips, every one published", async () => {
  const { default: manifest } = await import("../data/faction-audio.json", { with: { type: "json" } }) as { default: { clips: Record<string, { src: string; license: string; sourceSha256: string }>; units: Record<string, { clips: string[] }[]>; policy: string } };
  const clips = Object.entries(manifest.clips);
  assert.ok(clips.length > 100, "the factions' voice lines are published");
  for (const [file, clip] of clips) {
    assert.match(file, /^mods\/rtsai\/(modern-factions\/audio|audio\/sfx)\/[\w-]+\.wav$/, `${file} is the project's own clip`);
    assert.ok(clip.license, `${file} carries its licence`);
    assert.match(clip.src, /^\/faction-audio\/[\w-]+\.[0-9a-f]{12}\.mp3$/);
    assert.ok(existsSync(join("public", clip.src)), `${clip.src} is published`);
  }
  for (const groups of Object.values(manifest.units)) for (const g of groups) for (const f of g.clips) assert.ok(manifest.clips[f], `${f} is listed`);
  assert.match(manifest.policy, /never published/);
});
