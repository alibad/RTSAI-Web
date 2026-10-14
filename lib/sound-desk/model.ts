/**
 * The Sound desk's decision model (admin only, client-safe and pure): what a slot is, what can replace it, and the
 * decision file the dev API writes to RTSAI-Art/sound-review.json. RTSAI-Mod's tools/apply-sound-decisions.py reads
 * the same file and applies the chosen sounds to the mod on a branch.
 *
 * A slot is one place in the rules where a sound plays:
 *   clip:<file>                  a voice line (a clip in one or more voice sets; modern factions share their sets)
 *   fire:<actor>:<Weapon>        a weapon's Report, as one unit fires it
 *   impact:<actor>:<Weapon>      the weapon's warheads' ImpactSounds
 *   death:<actor>                the unit's death explosion (FireWarheadsOnDeath's warheads)
 *   trait:<actor>:<Trait>:<Key>  deploy, undeploy, transform, take-off, landing, reload or ambient sounds
 *   eva:<faction>:<clip>         one announcer clip of one faction (eva/<faction>/<clip>.wav)
 *   notify:<Notification>        which announcer clip a Speech notification plays (shared by every faction)
 *
 * sound-review.json (version 1), mirroring review.json's per-slot decisions:
 *   { "version": 1,
 *     "slots": { "<slot>": { "label", "faction", "actor", "kind", "current": [files],
 *                            "chosen": <ChosenSound> | "current" | null, "rejected": [candidate ids], "at": ISO | null,
 *                            "notes": [{ at, text, author }], "log": [{ at, action, candidate, author }] } },
 *     "deathSizes": { "<actor>": "small" | "medium" | "large" } }
 */

export type SlotKind = "voice" | "fire" | "impact" | "death" | "deploy" | "movement" | "reload" | "announcer" | "notify";
export type CandidateSource = "bakeoff" | "project" | "cc0" | "regen" | "eva-clip";
export type LicenceVerdict = "ok" | "conditional" | "refused";

/** What a decision stores about the chosen sound: enough for the apply tool to copy it and record its provenance. */
export type ChosenSound = {
  id: string;
  source: CandidateSource;
  title: string;
  /** Absolute path (bake-off, CC0), a path under RTSAI-Art (regen), a mod path (project), or a clip id (eva-clip). */
  path: string;
  sha256: string | null;
  licence: string;
  recipe?: unknown;
  prompt?: string | null;
  text?: string | null;
  language?: string | null;
  engine?: string | null;
  voice?: string | null;
  seed?: number | string | null;
  /** Where the sound came from on the web (CC0 sources). */
  origin?: string | null;
};

export type SoundNote = { at: string; text: string; author: string };
export type SoundLogEntry = { at: string; action: string; candidate: string | null; author: string };
export type SoundSlotEntry = {
  label: string;
  faction: string | null;
  actor: string | null;
  kind: SlotKind;
  /** The files the slot plays today (mod paths, or bare stand-in names), for the record. */
  current: string[];
  chosen: ChosenSound | "current" | null;
  rejected: string[];
  at: string | null;
  notes: SoundNote[];
  log: SoundLogEntry[];
};
export type DeathSize = "small" | "medium" | "large";
export type SoundReviewFile = { version: 1; slots: Record<string, SoundSlotEntry>; deathSizes: Record<string, DeathSize> };

export const emptySoundReview = (): SoundReviewFile => ({ version: 1, slots: {}, deathSizes: {} });

/** The slot facts a decision records alongside it (the UI sends them with each action). */
export type SlotFacts = { slot: string; label: string; faction: string | null; actor: string | null; kind: SlotKind; current: string[] };

export type SoundAction =
  | { type: "choose"; slots: SlotFacts[]; candidate: ChosenSound; author?: string }
  | { type: "keep"; slots: SlotFacts[]; author?: string }
  | { type: "clear"; slots: SlotFacts[]; author?: string }
  | { type: "reject"; slots: SlotFacts[]; candidate: string; author?: string }
  | { type: "unreject"; slots: SlotFacts[]; candidate: string; author?: string }
  | { type: "note"; slots: SlotFacts[]; text: string; author?: string }
  | { type: "size"; actors: string[]; size: DeathSize | null; author?: string };

