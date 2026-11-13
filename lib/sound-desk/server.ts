/**
 * The Sound desk's dev-only API (/api/sound-review), for the admin Faction viewer of the local app. Mounted by a Vite
 * plugin with `apply: "serve"` (vite.config.ts), by the local app's gateway (scripts/art-lab-preview.ts) and by
 * `npm run sound-desk`; it answers 404 whenever NODE_ENV is "production" and only to same-machine pages.
 *
 *   GET  /state                      sound-review.json, what is pending, the GPU claim and the voice worker
 *   GET  /unit?actor=&faction=       a unit's slots (voices, each weapon's fire and impact, death, deploy...)
 *   GET  /faction?faction=           the faction's announcer: clips with what they say, and the notifications
 *   GET  /library                    candidates: the bake-off (never its RA2 references), the mod's own sounds, CC0
 *   GET  /takes                      regenerated takes under RTSAI-Art/sounds/
 *   GET  /shared                     the stand-in sounds many modern units share (fire, impact, death), by family
 *   GET  /deaths                     every modern vehicle, ship, aircraft and building with its death sound and size
 *   GET  /audio?c=<id>[&t0=&t1=]     a candidate or a current sound, playable (PCM WAV, OGG, FLAC, MP3), optionally trimmed
 *   GET  /peaks?c=<id>[&t0=&t1=]     its waveform (64 peaks) and length
 *   POST /action                     choose / keep / clear / reject / unreject / note / size -> RTSAI-Art/sound-review.json
 *   POST /regenerate                 say a line again (announcer chain or the line's own voice generator) -> RTSAI-Art/sounds/
 *
 * Reads RTSAI-Mod in place (read-only); writes only RTSAI-Art/sound-review.json and RTSAI-Art/sounds/.
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { loadAudioData, type AudioData, type SoundFile } from "../art-lab/sounds";
import { loadModData, type ModData, type ModReader } from "../art-lab/resolve";
import { clipRecords, type ClipRecord } from "../art-lab/voice-review";
import { toPcmWav } from "../art-lab/wav";
import { applySoundAction, licenceVerdict, pendingSlots, readSoundReview, slotSlug, validateSoundAction, type CandidateSource, type ChosenSound, type DeathSize, type LicenceVerdict, type SlotFacts, type SoundAction, type SoundReviewFile } from "./model";
import { announcerSlots, deathChain, familyLabel, guessDeathSize, soundFamily, unitSlots, usageIndex, type DeskLine, type DeskSlot } from "./slots";

export const SOUND_REVIEW_ROUTE = "/api/sound-review";
export const MODERN = ["china", "iran", "turkey", "saudi", "yemen", "israel", "lebanon"] as const;

export type DeskCandidate = {
  id: string;
  source: CandidateSource;
  title: string;
  /** What it is: the bake-off slot, the mod folder and role, the CC0 pack. */
  sub: string;
  tags: string[];
  licence: string;
  verdict: LicenceVerdict;
  text?: string | null;
  language?: string | null;
  faction?: string | null;
  seconds?: number | null;
  prompt?: string | null;
};
export type DeskTake = DeskCandidate & { slot: string; at: string; meta: Record<string, unknown> };

export type SoundDeskConfig = {
  artRoot: string;
  modRoot: string;
  webRoot: string;
  bakeoffDir?: string | null;
  sourcesDir?: string | null;
  openraAi?: string | null;
  voicePython?: string | null;
  gpuLogs?: string | null;
  ffmpeg?: string;
  env?: string;
};

/**
 * Where the desk reads and writes. The canonical layout has RTSAI-Art and RTSAI-Mod (with the companion's voice scripts in companion/) beside RTSAI-Web; a
 * worktree trio (web/, mod/, art/ side by side) works too. Environment variables win.
 */
export function soundDeskConfig(webRoot: string, env: NodeJS.ProcessEnv = process.env): SoundDeskConfig {
  const rel = (p: string) => resolve(webRoot, p);
  const first = (...paths: (string | undefined)[]) => { const all = paths.filter((p): p is string => Boolean(p)).map(rel); return all.find(p => existsSync(p)) ?? all[0]; };
  return {
    webRoot,
    artRoot: first(env.RTSAI_ART_DIR, "../RTSAI-Art", "../art"),
    modRoot: first(env.RTSAI_SOUND_MOD_DIR, "../RTSAI-Mod", "../mod"),
    bakeoffDir: env.RTSAI_SOUND_BAKEOFF ?? "D:/Generated/RTSAI/sound/bakeoff",
    sourcesDir: env.RTSAI_SOUND_SOURCES ?? "D:/Datasets/Sounds",
    openraAi: first(env.RTSAI_OPENRA_AI_DIR, "../RTSAI-Mod/companion", "../mod/companion", "C:/Users/Admin/Code/hq/games/RTSAI-Mod/companion"),
    voicePython: env.RTSAI_VOICE_PYTHON ?? "C:/Users/Admin/Code/AI/chatterbox/.venv/Scripts/python.exe",
    gpuLogs: env.RTSAI_GPU_LOGS ?? "C:/Users/Admin/Code/AI/logs",
    ffmpeg: env.RTSAI_FFMPEG ?? "ffmpeg",
  };
}

