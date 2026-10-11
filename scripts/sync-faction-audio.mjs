// Publish the modern factions' own, licensed sounds for the public Faction viewer.
//
//   npm run sync:audio                 # write public/faction-audio/ and data/faction-audio.json
//   npm run sync:audio -- --check      # fail if the published copy no longer matches the mod
//   npm run sync:audio -- --mod=../RTSAI-Mod
//
// For each of the 122 modern actors it resolves, from RTSAI-Mod main's rules, the sounds the game plays
// (lib/art-lab/sounds.ts) and keeps only the project's own clips: files under mods/rtsai/ that carry a per-clip record
// with a licence (modern-factions/audio/PROVENANCE.json, audio/sfx/PROVENANCE.json). Original RA2 sounds are never
// published. Each clip is encoded once with ffmpeg (MP3, mono, 22.05 kHz, 40 kbps: every browser decodes it) under a
// content-hashed name; --check verifies the sources still hash the same and every output exists, without re-encoding.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { verifyFrozenInput } from "./frozen-inputs.mjs";
import { register } from "tsx/esm/api";

register();
const { loadModData } = await import("../lib/art-lab/resolve.ts");
const { actorSounds, loadAudioData } = await import("../lib/art-lab/sounds.ts");
const { clipRecords, parseVoiceSheet } = await import("../lib/art-lab/voice-review.ts");
const { artLab } = await import("../lib/art-lab/manifest.ts");

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const modRoot = resolve(web, arg("mod", "../RTSAI-Mod"));
const check = process.argv.includes("--check");
const outDir = join(web, "public", "faction-audio"), manifestPath = join(web, "data", "faction-audio.json");
const ENCODER = ["-ac", "1", "-ar", "22050", "-codec:a", "libmp3lame", "-b:a", "40k", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact"];
const ENCODER_LABEL = "ffmpeg libmp3lame, mono, 22.05 kHz, 40 kbps";
const KINDS = new Set(["voice", "weapon", "impact", "death", "deploy", "movement"]);

const read = { text: p => readFileSync(join(modRoot, p), "utf8"), bytes: p => new Uint8Array(readFileSync(join(modRoot, p))), exists: p => existsSync(join(modRoot, p)) };
if (!read.exists("mods/rtsai/mod.yaml")) throw new Error(`No RTSAI mod at ${modRoot}; pass --mod=<path>`);
const data = loadModData(read), audio = loadAudioData(read, data);
const records = new Map();
for (const dir of ["mods/rtsai/modern-factions/audio/", "mods/rtsai/audio/sfx/"]) {
  try { for (const [file, r] of clipRecords(JSON.parse(read.text(`${dir}PROVENANCE.json`)))) records.set(`${dir}${file}`, r); } catch { /* none */ }
}
let sheet = new Map();
try { sheet = new Map(parseVoiceSheet(read.text("docs/voice-review.csv")).map(l => [l.file, l])); } catch { /* none */ }
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const frozenIdentity = arg("mod-identity", "");
const frozen = frozenIdentity ? verifyFrozenInput(modRoot, frozenIdentity) : null;
const commit = frozen?.head ?? execFileSync("git", ["-C", modRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const voiceSelection = arg("voice-language", "base");
if (!["base", "faction", "en"].includes(voiceSelection)) throw new Error("Invalid voice language");
const voiceOptions = {};

// Every played project clip per actor, grouped as the Studio shows them.
const units = {}, wanted = new Map(), skipped = [];
for (const faction of artLab.factions) for (const actor of faction.actors) {
  const s = actorSounds(data, audio, actor, faction.id, voiceSelection === "base" ? undefined : voiceSelection);
  if (s.voiceOptions) voiceOptions[actor] = s.voiceOptions;
  const groups = [];
  for (const g of s.groups) {
    if (!g.played || !KINDS.has(g.kind)) continue;
    const clips = [];
    for (const f of g.files) {
      if (f.origin !== "project") continue;
      const record = records.get(f.file);
      if (!record?.license || !read.exists(f.file)) { skipped.push(`${f.file} (${!record ? "no record" : !record.license ? "no licence in its record" : "absent from the mod"})`); continue; }
      clips.push(f.file);
      wanted.set(f.file, record);
    }
    if (clips.length) groups.push({ id: g.id, label: g.label, kind: g.kind, clips: [...new Set(clips)] });
  }
  if (groups.length) units[actor] = groups;
}

const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
const planPath = arg("plan", "");
if (planPath) {
  if (check || existsSync(planPath)) throw new Error("Audio plan requires a new explicit output and cannot combine with --check");
  const sourceClips = Object.fromEntries([...wanted].map(([file, record]) => [file, { sourceSha256: sha(read.bytes(file)), license: record.license, existingPublished: previous?.clips?.[file]?.sourceSha256 === sha(read.bytes(file)) ? previous.clips[file].src : null }]));
  const changedUnits = [...new Set([...Object.keys(previous?.units ?? {}), ...Object.keys(units)])].filter(actor => JSON.stringify(previous?.units?.[actor]) !== JSON.stringify(units[actor]));
  writeFileSync(resolve(planPath), JSON.stringify({ schema: 1, source: { commit, identity: frozenIdentity || null }, voiceSelection, voiceOptions, units, sourceClips, changedUnits, unpublishedClips: Object.keys(sourceClips).filter(file => !sourceClips[file].existingPublished), humanReview: "pending", policy: "Plan only; no public files, approvals or release manifest changed" }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "plan-only", changedUnits, sourceClips: wanted.size, unpublishedClips: Object.values(sourceClips).filter(clip => !clip.existingPublished).length }));
  process.exit(0);
}

if (check) {
  const problems = [];
  if (!previous) problems.push("data/faction-audio.json is missing");
  else {
    if (JSON.stringify(previous.units) !== JSON.stringify(units)) problems.push("the units' sound lists changed");
    if (frozenIdentity && previous.sourceIdentity !== frozenIdentity) problems.push("the frozen source identity changed");
    if (Object.keys(voiceOptions).length && ((previous.voiceSelection ?? "base") !== voiceSelection || JSON.stringify(previous.voiceOptions) !== JSON.stringify(voiceOptions))) problems.push("the native voice language metadata changed");
    for (const [file] of wanted) {
      const clip = previous.clips[file];
      if (!clip) { problems.push(`${file} is not published`); continue; }
      if (clip.sourceSha256 !== sha(read.bytes(file))) problems.push(`${file} changed in the mod`);
      if (!existsSync(join(web, "public", clip.src))) problems.push(`${clip.src} is missing`);
    }
  }
  if (problems.length) { console.error(problems.slice(0, 20).join("\n")); throw new Error(`Faction audio is stale (${problems.length}); run npm run sync:audio`); }
  console.log(`Faction audio: ${wanted.size} clips for ${Object.keys(units).length} actors, current with ${commit.slice(0, 12)}`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const temp = join(tmpdir(), `rtsai-audio-${process.pid}`);
mkdirSync(temp, { recursive: true });
const clips = {};
let bytes = 0;
for (const [file, record] of [...wanted].sort(([a], [b]) => a.localeCompare(b))) {
  const source = read.bytes(file), sourceSha256 = sha(source);
  const reuse = previous?.clips?.[file]?.sourceSha256 === sourceSha256 && previous.encoder === ENCODER_LABEL && existsSync(join(web, "public", previous.clips[file].src));
  let src;
  if (reuse) src = previous.clips[file].src;
  else {
    const out = join(temp, "clip.mp3");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(modRoot, file), ...ENCODER, out]);
    const mp3 = readFileSync(out);
    const name = `${file.split("/").pop().replace(/\.wav$/i, "")}.${sha(mp3).slice(0, 12)}.mp3`;
    writeFileSync(join(outDir, name), mp3);
    src = `/faction-audio/${name}`;
  }
  const size = readFileSync(join(web, "public", src)).length;
  bytes += size;
  const line = sheet.get(file.split("/").pop());
  clips[file] = {
    src, bytes: size, sourceSha256, license: record.license, engine: record.engine, speaker: record.speaker,
    language: line?.language || record.language, text: line?.intended || record.text, english: line?.english || record.translation || (record.language?.startsWith("en") ? record.text : null),
  };
}
rmSync(temp, { recursive: true, force: true });
const keep = new Set(Object.values(clips).map(c => c.src.split("/").pop()));
for (const name of readdirSync(outDir)) if (!keep.has(name)) rmSync(join(outDir, name));
const manifest = {
  schemaVersion: 1, generatedBy: "scripts/sync-faction-audio.mjs", mod: { repo: "alibad/RTSAI-Mod", commit }, encoder: ENCODER_LABEL,
  policy: "Only the project's own, licensed clips (a per-clip record with a licence in the mod). Original Red Alert 2 sounds are never published.",
  clips, units,
  ...(frozenIdentity ? { sourceIdentity: frozenIdentity } : {}),
  ...(Object.keys(voiceOptions).length ? { voiceSelection, voiceOptions } : {}),
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + "\n");
console.log(`Faction audio: ${Object.keys(clips).length} clips (${(bytes / 1048576).toFixed(2)} MB) for ${Object.keys(units).length} actors from ${commit.slice(0, 12)}${skipped.length ? `; skipped ${skipped.length}: ${[...new Set(skipped)].slice(0, 5).join(", ")}` : ""}`);