export const SLOT_ID = /^(clip|fire|impact|death|trait|eva|notify):[A-Za-z0-9_.:/@|+-]{1,200}$/;
const CANDIDATE_ID = /^(bakeoff|project|cc0|regen|eva-clip):[^\0\r\n]{1,400}$/;
const KINDS: SlotKind[] = ["voice", "fire", "impact", "death", "deploy", "movement", "reload", "announcer", "notify"];
const SOURCES: CandidateSource[] = ["bakeoff", "project", "cc0", "regen", "eva-clip"];
const SIZES: DeathSize[] = ["small", "medium", "large"];

function slotProblem(s: unknown): string | null {
  const f = s as Partial<SlotFacts> | null;
  if (!f || typeof f !== "object") return "Each slot must be an object";
  if (typeof f.slot !== "string" || !SLOT_ID.test(f.slot)) return `Bad slot id ${String(f.slot)}`;
  if (typeof f.label !== "string" || f.label.length > 200) return "Each slot needs a label";
  if (!KINDS.includes(f.kind as SlotKind)) return `Bad slot kind ${String(f.kind)}`;
  if (f.faction !== null && (typeof f.faction !== "string" || !/^[a-z0-9-]{1,32}$/.test(f.faction))) return "Bad faction";
  if (f.actor !== null && (typeof f.actor !== "string" || !/^[a-z0-9_.-]{1,64}$/.test(f.actor))) return "Bad actor";
  if (!Array.isArray(f.current) || f.current.length > 32 || f.current.some(c => typeof c !== "string" || c.length > 300)) return "Bad current files";
  return null;
}

/** Null when the action is well formed, else what is wrong with it. */
export function validateSoundAction(action: unknown): string | null {
  const a = action as Partial<SoundAction> & Record<string, unknown> | null;
  if (!a || typeof a !== "object" || typeof a.type !== "string") return "Send an action";
  if (a.author !== undefined && (typeof a.author !== "string" || a.author.length > 64)) return "Bad author";
  if (a.type === "size") {
    if (!Array.isArray(a.actors) || !a.actors.length || a.actors.length > 400 || a.actors.some(x => typeof x !== "string" || !/^[a-z0-9_.-]{1,64}$/.test(x))) return "Bad actors";
    if (a.size !== null && !SIZES.includes(a.size as DeathSize)) return "Bad size";
    return null;
  }
  if (!["choose", "keep", "clear", "reject", "unreject", "note"].includes(a.type)) return `Unknown action ${a.type}`;
  if (!Array.isArray(a.slots) || !a.slots.length || a.slots.length > 400) return "Send one or more slots";
  for (const s of a.slots) { const p = slotProblem(s); if (p) return p; }
  if (a.type === "choose") {
    const c = a.candidate as Partial<ChosenSound> | undefined;
    if (!c || typeof c !== "object" || typeof c.id !== "string" || !CANDIDATE_ID.test(c.id)) return "Bad candidate";
    if (!SOURCES.includes(c.source as CandidateSource)) return "Bad candidate source";
    if (typeof c.path !== "string" || !c.path || c.path.length > 500) return "Bad candidate path";
    if (typeof c.licence !== "string" || !c.licence) return "A candidate needs its licence";
    if (licenceVerdict(c.licence) === "refused") return `Refused: ${c.licence.slice(0, 120)} is not redistributable in the game`;
    if (JSON.stringify(c).length > 24 * 1024) return "Candidate too large";
  }
  if ((a.type === "reject" || a.type === "unreject") && (typeof a.candidate !== "string" || !CANDIDATE_ID.test(a.candidate))) return "Bad candidate";
  if (a.type === "note" && (typeof a.text !== "string" || !a.text.trim() || a.text.length > 4000)) return "Write a note";
  return null;
}

const emptyEntry = (f: SlotFacts): SoundSlotEntry => ({ label: f.label, faction: f.faction, actor: f.actor, kind: f.kind, current: f.current, chosen: null, rejected: [], at: null, notes: [], log: [] });