function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as T; } catch { return null; }
}
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const mtime = (path: string) => { try { const s = statSync(path); return `${s.size}:${Math.round(s.mtimeMs)}`; } catch { return "missing"; } };
const AUDIO = /\.(wav|ogg|flac|mp3)$/i;
const TYPES: Record<string, string> = { ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac", ".mp3": "audio/mpeg" };

/** Resolves a relative path inside a root, refusing anything outside it. */
function within(root: string, rel: string) {
  if (!rel || rel.includes("\0") || /^[a-zA-Z]:|^[\\/]/.test(rel)) return null;
  const target = resolve(root, rel);
  const inside = relative(root, target);
  if (!inside || inside.startsWith("..") || inside.split(sep).includes("..")) return null;
  return target;
}

// ------------------------------------------------------------------------------------------------ the mod, read-only
type Mod = {
  at: number; stamp: string; data: ModData; audio: AudioData;
  /** Provenance per mod path (every PROVENANCE.json under mods/rtsai). */
  records: Map<string, ClipRecord & { raw: Record<string, unknown> }>;
  /** Bare stand-in name -> mod path, in the standalone build's mount order. */
  bare: Map<string, string>;
  /** Every audio file under mods/rtsai. */
  files: string[];
};
const STANDALONE_MOUNTS = ["standalone/audio/music", "standalone/audio/voices", "standalone/audio/ui", "standalone/audio/sfx", "standalone/placeholders/conquer", "standalone/placeholders"];

function modReader(root: string): ModReader {
  const path = (p: string) => join(root, p);
  return { text: p => readFileSync(path(p), "utf8"), bytes: p => new Uint8Array(readFileSync(path(p))), exists: p => existsSync(path(p)) };
}
function walk(dir: string, prefix: string, out: string[]) {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    const full = join(dir, name);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) walk(full, `${prefix}${name}/`, out);
    else if (AUDIO.test(name)) out.push(`${prefix}${name}`);
  }
}
function modStamp(root: string) {
  const files = ["mods/rtsai/mod.yaml", "mods/rtsai/audio/notifications.yaml", "mods/rtsai/modern-factions/audio/PROVENANCE.json", "mods/rtsai/standalone/audio/PROVENANCE.json"];
  let head = "";
  try { head = readFileSync(join(root, ".git"), "utf8"); } catch { /* a normal checkout */ }
  return files.map(f => mtime(join(root, f))).join("|") + head.length;
}
const mods = new Map<string, Mod>();
export function loadMod(root: string): Mod {
  const hit = mods.get(root);
  if (hit && Date.now() - hit.at < 15_000) return hit;
  const stamp = modStamp(root);
  if (hit && hit.stamp === stamp) { hit.at = Date.now(); return hit; }
  const read = modReader(root);
  const data = loadModData(read);
  const audio = loadAudioData(read, data);
  const files: string[] = [];
  walk(join(root, "mods", "rtsai"), "mods/rtsai/", files);
  const records = new Map<string, ClipRecord & { raw: Record<string, unknown> }>();
  const provenanceFiles: string[] = [];
  (function find(dir: string, prefix: string, depth: number) {
    if (depth > 4) return;
    let names: string[] = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const full = join(dir, name);
      if (name === "PROVENANCE.json") provenanceFiles.push(`${prefix}${name}`);
      else { try { if (statSync(full).isDirectory()) find(full, `${prefix}${name}/`, depth + 1); } catch { /* gone */ } }
    }
  })(join(root, "mods", "rtsai"), "mods/rtsai/", 0);
  for (const pj of provenanceFiles) {
    const raw = readJson<Record<string, unknown>>(join(root, pj));
    if (!raw) continue;
    const folder = dirname(pj);
    const rawBy = new Map<string, Record<string, unknown>>();
    if (raw.files && typeof raw.files === "object") for (const [k, v] of Object.entries(raw.files as Record<string, Record<string, unknown>>)) rawBy.set(k, v);
    for (const key of ["voice_lines", "announcers", "sound_effects"]) for (const r of (Array.isArray(raw[key]) ? raw[key] as Record<string, unknown>[] : [])) if (typeof r.filename === "string") rawBy.set(r.filename, { ...r, section: key });
    for (const [file, rec] of clipRecords(raw)) records.set(`${folder}/${file}`, { ...rec, raw: rawBy.get(file) ?? {} });
  }
  const bare = new Map<string, string>();
  for (const mount of [...STANDALONE_MOUNTS].reverse()) {
    for (const f of files) if (f.startsWith(`mods/rtsai/${mount}/`) && !f.slice(`mods/rtsai/${mount}/`.length).includes("/")) bare.set(f.split("/").pop()!.toLowerCase(), f);
  }
  const loaded: Mod = { at: Date.now(), stamp, data, audio, records, bare, files };
  mods.set(root, loaded);
  return loaded;
}

/** The project file the standalone game plays for a sound name. */
const locator = (mod: Mod, root: string) => (f: SoundFile): string | null => {
  if (f.origin === "project") return existsSync(join(root, f.file)) ? f.file : null;
  return mod.bare.get(f.file.toLowerCase()) ?? null;
};
const lineLookup = (mod: Mod) => (path: string): DeskLine | null => {
  const r = mod.records.get(path);
  if (!r) return null;
  const voice = (r.raw.voice ?? {}) as { speaker?: string };
  return { text: r.text, english: r.translation ?? (r.language?.startsWith("en") ? r.text : null), language: r.language, role: r.role, speaker: voice.speaker ?? r.speaker };
};

