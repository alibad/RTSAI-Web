/**
 * Server-only, run by scripts/publish-studio.ts on the owner's machine: the original Red Alert 2 voices and sound
 * effects (never music) for the published snapshot, so the public Faction viewer can play every unit's sounds. EA's
 * C&C modding guidelines allow them free and non-commercially, with EA's notice.
 *
 * For each of the viewer's sixteen factions it lists, per unit, the sounds the game plays (lib/art-lab/sounds.ts):
 * the modern factions' own units from RTSAI-Mod's rules (their licensed clips are named by mod path and published in
 * this repository; only their original weapon and impact sounds come from here), every original unit from the classic
 * add-on's rules (Westwood's voice sets, as the add-on plays them). Each original clip is extracted from the owner's own
 * RA2 files through the private originals cache, decoded from IMA ADPCM and encoded once as MP3 under its content hash
 * (a/<sha>.mp3), next to the art. Nothing here is written to the repository.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { artLab } from "./manifest";
import { childValue, traits } from "./miniyaml";
import { cachedFile, extractOriginals, type OriginalsConfig } from "./originals";
import { CLASSIC_DIR, loadModData, type ModData, type ModReader } from "./resolve";
import { actorSounds, loadAudioData, weaponSounds, type AudioData, type SoundFile } from "./sounds";
import { toPcmWav } from "./wav";
import { rosterActors, rosterFactions } from "../game-content";
import { EA_NOTICE } from "../ea-notice";

export const SOUND_ENCODER = ["-ac", "1", "-ar", "22050", "-codec:a", "libmp3lame", "-b:a", "48k", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact"];
export const SOUND_ENCODER_LABEL = "ffmpeg libmp3lame, mono, 22.05 kHz, 48 kbps";
/** What the viewer lists: voices, weapons, impacts, deaths, deploying and flight sounds (no ambient loops, no music). */
const KINDS = new Set(["voice", "weapon", "impact", "death", "deploy", "movement", "damage"]);
const SAFE_ORIGINAL = /^[a-z0-9_-]{1,40}\.wav$/;

export type SnapshotSoundGroup = { id: string; label: string; kind: string; clips: string[] };
export type FactionSoundsPayload = {
  faction: string;
  notice: string;
  units: Record<string, SnapshotSoundGroup[]>;
  weapons: Record<string, Record<string, { report: string[]; impact: string[] }>>;
  clips: Record<string, { src: string; bytes: number }>;
};
export type SoundSnapshot = {
  factions: Record<string, FactionSoundsPayload>;
  /** Original clips published, their total MP3 size, and names the owner's RA2 files do not have. */
  stats: { clips: number; bytes: number; added: number; missing: string[]; units: number };
};