/** The file after one action (pure: returns a new object). */
export function applySoundAction(file: SoundReviewFile, action: SoundAction, now = new Date().toISOString()): SoundReviewFile {
  const author = action.author?.trim() || "owner";
  if (action.type === "size") {
    const deathSizes = { ...file.deathSizes };
    for (const actor of action.actors) { if (action.size) deathSizes[actor] = action.size; else delete deathSizes[actor]; }
    return { ...file, deathSizes };
  }
  const slots = { ...file.slots };
  for (const facts of action.slots) {
    const prev = slots[facts.slot] ?? emptyEntry(facts);
    // The slot's facts follow the rules as they are now (labels and current files can change between sessions).
    const e: SoundSlotEntry = { ...prev, label: facts.label, faction: facts.faction, actor: facts.actor, kind: facts.kind, current: facts.current, rejected: [...prev.rejected], notes: [...prev.notes], log: [...prev.log] };
    let candidate: string | null = null;
    if (action.type === "choose") { e.chosen = action.candidate; e.at = now; e.rejected = e.rejected.filter(r => r !== action.candidate.id); candidate = action.candidate.id; }
    else if (action.type === "keep") { e.chosen = "current"; e.at = now; candidate = "current"; }
    else if (action.type === "clear") { e.chosen = null; e.at = null; }
    else if (action.type === "reject") {
      candidate = action.candidate;
      if (!e.rejected.includes(action.candidate)) e.rejected.push(action.candidate);
      if (e.chosen && e.chosen !== "current" && e.chosen.id === action.candidate) { e.chosen = null; e.at = null; }
    } else if (action.type === "unreject") { candidate = action.candidate; e.rejected = e.rejected.filter(r => r !== action.candidate); }
    else if (action.type === "note") e.notes.push({ at: now, text: action.text.trim(), author });
    e.log.push({ at: now, action: action.type, candidate, author });
    slots[facts.slot] = e;
  }
  return { ...file, slots };
}

/** A decision file as read from disk, tolerant of a missing or hand-edited file. */
export function readSoundReview(raw: unknown): SoundReviewFile {
  const r = raw as Partial<SoundReviewFile> | null;
  if (!r || typeof r !== "object") return emptySoundReview();
  return { version: 1, slots: r.slots && typeof r.slots === "object" ? r.slots : {}, deathSizes: r.deathSizes && typeof r.deathSizes === "object" ? r.deathSizes : {} };
}

export type SlotStatus = "use" | "keep" | "open";
/** What the slot's decision says: a replacement to use, keep what plays now, or still open. */
export function slotStatus(entry: SoundSlotEntry | undefined): SlotStatus {
  if (!entry?.chosen) return "open";
  return entry.chosen === "current" ? "keep" : "use";
}
/** Replacements chosen and not yet applied to the mod: every slot whose decision is a new sound. */
export const pendingSlots = (file: SoundReviewFile) => Object.entries(file.slots).filter(([, e]) => slotStatus(e) === "use").map(([id]) => id);

/**
 * Whether a licence lets the sound ship inside the GPL game and the public repositories.
 *  refused     EA / Westwood originals, listening references, non-commercial or research-only terms, pilots marked
 *              not for shipping, or no licence at all
 *  conditional usable with a condition the apply tool records (revenue cap, an AI-voice disclosure, attribution)
 *  ok          CC0, MIT, Apache-2.0, GPL-3.0 project output
 */
export function licenceVerdict(licence: string | null | undefined, reference = false): LicenceVerdict {
  const l = (licence ?? "").trim();
  if (reference || !l) return "refused";
  if (/\bEA\b|Electronic Arts|Westwood|Red Alert 2|LISTENING REFERENCE|never ship|not for shipping|non-?commercial|\bNC\b|BY-NC|research[- ]only|CPML/i.test(l)) return "refused";
  if (/Stability AI Community|openai output|gemini output|CC[- ]BY(?!-NC)|Attribution/i.test(l)) return "conditional";
  if (/CC0|public domain|\bMIT\b|Apache-2\.0|GPL-3\.0|project output|project code|RTSAI-Mod project/i.test(l)) return "ok";
  return "refused";
}

/** A short licence label for chips. */
export function licenceShort(licence: string): string {
  if (/CC0/i.test(licence) && /Stability/i.test(licence)) return "CC0 + Stability";
  if (/CC0/i.test(licence)) return "CC0";
  if (/Stability AI Community/i.test(licence)) return "Stability";
  if (/\bMIT\b/.test(licence)) return "MIT";
  if (/Apache-2\.0/.test(licence)) return "Apache-2.0";
  if (/GPL-3\.0|project/i.test(licence)) return "Project";
  if (/openai/i.test(licence)) return "OpenAI";
  if (/gemini/i.test(licence)) return "Gemini";
  return licence.split(/[ (;]/)[0].slice(0, 16);
}

/** A slot id as a folder name (RTSAI-Art/sounds/<faction>/<slug>/). */
export const slotSlug = (slot: string) => slot.replace(/^clip:mods\/rtsai\//, "clip:").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