// ------------------------------------------------------------------------------------------------ the roster
type RosterUnit = { id: string; faction: string; name: string; category: string; cameo: string | null };
function roster(webRoot: string): RosterUnit[] {
  const art = readJson<{ factions: { id: string; actors: string[] }[]; actors: Record<string, { name: string; category: string }> }>(join(webRoot, "data", "art-lab.json"));
  const cameos = readJson<{ units: Record<string, { cameo?: { src?: string } }> }>(join(webRoot, "data", "faction-art.json"));
  if (!art) return [];
  return art.factions.filter(f => (MODERN as readonly string[]).includes(f.id)).flatMap(f => f.actors.map(id => ({
    id, faction: f.id, name: art.actors[id]?.name ?? id, category: art.actors[id]?.category ?? "vehicle", cameo: cameos?.units[id]?.cameo?.src ?? null,
  })));
}

// ------------------------------------------------------------------------------------------------ candidates
type Indexed = DeskCandidate & { file: string; listen: string; sha?: string | null; recipe?: unknown; origin?: string | null; engine?: string | null; voice?: string | null; seed?: number | string | null; reference?: boolean };
type BakeoffItem = { id: string; group: string; slot: string; slot_label?: string; source: string; reference?: boolean; licence: string; output_rights?: string; text?: string; text_en?: string; language?: string; faction?: string; duration_s?: number; prompt?: string; style_prompt?: string; recipe?: unknown; seed?: number; voice?: string; model_id?: string; delivery?: string; variant?: string; files: { wav_master?: string; ogg?: string; mp3?: string }; note?: string; clap_text?: string; mod_path?: string };
type SourceItem = { local_path: string; library: string; title: string; author?: string; description?: string; page?: string; url?: string; licence: string; sha256: string; archive?: boolean; derived_from?: string };

const SFX_TAGS: [RegExp, string][] = [[/rifle|gun|mg|burst|coax|shot|firearm|cannon|tank_main|pistol|sniper/i, "gun"], [/explo|boom|blast|collapse|debris|bang|firework/i, "explosion"], [/impact|hit|ricochet|metal/i, "impact"], [/missile|rocket|launch|whoosh/i, "missile"], [/engine|loop|drone|jet|rotor|flyby|track|excavat|motor/i, "engine"], [/dog|bark|bite|growl|creature/i, "creature"], [/zap|ew|laser|electr/i, "energy"]];
const tagsOf = (...texts: (string | null | undefined)[]) => { const t = texts.filter(Boolean).join(" "); return [...new Set(SFX_TAGS.filter(([re]) => re.test(t)).map(([, tag]) => tag))]; };

function bakeoffIndex(dir: string): Indexed[] {
  const manifest = readJson<{ candidates: BakeoffItem[] }>(join(dir, "manifest.json"));
  if (!manifest) return [];
  return manifest.candidates.flatMap((c): Indexed[] => {
    // RA2 originals are listening references in the bake-off: never offered here.
    if (c.reference || c.source === "ra2-reference") return [];
    const master = c.files.wav_master ? within(dir, c.files.wav_master) : null;
    if (!master || !existsSync(master)) return [];
    const listen = (c.files.ogg && within(dir, c.files.ogg)) || master;
    const licence = c.output_rights && /output$/.test(c.licence) ? `${c.licence}: ${c.output_rights}` : c.licence;
    const voice = c.group !== "A";
    return [{
      id: `bakeoff:${c.id}`, source: "bakeoff", title: voice ? (c.text ?? c.slot) : (c.slot_label ?? c.slot), sub: [c.slot_label ?? c.slot, c.source, c.faction, c.delivery, c.variant].filter(Boolean).join(" · "),
      tags: voice ? ["voice", ...(c.group === "D" ? ["announcer"] : [])] : ["sfx", ...tagsOf(c.slot, c.slot_label, c.clap_text)], licence, verdict: licenceVerdict(licence, c.reference),
      text: c.text ?? null, language: c.language ?? null, faction: c.faction ? c.faction.toLowerCase().replace(/ arabia$/, "").replace(/^türkiye$/, "turkey") : null, seconds: c.duration_s ?? null,
      prompt: c.prompt ?? c.style_prompt ?? null, file: master, listen, recipe: c.recipe ?? null, engine: c.model_id ?? c.source, voice: c.voice ?? null, seed: c.seed ?? null,
    }];
  });
}

function sourcesIndex(dir: string): Indexed[] {
  const list = readJson<SourceItem[]>(join(dir, "SOURCES.json"));
  if (!list) return [];
  return list.flatMap((s): Indexed[] => {
    if (s.archive || !AUDIO.test(s.local_path)) return [];
    const file = s.local_path.replace(/\\/g, "/");
    if (!existsSync(file)) return [];
    const pack = file.split("/").slice(-2, -1)[0] ?? s.library;
    return [{ id: `cc0:${s.sha256.slice(0, 24)}`, source: "cc0", title: s.title, sub: [s.library, pack, s.author].filter(Boolean).join(" · "), tags: ["sfx", ...tagsOf(s.title, s.description, pack)],
      licence: s.licence, verdict: licenceVerdict(s.licence), file, listen: file, sha: s.sha256, origin: s.url ?? s.page ?? null, prompt: s.description ?? null }];
  });
}