const reader = (root: string): ModReader => {
  const path = (p: string) => join(root, existsSync(join(root, "engine")) ? p : p.replace(/^engine\//, ""));
  return { text: p => readFileSync(path(p), "utf8"), bytes: p => new Uint8Array(readFileSync(path(p))), exists: p => existsSync(path(p)) };
};

/** A clip as the snapshot names it: an original's file name, or a project clip's mod path. */
const ref = (f: SoundFile) => (f.origin === "original" ? f.file.toLowerCase() : f.file);

/** Every faction's unit sounds and weapon sounds, as references (nothing extracted yet). */
export function soundLists(modRoot: string) {
  const read = reader(modRoot);
  const modern = loadModData(read), classic = loadModData(read, { manifestPath: `${CLASSIC_DIR}/mod.yaml` });
  const sets: Record<"modern" | "classic", { data: ModData; audio: AudioData }> = {
    modern: { data: modern, audio: loadAudioData(read, modern) },
    classic: { data: classic, audio: loadAudioData(read, classic) },
  };
  const own = new Set(Object.keys(artLab.actors));
  const factions: Record<string, Omit<FactionSoundsPayload, "clips" | "notice">> = {};
  for (const faction of rosterFactions("ra2")) {
    const out: Omit<FactionSoundsPayload, "clips" | "notice"> = { faction: faction.id, units: {}, weapons: {} };
    for (const actor of rosterActors(faction)) {
      const id = actor.id.toLowerCase();
      // The project's units speak as RTSAI-Mod plays them; Westwood's units as the classic add-on plays them.
      const { data, audio } = own.has(id) ? sets.modern : sets.classic;
      const rules = data.rules.get(id);
      if (!rules) continue;
      const groups = actorSounds(data, audio, id, faction.id).groups
        .filter(g => g.played && KINDS.has(g.kind) && !g.id.startsWith("AmbientSound"))
        .map(g => ({ id: g.id, label: g.label, kind: g.kind, clips: [...new Set(g.files.map(ref))] }))
        .filter(g => g.clips.length);
      if (groups.length) out.units[id] = groups;
      const weapons: Record<string, { report: string[]; impact: string[] }> = {};
      for (const [, node] of traits(rules, "Armament")) {
        const weapon = childValue(node.value, "Weapon");
        if (!weapon) continue;
        const s = weaponSounds(data, weapon);
        if (s.report.length || s.impact.length) weapons[weapon.toLowerCase()] = { report: [...new Set(s.report.map(ref))], impact: [...new Set(s.impact.map(ref))] };
      }
      if (Object.keys(weapons).length) out.weapons[id] = weapons;
    }
    factions[faction.id] = out;
  }
  return factions;
}

/**
 * Extracts, encodes and writes every original clip the lists name into `site` (a/<sha>.mp3, kept when already there),
 * and returns each faction's payload with the clips' hosted URLs. Lists keep only clips that exist.
 */
export async function buildSoundSnapshot(opts: { modRoot: string; originals: OriginalsConfig; site: string; cdn: string; log?: (...a: unknown[]) => void }): Promise<SoundSnapshot> {
  const log = opts.log ?? (() => {});
  const lists = soundLists(opts.modRoot);
  const names = new Set<string>();
  for (const f of Object.values(lists)) {
    for (const groups of Object.values(f.units)) for (const g of groups) for (const c of g.clips) if (SAFE_ORIGINAL.test(c)) names.add(c);
    for (const weapons of Object.values(f.weapons)) for (const w of Object.values(weapons)) for (const c of [...w.report, ...w.impact]) if (SAFE_ORIGINAL.test(c)) names.add(c);
  }
  log(`sounds: ${names.size} original clips named by ${Object.keys(lists).length} factions`);
  const missing = new Set(await extractOriginals(opts.originals, [...names].sort()));
  const temp = join(tmpdir(), `rtsai-sounds-${process.pid}`);
  mkdirSync(temp, { recursive: true });
  const hosted = new Map<string, { src: string; bytes: number }>();
  let added = 0, bytes = 0;
  try {
    for (const name of [...names].sort()) {
      const raw = missing.has(name) ? null : cachedFile(opts.originals, name);
      if (!raw) { missing.add(name); continue; }
      let pcm: Uint8Array;
      try { pcm = toPcmWav(new Uint8Array(readFileSync(raw))); } catch { missing.add(name); continue; }
      const wav = join(temp, "clip.wav"), mp3 = join(temp, "clip.mp3");
      writeFileSync(wav, pcm);
      execFileSync("ffmpeg", ["-v", "error", "-y", "-i", wav, ...SOUND_ENCODER, mp3]);
      const data = readFileSync(mp3);
      const key = `a/${createHash("sha256").update(data).digest("hex").slice(0, 24)}.mp3`;
      const to = join(opts.site, key);
      if (!existsSync(to)) { mkdirSync(join(opts.site, "a"), { recursive: true }); writeFileSync(to, data); added++; }
      hosted.set(name, { src: `${opts.cdn}/${key}`, bytes: data.length });
      bytes += data.length;
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
  const keep = (c: string) => !SAFE_ORIGINAL.test(c) ? c.includes("/") : hosted.has(c);
  const factions: Record<string, FactionSoundsPayload> = {};
  let units = 0;
  for (const [id, f] of Object.entries(lists)) {
    const used = new Set<string>();
    const unitsOut: FactionSoundsPayload["units"] = {};
    for (const [actor, groups] of Object.entries(f.units)) {
      const kept = groups.map(g => ({ ...g, clips: g.clips.filter(keep) })).filter(g => g.clips.length);
      if (!kept.length) continue;
      unitsOut[actor] = kept;
      kept.forEach(g => g.clips.forEach(c => used.add(c)));
    }
    const weaponsOut: FactionSoundsPayload["weapons"] = {};
    for (const [actor, weapons] of Object.entries(f.weapons)) {
      for (const [weapon, w] of Object.entries(weapons)) {
        const report = w.report.filter(keep), impact = w.impact.filter(keep);
        if (!report.length && !impact.length) continue;
        (weaponsOut[actor] ??= {})[weapon] = { report, impact };
        [...report, ...impact].forEach(c => used.add(c));
      }
    }
    units += Object.keys(unitsOut).length;
    factions[id] = { faction: id, notice: EA_NOTICE, units: unitsOut, weapons: weaponsOut, clips: Object.fromEntries([...used].filter(c => hosted.has(c)).sort().map(c => [c, hosted.get(c)!])) };
  }
  return { factions, stats: { clips: hosted.size, bytes, added, missing: [...missing].sort(), units } };
}
