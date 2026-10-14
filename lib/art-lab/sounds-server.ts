/**
 * Dev-only, read-only: actors' and factions' sounds for the local Studio, resolved from RTSAI-Mod main's rules.
 *
 * Project audio (the mod's own licensed clips) is read in place from the mod checkout. Original RA2 sounds are
 * extracted on demand from the player's own RA2 content into the private, gitignored originals cache, exactly like
 * the original art; nothing here is bundled (the published Studio snapshot carries the original units' voices and
 * effects for the Faction viewer, see sounds-snapshot.ts). Both are served as 16-bit PCM WAV (the game's IMA ADPCM is
 * not something browsers decode).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cachedFile, extractOriginals, type OriginalsConfig } from "./originals";
import { loadModData, type ModData, type ModReader } from "./resolve";
import { actorSounds, factionSpeech, loadAudioData, musicTracks, weaponSounds, type AudioData, type SoundFile, type SoundGroup } from "./sounds";
import { clipRecords, parseVoiceSheet, type ClipRecord, type NativeReviewFile, type VoiceLine } from "./voice-review";
import { toPcmWav, wavInfo } from "./wav";

export const SOUND_ROUTE = "/api/art-review/sound";
const AUDIO_DIR = "mods/rtsai/modern-factions/audio/";
const SFX_DIR = "mods/rtsai/audio/sfx/";

const reader = (root: string): ModReader => {
  const path = (p: string) => join(root, existsSync(join(root, "engine")) ? p : p.replace(/^engine\//, ""));
  return { text: p => readFileSync(path(p), "utf8"), bytes: p => new Uint8Array(readFileSync(path(p))), exists: p => existsSync(path(p)) };
};

type Loaded = { at: number; data: ModData; audio: AudioData; records: Map<string, ClipRecord>; sheet: Map<string, VoiceLine>; read: ModReader };
const TTL_MS = 20_000;
const cache = new Map<string, Loaded>();
/** Rules, voice sets and the per-clip records of a mod checkout (re-read every 20 s: tools change them). */
export function soundData(modRoot: string): Loaded {
  const hit = cache.get(modRoot);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const read = reader(modRoot);
  const data = loadModData(read);
  const audio = loadAudioData(read, data);
  // Per-clip records, keyed by mod path: the factions' voices and announcers, and the project's own effects.
  const records = new Map<string, ClipRecord>();
  for (const dir of [AUDIO_DIR, SFX_DIR]) {
    try { for (const [file, r] of clipRecords(JSON.parse(read.text(`${dir}PROVENANCE.json`)))) records.set(`${dir}${file}`, r); } catch { /* no records */ }
  }
  let sheet = new Map<string, VoiceLine>();
  try { sheet = new Map(parseVoiceSheet(readFileSync(join(modRoot, "docs", "voice-review.csv"), "utf8")).map(l => [l.file, l])); } catch { /* no sheet */ }
  const loaded = { at: Date.now(), data, audio, records, sheet, read };
  cache.set(modRoot, loaded);
  return loaded;
}

export type SoundClip = SoundFile & {
  url: string;
  /** Project audio: what the line says, how it was made and its licence. */
  line?: { language: string | null; text: string | null; english: string | null; transcript: string | null; meaning: string | null; verdict: string | null; notes: string | null; nativeSpeaker: string | null; role: string | null };
  credit?: { engine: string | null; model: string | null; license: string | null; speaker: string | null; source: string | null; generatedAt: string | null };
  /** False when the project file is absent from the mod checkout. */
  present: boolean;
};
export type SoundGroupPayload = Omit<SoundGroup, "files"> & { files: SoundClip[] };

/** URL, line text and credit for one resolved file. */
export function describe(file: SoundFile, loaded: Loaded): SoundClip {
  if (file.origin === "original") return { ...file, url: `${SOUND_ROUTE}?original=${encodeURIComponent(file.file)}`, present: true };
  const record = loaded.records.get(file.file);
  // The sheet names clips by file name (they are unique across the mod's audio folders).
  const sheet = loaded.sheet.get(file.file.split("/").pop()!);
  return {
    ...file, url: `${SOUND_ROUTE}?path=${encodeURIComponent(file.file)}`, present: loaded.read.exists(file.file),
    line: record || sheet ? {
      language: sheet?.language || record?.language || null, text: sheet?.intended || record?.text || null, english: sheet?.english || record?.translation || (record?.language?.startsWith("en") ? record.text : null),
      transcript: sheet?.transcript || record?.transcript || null, meaning: sheet?.meaning || null, verdict: sheet?.verdict || null, notes: sheet?.notes || null, nativeSpeaker: sheet?.nativeSpeaker || null, role: sheet?.role || record?.role || null,
    } : undefined,
    credit: record ? { engine: record.engine, model: record.model, license: record.license, speaker: record.speaker, source: record.source, generatedAt: record.generatedAt } : undefined,
  };
}