function projectIndex(mod: Mod, root: string): Indexed[] {
  return mod.files.flatMap((path): Indexed[] => {
    const r = mod.records.get(path);
    if (!r || !/\.(wav|ogg)$/i.test(path)) return [];
    const licence = r.license ?? (path.includes("/standalone/") ? "GPL-3.0 project output" : "");
    const folder = path.replace(/^mods\/rtsai\//, "").split("/").slice(0, -1).join("/");
    const eva = /\/eva\/([a-z]+)\//.exec(path)?.[1] ?? null;
    const voice = Boolean(r.text) || /voices|eva/.test(folder);
    const name = path.split("/").pop()!;
    return [{ id: `project:${path}`, source: "project", title: r.text ?? name, sub: [name, r.role, folder].filter(Boolean).join(" · "),
      tags: [voice ? "voice" : "sfx", ...(eva ? ["announcer"] : []), ...(/music/.test(folder) ? ["music"] : []), ...tagsOf(name, r.role)],
      licence, verdict: licenceVerdict(licence), text: r.text, language: r.language, faction: eva, file: join(root, path), listen: join(root, path) }];
  });
}

function takesIndex(artRoot: string): DeskTake[] {
  const out: DeskTake[] = [];
  const base = join(artRoot, "sounds");
  for (const faction of (existsSync(base) ? readdirSync(base) : [])) {
    for (const slug of (() => { try { return readdirSync(join(base, faction)); } catch { return []; } })()) {
      for (const take of (() => { try { return readdirSync(join(base, faction, slug)); } catch { return []; } })()) {
        const meta = readJson<Record<string, unknown>>(join(base, faction, slug, take, "meta.json"));
        const clip = join(base, faction, slug, take, "clip.wav");
        if (!meta || !existsSync(clip)) continue;
        const licence = String(meta.license ?? meta.licence ?? "");
        out.push({ id: `regen:sounds/${faction}/${slug}/${take}/clip.wav`, source: "regen", title: String(meta.text ?? take), sub: [String(meta.engine ?? ""), String((meta.voice as { speaker?: string } | undefined)?.speaker ?? ""), faction].filter(Boolean).join(" · "),
          tags: ["voice", ...(String(meta.slot ?? "").startsWith("eva:") ? ["announcer"] : [])], licence, verdict: licenceVerdict(licence), text: (meta.text as string) ?? null, language: (meta.language as string) ?? null, faction,
          seconds: typeof meta.duration_seconds === "number" ? meta.duration_seconds : null, slot: String(meta.slot ?? ""), at: String(meta.created ?? ""), meta });
      }
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

// ------------------------------------------------------------------------------------------------ audio
function ffmpegRun(ffmpeg: string, args: string[], timeoutMs = 30_000): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const p = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", ...args], { windowsHide: true });
    const chunks: Buffer[] = [], errs: Buffer[] = [];
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on("data", c => chunks.push(c));
    p.stderr.on("data", c => errs.push(c));
    p.on("error", e => { clearTimeout(timer); fail(e); });
    p.on("close", code => { clearTimeout(timer); if (code === 0) ok(Buffer.concat(chunks)); else fail(new Error(Buffer.concat(errs).toString().trim() || `ffmpeg exited ${code}`)); });
  });
}
const peaksCache = new Map<string, { seconds: number; peaks: number[] }>();
async function peaksOf(ffmpeg: string, file: string, t0: number | null, t1: number | null) {
  const key = `${file}|${mtime(file)}|${t0}|${t1}`;
  const hit = peaksCache.get(key);
  if (hit) return hit;
  const trim = t0 !== null && t1 !== null && t1 > t0 ? ["-ss", String(t0), "-to", String(t1)] : [];
  const raw = await ffmpegRun(ffmpeg, ["-i", file, ...trim, "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
  const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
  const n = 64, size = Math.max(1, Math.ceil(samples.length / n));
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * size; j < Math.min(samples.length, (i + 1) * size); j++) { const v = Math.abs(samples[j]); if (v > m) m = v; }
    peaks.push(Math.round((m / 32768) * 1000) / 1000);
  }
  const value = { seconds: Math.round((samples.length / 8000) * 1000) / 1000, peaks };
  if (peaksCache.size > 4000) peaksCache.clear();
  peaksCache.set(key, value);
  return value;
}

// ------------------------------------------------------------------------------------------------ voice worker
/** Set when the server process exits: the worker is stopped at once rather than after a grace period. */
let exiting = false;
type Job = { kind: "eva" | "voice"; faction: string; slot: string; clip?: string; filename?: string; text: string; engine?: string; out: string };
class VoiceWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private queue: { job: Job; ok: (r: Record<string, unknown>) => void; fail: (e: Error) => void }[] = [];
  private busy = false;
  private idle: NodeJS.Timeout | null = null;
  private buffer = "";
  private current: ((line: string) => void) | null = null;
  private yieldLine: string | null = null;
  constructor(private cfg: SoundDeskConfig) {
    process.once("exit", () => { exiting = true; this.stop(); });
  }
  get running() { return Boolean(this.proc); }
  get working() { return this.busy || this.queue.length > 0; }
  /** The GPU claim another session holds now (AI\logs\gpu-claim.txt), or null. */
  claim(): string | null {
    if (!this.cfg.gpuLogs) return null;
    try { const t = readFileSync(join(this.cfg.gpuLogs, "gpu-claim.txt"), "utf8").trim(); return t || null; } catch { return null; }
  }
  run(job: Job) { return new Promise<Record<string, unknown>>((ok, fail) => { this.queue.push({ job, ok, fail }); void this.pump(); }); }
  private start() {
    const script = join(this.cfg.webRoot, "tools", "sound-desk-voice.py");
    if (!this.cfg.voicePython || !existsSync(this.cfg.voicePython)) throw new Error(`No voice Python at ${this.cfg.voicePython} (set RTSAI_VOICE_PYTHON to a Python with kokoro, chatterbox-tts and faster-whisper)`);
    if (!this.cfg.openraAi || !existsSync(join(this.cfg.openraAi, "scripts", "voice_engines.py"))) throw new Error(`No companion voice scripts at ${this.cfg.openraAi} (RTSAI-Mod/companion; set RTSAI_OPENRA_AI_DIR)`);
    const p = spawn(this.cfg.voicePython, ["-u", script, "--openra-ai", this.cfg.openraAi], { windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl).trim(); this.buffer = this.buffer.slice(nl + 1);
        if (line.startsWith("{") && this.current) this.current(line);
        else if (line) console.log(`[sound-desk voice] ${line}`);
      }
    });
    p.stderr.on("data", c => { const t = String(c).trim(); if (t) console.log(`[sound-desk voice] ${t.slice(0, 400)}`); });
    p.on("close", () => { this.proc = null; if (this.current) this.current(JSON.stringify({ error: "The voice worker stopped" })); });
    this.proc = p;
  }
  private async pump() {
    if (this.busy) return;
    const next = this.queue.shift();
    if (!next) return;
    this.busy = true;
    if (this.idle) { clearTimeout(this.idle); this.idle = null; }
    try {
      this.takeGpu();
      if (!this.proc) this.start();
      const reply = await new Promise<Record<string, unknown>>(ok => {
        this.current = line => { this.current = null; try { ok(JSON.parse(line)); } catch { ok({ error: "Bad reply from the voice worker" }); } };
        this.proc!.stdin.write(JSON.stringify(next.job) + "\n");
      });
      if (reply.error) next.fail(new Error(String(reply.error))); else next.ok(reply);
    } catch (error) { next.fail(error instanceof Error ? error : new Error(String(error))); }
    this.busy = false;
    if (this.queue.length) void this.pump();
    else {
      this.giveGpu();
      // Models stay loaded for a few minutes of listening and retakes, then the GPU is handed back.
      this.idle = setTimeout(() => this.stop(), 4 * 60_000);
    }
  }
  /** During another session's claim window, one line in gpu-yield.txt (appended, never overwritten). */
  private takeGpu() {
    const claim = this.claim();
    if (!claim || this.yieldLine || !this.cfg.gpuLogs) return;
    this.yieldLine = `sound-desk (RTSAI-Web Sound desk) ${new Date().toISOString().replace(/\.\d+Z$/, "Z")} regenerating voice lines with Kokoro/Chatterbox, about 2 minutes`;
    try { appendFileSync(join(this.cfg.gpuLogs, "gpu-yield.txt"), `${this.yieldLine}\n`); } catch { this.yieldLine = null; }
  }
  /** Removes only this desk's own yield line. */
  private giveGpu() {
    if (!this.yieldLine || !this.cfg.gpuLogs) return;
    const file = join(this.cfg.gpuLogs, "gpu-yield.txt");
    try {
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      const i = lines.indexOf(this.yieldLine);
      if (i >= 0) { lines.splice(i, 1); writeFileSync(file, lines.join("\n")); }
    } catch { /* the file is not ours to recreate */ }
    this.yieldLine = null;
  }
  stop() {
    if (this.idle) { clearTimeout(this.idle); this.idle = null; }
    this.giveGpu();
    const p = this.proc;
    this.proc = null;
    if (!p) return;
    // Closing stdin ends the worker's loop; a Windows venv python.exe is a launcher with the interpreter as its child,
    // so the whole tree goes if it has not ended on its own.
    try { p.stdin.end(); } catch { /* gone */ }
    const kill = () => {
      if (p.exitCode !== null || !p.pid) return;
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else p.kill();
    };
    if (exiting) kill(); else setTimeout(kill, 5000).unref();
  }
}

// ------------------------------------------------------------------------------------------------ HTTP
function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.end(typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body));
}
function isLocal(req: IncomingMessage) {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  const local = (h: string) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(h) || h.endsWith(".localhost");
  if (!local(host)) return false;
  const origin = req.headers.origin;
  if (origin) { try { if (!local(new URL(origin).hostname)) return false; } catch { return false; } }
  return true;
}
async function body(req: IncomingMessage, limit: number): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw Object.assign(new Error("Send application/json"), { status: 415 });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) { size += (chunk as Buffer).length; if (size > limit) throw Object.assign(new Error("Too large"), { status: 413 }); chunks.push(chunk as Buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("Bad JSON"), { status: 400 }); }
}

export function createSoundReviewMiddleware(cfg: SoundDeskConfig) {
  const env = cfg.env ?? process.env.NODE_ENV;
  const artRoot = resolve(cfg.artRoot), modRoot = resolve(cfg.modRoot);
  const ffmpeg = cfg.ffmpeg ?? "ffmpeg";
  const file = join(artRoot, "sound-review.json");
  const worker = new VoiceWorker(cfg);
  let library: { stamp: string; bakeoff: Indexed[]; project: Indexed[]; cc0: Indexed[] } | null = null;
  const libraryNow = () => {
    const mod = loadMod(modRoot);
    const stamp = [mod.stamp, cfg.bakeoffDir ? mtime(join(cfg.bakeoffDir, "manifest.json")) : "", cfg.sourcesDir ? mtime(join(cfg.sourcesDir, "SOURCES.json")) : ""].join("|");
    if (!library || library.stamp !== stamp) library = { stamp, bakeoff: cfg.bakeoffDir ? bakeoffIndex(cfg.bakeoffDir) : [], project: projectIndex(mod, modRoot), cc0: cfg.sourcesDir ? sourcesIndex(cfg.sourcesDir) : [] };
    return library;
  };
  const readFile = (): SoundReviewFile => readSoundReview(readJson(file));
  const writeFile = (next: SoundReviewFile) => {
    mkdirSync(artRoot, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(next, null, 2) + "\n");
    renameSync(temp, file);
  };
  /** A candidate or current sound by id, with the file the apply tool would copy and the one to listen to. */
  const lookup = (id: string): Indexed | null => {
    const lib = libraryNow();
    if (id.startsWith("bakeoff:")) return lib.bakeoff.find(c => c.id === id) ?? null;
    if (id.startsWith("cc0:")) return lib.cc0.find(c => c.id === id) ?? null;
    if (id.startsWith("project:")) {
      const path = id.slice(8);
      const hit = lib.project.find(c => c.id === id);
      if (hit) return hit;
      // A current sound with no record (it still plays in game): listenable, never choosable.
      if (/^mods\/rtsai\/[\w./-]+\.(wav|ogg)$/i.test(path) && !path.includes("..") && existsSync(join(modRoot, path)))
        return { id, source: "project", title: path.split("/").pop()!, sub: path, tags: [], licence: "", verdict: "refused", file: join(modRoot, path), listen: join(modRoot, path) };
      return null;
    }
    if (id.startsWith("regen:")) {
      const t = takesIndex(artRoot).find(c => c.id === id);
      const path = t ? within(artRoot, id.slice(6)) : null;
      return t && path ? { ...t, file: path, listen: path, engine: String(t.meta.engine ?? ""), voice: String((t.meta.voice as { speaker?: string } | undefined)?.speaker ?? ""), seed: (t.meta.seed as number | null) ?? null } : null;
    }
    return null;
  };
  const chosen = (id: string): ChosenSound | null => {
    if (id.startsWith("eva-clip:")) {
      const clip = id.slice(9);
      if (!/^[0-9A-Za-z_-]{1,16}$/.test(clip)) return null;
      return { id, source: "eva-clip", title: `Announcer clip ${clip}`, path: clip, sha256: null, licence: "Apache-2.0 (Kokoro-82M, every faction's announcer clip)" };
    }
    const c = lookup(id);
    if (!c) return null;
    const path = c.source === "project" ? relative(modRoot, c.file).split(sep).join("/") : c.source === "regen" ? id.slice(6) : c.file;
    return { id: c.id, source: c.source, title: c.title, path, sha256: c.sha ?? sha256(c.file), licence: c.licence, recipe: c.recipe ?? null, prompt: c.prompt ?? null, text: c.text ?? null, language: c.language ?? null, engine: c.engine ?? null, voice: c.voice ?? null, seed: c.seed ?? null, origin: c.origin ?? null };
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (env === "production") return send(res, 404, { error: "Not found" });
    try {
      if (!isLocal(req)) return send(res, 403, { error: "The Sound desk only answers local requests" });
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname.replace(/^\/api\/sound-review/, "") || "/";
      const q = (k: string) => url.searchParams.get(k) ?? "";
      if (req.method === "GET" && path === "/state") {
        const f = readFile();
        return send(res, 200, { file: f, pending: pendingSlots(f).length, art: artRoot, mod: modRoot, exists: existsSync(artRoot), gpu: { claim: worker.claim() }, worker: { running: worker.running, working: worker.working } });
      }
      if (req.method === "GET" && path === "/unit") {
        const actor = q("actor").toLowerCase(), faction = q("faction");
        if (!/^[a-z0-9_.-]{1,64}$/.test(actor) || (faction && !/^[a-z0-9-]{1,32}$/.test(faction))) return send(res, 400, { error: "Bad actor" });
        const mod = loadMod(modRoot);
        const units = roster(cfg.webRoot);
        const users = usageIndex(mod.data, mod.audio, units);
        return send(res, 200, { actor, slots: unitSlots(mod.data, mod.audio, actor, faction || null, locator(mod, modRoot), lineLookup(mod), users) });
      }
      if (req.method === "GET" && path === "/faction") {
        const faction = q("faction");
        if (!(MODERN as readonly string[]).includes(faction)) return send(res, 400, { error: "The announcer desk covers the seven modern factions" });
        const mod = loadMod(modRoot);
        return send(res, 200, { faction, ...announcerSlots(mod.audio, faction, locator(mod, modRoot), lineLookup(mod)) });
      }
      if (req.method === "GET" && path === "/library") {
        const lib = libraryNow();
        const slim = (c: Indexed): DeskCandidate => ({ id: c.id, source: c.source, title: c.title, sub: c.sub, tags: c.tags, licence: c.licence, verdict: c.verdict, text: c.text ?? null, language: c.language ?? null, faction: c.faction ?? null, seconds: c.seconds ?? null, prompt: c.prompt ?? null });
        const ok = (c: Indexed) => c.verdict !== "refused";
        return send(res, 200, { bakeoff: lib.bakeoff.filter(ok).map(slim), project: lib.project.filter(ok).map(slim), cc0: lib.cc0.filter(ok).map(slim), sources: { bakeoff: cfg.bakeoffDir, cc0: cfg.sourcesDir } });
      }
      if (req.method === "GET" && path === "/takes") return send(res, 200, { takes: takesIndex(artRoot).map(({ meta, ...t }) => ({ ...t, meta: { engine: meta.engine, seed: meta.seed, voice: meta.voice, qa: meta.qa } })) });
      if (req.method === "GET" && (path === "/audio" || path === "/peaks")) {
        const c = lookup(q("c"));
        if (!c || !existsSync(c.listen)) return send(res, 404, { error: "No such sound" });
        const t0 = url.searchParams.has("t0") ? Math.max(0, Number(q("t0"))) : null, t1 = url.searchParams.has("t1") ? Number(q("t1")) : null;
        const trimmed = t0 !== null && t1 !== null && Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0;
        if (path === "/peaks") return send(res, 200, await peaksOf(ffmpeg, c.listen, trimmed ? t0 : null, trimmed ? t1 : null));
        res.setHeader("Cache-Control", "private, max-age=600");
        if (trimmed) { const wav = await ffmpegRun(ffmpeg, ["-i", c.listen, "-ss", String(t0), "-to", String(t1), "-ac", "1", "-c:a", "pcm_s16le", "-f", "wav", "-"]); res.statusCode = 200; res.setHeader("Content-Type", "audio/wav"); return res.end(wav); }
        const ext = extname(c.listen).toLowerCase();
        let bytes: Uint8Array = readFileSync(c.listen);
        if (ext === ".wav") { try { bytes = toPcmWav(bytes); } catch { bytes = await ffmpegRun(ffmpeg, ["-i", c.listen, "-c:a", "pcm_s16le", "-f", "wav", "-"]); } }
        res.statusCode = 200; res.setHeader("Content-Type", TYPES[ext] ?? "application/octet-stream");
        return res.end(bytes);
      }
      if (req.method === "GET" && path === "/shared") {
        const mod = loadMod(modRoot);
        const units = roster(cfg.webRoot);
        const locate = locator(mod, modRoot), lines = lineLookup(mod);
        type Use = { slot: string; kind: string; label: string; actor: string; faction: string; name: string; cameo: string | null; current: string[]; weapon: string | null };
        const families = new Map<string, { refs: Set<string>; uses: Use[] }>();
        for (const u of units) {
          for (const s of unitSlots(mod.data, mod.audio, u.id, u.faction, locate, lines)) {
            if (!["fire", "impact", "death"].includes(s.kind) || !s.current.length) continue;
            const fams = new Set(s.current.map(c => soundFamily(c.ref)));
            for (const fam of fams) {
              const e = families.get(fam) ?? { refs: new Set<string>(), uses: [] };
              for (const c of s.current) if (soundFamily(c.ref) === fam) e.refs.add(c.ref);
              e.uses.push({ slot: s.id, kind: s.kind, label: s.label, actor: u.id, faction: u.faction, name: u.name, cameo: u.cameo, current: s.current.map(c => c.path ?? c.ref), weapon: s.weapon });
              families.set(fam, e);
            }
          }
        }
        const rows = [...families.entries()].map(([family, e]) => {
          const refs = [...e.refs].sort();
          const first = refs.map(r => locate({ clip: r, file: r, origin: r.includes("/") ? "project" : "original" })).find(Boolean) ?? null;
          return { family, label: familyLabel(refs), refs, play: first ? `project:${first}` : null, units: new Set(e.uses.map(x => x.actor)).size, uses: e.uses };
        }).filter(r => r.units > 1).sort((a, b) => b.units - a.units || a.family.localeCompare(b.family));
        return send(res, 200, { families: rows });
      }
      if (req.method === "GET" && path === "/deaths") {
        const mod = loadMod(modRoot);
        const f = readFile();
        const locate = locator(mod, modRoot);
        const units = roster(cfg.webRoot).filter(u => u.category !== "infantry").flatMap(u => {
          const actor = mod.data.rules.get(u.id);
          const chain = actor ? deathChain(mod.data, u.id) : null;
          if (!actor || !chain) return [];
          const slot = unitSlots(mod.data, mod.audio, u.id, u.faction, locate, () => null).find(s => s.kind === "death");
          if (!slot) return [];
          const cls = u.category === "ship" ? "ship" : u.category === "structure" || u.category === "defense" ? "building" : u.category === "aircraft" ? "aircraft" : "vehicle";
          return [{ ...u, cls, slot: { slot: slot.id, label: `${u.name} · destroyed`, faction: u.faction, actor: u.id, kind: slot.kind, current: slot.current.map(c => c.path ?? c.ref) }, play: slot.current[0]?.id ?? null, guess: guessDeathSize(actor, u.category, chain.weapons), size: (f.deathSizes[u.id] ?? null) as DeathSize | null }];
        });
        return send(res, 200, { units });
      }
      if (req.method === "POST" && path === "/action") {
        const raw = await body(req, 256 * 1024) as Record<string, unknown>;
        // The page sends a candidate id; the desk fills in what the apply tool needs from its own index.
        let action = raw;
        if (raw?.type === "choose" && typeof raw.candidate === "string") {
          const c = chosen(raw.candidate);
          if (!c) return send(res, 404, { error: "No such candidate" });
          const trim = raw.trim as { start?: unknown; end?: unknown } | undefined;
          if (trim && typeof trim.start === "number" && typeof trim.end === "number" && trim.end > trim.start) (c as ChosenSound & { trim?: unknown }).trim = { start: Math.round(trim.start * 1000) / 1000, end: Math.round(trim.end * 1000) / 1000 };
          action = { ...raw, candidate: c };
        }
        const problem = validateSoundAction(action);
        if (problem) return send(res, 400, { error: problem });
        if (!existsSync(artRoot)) return send(res, 409, { error: `No RTSAI-Art workspace at ${artRoot}` });
        const next = applySoundAction(readFile(), action as unknown as SoundAction);
        writeFile(next);
        return send(res, 200, { file: next, pending: pendingSlots(next).length });
      }
      if (req.method === "POST" && path === "/regenerate") {
        const b = await body(req, 16 * 1024) as { slot?: unknown; kind?: unknown; faction?: unknown; factions?: unknown; clip?: unknown; path?: unknown; text?: unknown; engine?: unknown };
        const text = typeof b.text === "string" ? b.text.trim() : "";
        if (!text || text.length > 400) return send(res, 400, { error: "Write the line (up to 400 characters)" });
        if (b.kind === "eva") {
          const clip = typeof b.clip === "string" && /^[0-9A-Za-z_-]{1,16}$/.test(b.clip) ? b.clip : null;
          const factions = (Array.isArray(b.factions) ? b.factions : [b.faction]).filter((f): f is string => typeof f === "string" && (MODERN as readonly string[]).includes(f));
          if (!clip || !factions.length) return send(res, 400, { error: "Send the clip and the factions" });
          const takes = [];
          for (const faction of factions) {
            const slot = `eva:${faction}:${clip}`;
            const out = join(artRoot, "sounds", faction, slotSlug(slot), `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${randomBytes(2).toString("hex")}`, "clip.wav");
            mkdirSync(dirname(out), { recursive: true });
            const record = await worker.run({ kind: "eva", faction, slot, clip, text, out });
            writeTakeMeta(out, { ...record, slot, kind: "eva", faction, clip, text, created: new Date().toISOString() });
            takes.push({ faction, slot, id: `regen:${relative(artRoot, out).split(sep).join("/")}` });
          }
          return send(res, 200, { takes });
        }
        if (b.kind === "voice") {
          const p = typeof b.path === "string" && /^mods\/rtsai\/modern-factions\/audio\/[\w.-]+\.wav$/.test(b.path) ? b.path : null;
          const faction = typeof b.faction === "string" && /^[a-z0-9-]{1,32}$/.test(b.faction) ? b.faction : "shared";
          if (!p) return send(res, 400, { error: "Only the factions' own voice lines can be said again here" });
          const slot = `clip:${p}`;
          const engine = b.engine === "chatterbox" ? "chatterbox" : "asis";
          const out = join(artRoot, "sounds", faction, slotSlug(slot), `${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${randomBytes(2).toString("hex")}`, "clip.wav");
          mkdirSync(dirname(out), { recursive: true });
          const record = await worker.run({ kind: "voice", faction, slot, filename: p.split("/").pop(), text, engine, out });
          writeTakeMeta(out, { ...record, slot, kind: "voice", faction, text, created: new Date().toISOString() });
          return send(res, 200, { takes: [{ faction, slot, id: `regen:${relative(artRoot, out).split(sep).join("/")}` }] });
        }
        return send(res, 400, { error: "kind is eva or voice" });
      }
      return send(res, 404, { error: "Not found" });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      return send(res, status, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}

/** meta.json beside a regenerated take: engine, voice, text, seed and licence (the generator's own record). */
function writeTakeMeta(clip: string, meta: Record<string, unknown>) {
  const record = { ...meta, file: "clip.wav", sha256: existsSync(clip) ? sha256(clip) : null, generator: "RTSAI-Web tools/sound-desk-voice.py (OpenRA-AI voice_engines.py)" };
  writeFileSync(join(dirname(clip), "meta.json"), JSON.stringify(record, null, 2) + "\n");
}

export type { SlotFacts, DeskSlot };