export function actorSoundsPayload(modRoot: string, actor: string, faction: string | null) {
  const loaded = soundData(modRoot);
  const s = actorSounds(loaded.data, loaded.audio, actor, faction);
  return { ...s, groups: s.groups.map(g => ({ ...g, files: g.files.map(f => describe(f, loaded)) })) };
}

/** Report and impact sounds per weapon name (the Encounter replay plays them at the recorded shot times). */
export function weaponSoundsPayload(modRoot: string, weapons: string[]) {
  const loaded = soundData(modRoot);
  const out: Record<string, { report: SoundClip[]; impact: SoundClip[] }> = {};
  for (const name of weapons.slice(0, 64)) {
    if (!loaded.data.weapons?.has(name.toLowerCase())) continue;
    const s = weaponSounds(loaded.data, name);
    out[name] = { report: s.report.map(f => describe(f, loaded)), impact: s.impact.map(f => describe(f, loaded)) };
  }
  return out;
}

/** A faction's announcer lines, its voice sets by the actors that use them, and the music the mod lists. */
export function factionSoundsPayload(modRoot: string, faction: string, actors: string[]) {
  const loaded = soundData(modRoot);
  const speech = factionSpeech(loaded.audio, faction).map(n => ({ notification: n.notification, files: n.files.map(f => describe(f, loaded)) }));
  const sets = new Map<string, { voiceSet: string; actors: string[]; groups: SoundGroupPayload[] }>();
  for (const actor of actors.slice(0, 120)) {
    const s = actorSoundsPayload(modRoot, actor, faction);
    if (!s.voiceSet) continue;
    const entry = sets.get(s.voiceSet) ?? { voiceSet: s.voiceSet, actors: [], groups: s.groups.filter(g => g.kind === "voice" || g.id.startsWith("voice:")) };
    entry.actors.push(actor);
    sets.set(s.voiceSet, entry);
  }
  const music = musicTracks(loaded.audio).map(t => ({ ...t, file: describe(t.file, loaded) }));
  return { faction, speech, voiceSets: [...sets.values()], music };
}

/** The voice sheet's lines with the local native-speaker verdicts and their clips' URLs. */
export function voiceReviewPayload(modRoot: string, native: NativeReviewFile) {
  const loaded = soundData(modRoot);
  return [...loaded.sheet.values()].map(line => ({ ...line, url: `${SOUND_ROUTE}?path=${encodeURIComponent(`${AUDIO_DIR}${line.file}`)}`, native: native.reviews[line.file] ?? null }));
}

const SAFE_ORIGINAL = /^[a-z0-9_-]{1,40}\.wav$/i;
/**
 * The bytes for `?path=` (a project clip under mods/rtsai/, read in place) or `?original=` (an RA2 sound, extracted
 * into the private cache on first use), as PCM WAV. Null when it does not exist or is not a sound.
 */
export async function soundBytes(modRoot: string, originals: OriginalsConfig | null, query: { path?: string | null; original?: string | null }): Promise<Uint8Array | null> {
  if (query.path) {
    const p = query.path.replace(/\\/g, "/");
    if (!/^mods\/rtsai\/[\w./-]+\.wav$/i.test(p) || p.includes("..")) return null;
    const file = join(modRoot, p);
    if (!existsSync(file) || !statSync(file).isFile()) return null;
    return toPcmWav(new Uint8Array(readFileSync(file)));
  }
  if (query.original && originals) {
    const name = query.original.toLowerCase();
    if (!SAFE_ORIGINAL.test(name)) return null;
    const pcmName = name.replace(/\.wav$/, ".pcm.wav");
    const ready = cachedFile(originals, pcmName);
    if (ready) return new Uint8Array(readFileSync(ready));
    if (!cachedFile(originals, name)) await extractOriginals(originals, [name]);
    const raw = cachedFile(originals, name);
    if (!raw) return null;
    const pcm = toPcmWav(new Uint8Array(readFileSync(raw)));
    try { const dir = join(raw, ".."); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, pcmName), pcm); } catch { /* serve uncached */ }
    return pcm;
  }
  return null;
}

/** Header facts for a clip (the sound check): format, rate, length. */
export const clipInfo = (bytes: Uint8Array) => wavInfo(bytes);
