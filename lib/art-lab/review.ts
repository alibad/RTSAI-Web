/**
 * Review mode data model for the local RTSAI-Art workspace (the Art Forge's output). Client-safe and pure:
 * the dev-only middleware (review-server.ts) does the file I/O.
 *
 * Each unit has three slots: the battlefield model (voxel or pre-rendered sprite), the build icon (cameo) and
 * concept art (reference only, never shipped). A candidate proposes a replacement for one slot. Per slot the
 * owner picks one candidate to use in game, or keeps the current asset; individual candidates can be rejected.
 * Comments are instructions to the Forge for its next round. Nothing reaches the mod until a separate export.
 *
 * review.json (version 2), per actor, keeping any fields the Forge adds (forgeRecommendation, ...):
 *   { "version": 2, "status": "decided" | "in-review",
 *     "slots": { "model": { "chosen": "<candidate>" | "current" | null, "rejected": [...], "at": ISO | null }, "icon": {...}, "concept": {...} },
 *     "comments": [{ at, slot, candidate, view, text, author }], "log": [{ at, action, slot, candidate, author }] }
 * Version 1 entries ({ status, approved, comments }) are migrated when read.
 */
import type { RenderSpec } from "./spec";
import type { SpriteArt, Vec3 } from "./types";

export type SlotId = "model" | "icon" | "concept";
export const slotIds: SlotId[] = ["model", "icon", "concept"];
export const slotLabels: Record<SlotId, string> = { model: "Battlefield model", icon: "Build icon", concept: "Concept art" };
/** Slots that need a decision; concept art is reference only. */
export const decisionSlots: SlotId[] = ["model", "icon"];

export type SlotDecision = { chosen: string | null; rejected: string[]; at: string | null };
export type ReviewComment = { at: string; slot: SlotId | null; candidate: string | null; view: string | null; text: string; author: string };
export type ReviewLogEntry = { at: string; action: string; slot: SlotId | null; candidate: string | null; author: string };
export type ReviewEntry = {
  version: 2;
  status: "decided" | "in-review" | "draft";
  slots: Record<SlotId, SlotDecision>;
  comments: ReviewComment[];
  log: ReviewLogEntry[];
  [forgeField: string]: unknown;
};
export type ReviewFile = Record<string, ReviewEntry>;

export type CandidateKind = "cameo" | "concept" | "voxel" | "sprite";
export type CandidateMeta = {
  id: string;
  actor: string;
  createdAt: string;
  kind: CandidateKind | string;
  model?: string;
  prompt?: string;
  seed?: number | null;
  costUsd?: number;
  scores?: Record<string, unknown>;
  critique?: string;
  fixture?: boolean;
  previewNote?: string;
  fromConcept?: string;
  variantOf?: string;
  variantNote?: string;
  imageTo3d?: { service?: string; model?: string; costUsd?: number; license?: Record<string, string> };
  calls?: { route?: string; costUsd?: number }[];
  refusals?: unknown[];
  files: {
    concept?: string | null; cameo?: string | null; mesh?: string | null;
    vxl?: string[]; hva?: string[]; shp?: string[]; pal?: string | null; previews?: string[];
  };
};

/** A candidate as the review UI receives it: file names resolved to dev-route URLs. */
export type Candidate = CandidateMeta & { dir: string; urls: Record<string, string>; metaError?: string };

export type UnitWorkspace = {
  actor: string;
  spec: Record<string, unknown> | null;
  candidates: Candidate[];
  comparisons: string[];
};

export type ReviewState = {
  root: string;
  exists: boolean;
  units: UnitWorkspace[];
  review: ReviewFile;
  stock: { id: string; usedBy: string[]; parts: string[] }[];
  stockPalette: string | null;
  bibles: { faction: string; md: string | null; boards: string[] }[];
  errors: string[];
};

export type ReviewAction =
  | { type: "choose"; actor: string; slot: SlotId; candidate: string; view?: string | null; author?: string }
  | { type: "clear"; actor: string; slot: SlotId; author?: string }
  | { type: "reject"; actor: string; slot: SlotId; candidate: string; author?: string }
  | { type: "unreject"; actor: string; slot: SlotId; candidate: string; author?: string }
  | { type: "comment"; actor: string; slot?: SlotId | null; candidate?: string | null; view?: string | null; text: string; author?: string };

export function slotOfKind(kind: string): SlotId | null {
  if (kind === "cameo") return "icon";
  if (kind === "voxel" || kind === "sprite") return "model";
  if (kind === "concept") return "concept";
  return null;
}

const emptySlot = (): SlotDecision => ({ chosen: null, rejected: [], at: null });
export const emptyEntry = (): ReviewEntry => ({ version: 2, status: "in-review", slots: { model: emptySlot(), icon: emptySlot(), concept: emptySlot() }, comments: [], log: [] });

/**
 * Reads any review.json entry (version 1 or 2) as version 2. `kindOf` maps candidate ids to their kind so a
 * version-1 `approved` candidate lands in the right slot. Fields the Forge adds are kept.
 */
export function migrateEntry(raw: unknown, kindOf: (candidate: string) => string | undefined = () => undefined): ReviewEntry {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const entry: ReviewEntry = { ...source, ...emptyEntry() } as ReviewEntry;
  const slots = source.slots as Partial<Record<SlotId, Partial<SlotDecision>>> | undefined;
  for (const slot of slotIds) {
    const s = slots?.[slot];
    entry.slots[slot] = {
      chosen: typeof s?.chosen === "string" ? s.chosen : null,
      rejected: Array.isArray(s?.rejected) ? s!.rejected!.filter((x): x is string => typeof x === "string") : [],
      at: typeof s?.at === "string" ? s.at : null,
    };
  }
  const slotFor = (candidate: string | null | undefined) => (candidate ? slotOfKind(kindOf(candidate) ?? "") : null);
  entry.comments = (Array.isArray(source.comments) ? source.comments : []).map(c => {
    const comment = c as Partial<ReviewComment>;
    return {
      at: String(comment.at ?? ""), slot: (comment.slot as SlotId | undefined) ?? slotFor(comment.candidate), candidate: comment.candidate ?? null,
      view: comment.view ?? null, text: String(comment.text ?? ""), author: String(comment.author ?? "owner"),
    };
  });
  entry.log = Array.isArray(source.log) ? (source.log as ReviewLogEntry[]) : [];
  if (source.version !== 2) {
    // Version 1: `approved` was one candidate for the whole unit; "Approved"/"Rejected" notes were comments.
    const approved = typeof source.approved === "string" ? source.approved : null;
    const slot = slotFor(approved);
    if (approved && slot) entry.slots[slot] = { ...entry.slots[slot], chosen: approved, at: entry.comments.at(-1)?.at ?? null };
    for (const c of entry.comments) {
      const s = c.slot ?? slotFor(c.candidate);
      if (s && c.candidate && /^Rejected\b/.test(c.text) && !entry.slots[s].rejected.includes(c.candidate) && entry.slots[s].chosen !== c.candidate) entry.slots[s].rejected.push(c.candidate);
    }
    entry.comments = entry.comments.filter(c => !/^(Approved|Rejected)$/.test(c.text));
    delete (entry as Record<string, unknown>).approved;
  }
  entry.status = decisionSlots.every(s => entry.slots[s].chosen !== null) ? "decided" : source.status === "draft" ? "draft" : "in-review";
  return entry;
}

const ACTOR = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CANDIDATE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Validates an action from the browser; returns an error message or null. */
export function validateAction(action: unknown): string | null {
  if (!action || typeof action !== "object") return "Expected a JSON object";
  const a = action as Record<string, unknown>;
  if (typeof a.actor !== "string" || !ACTOR.test(a.actor)) return "Bad actor";
  const slotOk = (v: unknown) => typeof v === "string" && slotIds.includes(v as SlotId);
  switch (a.type) {
    case "choose": case "reject": case "unreject":
      if (!slotOk(a.slot)) return "Bad slot";
      if (typeof a.candidate !== "string" || !CANDIDATE.test(a.candidate)) return "Bad candidate";
      if (a.type !== "choose" && a.candidate === "current") return "Only candidates can be rejected";
      break;
    case "clear":
      if (!slotOk(a.slot)) return "Bad slot";
      break;
    case "comment":
      if (typeof a.text !== "string" || !a.text.trim()) return "Empty comment";
      if (a.slot !== undefined && a.slot !== null && !slotOk(a.slot)) return "Bad slot";
      if (a.candidate !== undefined && a.candidate !== null && (typeof a.candidate !== "string" || !CANDIDATE.test(a.candidate))) return "Bad candidate";
      break;
    default:
      return "Unknown action";
  }
  for (const key of ["text", "view", "author"]) if (a[key] !== undefined && a[key] !== null && (typeof a[key] !== "string" || (a[key] as string).length > 4000)) return `Bad ${key}`;
  return null;
}

/** Applies an action to one actor's entry (immutably). */
export function applyReviewAction(file: ReviewFile, action: ReviewAction, now = new Date().toISOString(), kindOf?: (candidate: string) => string | undefined): ReviewFile {
  const entry = migrateEntry(file[action.actor], kindOf);
  const author = action.author?.trim() || "owner";
  const slot = action.type === "comment" ? action.slot ?? null : action.slot;
  const candidate = "candidate" in action ? action.candidate ?? null : null;
  if (action.type !== "comment" && slot) {
    const s = { ...entry.slots[slot], rejected: [...entry.slots[slot].rejected] };
    if (action.type === "choose") { s.chosen = action.candidate; s.rejected = s.rejected.filter(r => r !== action.candidate); s.at = now; }
    if (action.type === "clear") { s.chosen = null; s.at = now; }
    if (action.type === "reject") { if (!s.rejected.includes(action.candidate)) s.rejected.push(action.candidate); if (s.chosen === action.candidate) s.chosen = null; s.at = now; }
    if (action.type === "unreject") { s.rejected = s.rejected.filter(r => r !== action.candidate); }
    entry.slots = { ...entry.slots, [slot]: s };
    entry.log = [...entry.log, { at: now, action: action.type, slot, candidate, author }];
  } else if (action.type === "comment") {
    entry.comments = [...entry.comments, { at: now, slot, candidate, view: action.view ?? null, text: action.text.trim(), author }];
  }
  entry.status = decisionSlots.every(s => entry.slots[s].chosen !== null) ? "decided" : "in-review";
  return { ...file, [action.actor]: entry };
}

export function hasViewableFiles(c: CandidateMeta) {
  const f = c.files ?? {};
  return Boolean(f.cameo || f.concept || f.vxl?.length || f.shp?.length || f.previews?.length);
}

export const candidatesForSlot = (unit: UnitWorkspace | undefined, slot: SlotId) => (unit?.candidates ?? []).filter(c => slotOfKind(c.kind) === slot && hasViewableFiles(c));

export type SlotState = "chosen" | "current" | "undecided" | "none";
/** Per-slot state for the unit list dots: a candidate chosen, keep current, undecided, or nothing to decide. */
export function slotState(unit: UnitWorkspace | undefined, entry: ReviewEntry | undefined, slot: SlotId): SlotState {
  const candidates = candidatesForSlot(unit, slot);
  const decision = entry?.slots[slot];
  if (decision?.chosen && decision.chosen !== "current") return "chosen";
  if (decision?.chosen === "current" && !candidates.some(c => (decision.at ?? "") < c.createdAt && !decision.rejected.includes(c.id))) return "current";
  if (!candidates.length) return "none";
  const open = candidates.filter(c => !decision?.rejected.includes(c.id));
  return open.length ? "undecided" : "current";
}

/** Needs your decision: a decision slot with open candidates and no choice, or candidates newer than the choice. */
export function needsDecision(unit: UnitWorkspace | undefined, entry: ReviewEntry | undefined) {
  return decisionSlots.some(slot => {
    const decision = entry?.slots[slot];
    const open = candidatesForSlot(unit, slot).filter(c => !decision?.rejected.includes(c.id));
    if (!open.length) return false;
    if (!decision?.chosen) return true;
    return open.some(c => c.createdAt > (decision.at ?? ""));
  });
}

/** Known spend for a candidate: its own calls plus the concept and the variant it was made from. "—" if unknown. */
export function candidateCost(candidate: Candidate, all: Candidate[], seen = new Set<string>()): { total: number; parts: string[] } {
  if (seen.has(candidate.id)) return { total: 0, parts: [] };
  seen.add(candidate.id);
  const own = Math.max(candidate.costUsd ?? 0, (candidate.calls ?? []).reduce((sum, c) => sum + (c.costUsd ?? 0), 0));
  const parts: string[] = [];
  let total = own;
  if (own > 0) parts.push(`${candidate.kind === "concept" ? "concept" : candidate.kind === "voxel" ? "3D reference image" : "image"} $${own.toFixed(3)}`);
  if (candidate.imageTo3d) {
    const cost = candidate.imageTo3d.costUsd ?? 0;
    total += cost;
    parts.push(cost > 0 ? `3D $${cost.toFixed(3)}` : `3D ${candidate.imageTo3d.model ?? "mesh"} (local GPU)`);
  }
  for (const ref of [candidate.variantOf, candidate.fromConcept]) {
    const parent = ref ? all.find(c => c.id === ref) : undefined;
    if (!parent) continue;
    const p = candidateCost(parent, all, seen);
    if (p.total > 0) { total += p.total; parts.push(`${parent.id} $${p.total.toFixed(3)}`); }
  }
  return { total, parts };
}

export const formatCost = (cost: { total: number }) => (cost.total > 0 ? `$${cost.total.toFixed(3)}` : "—");

/**
 * Maps a voxel candidate's files onto the actor's parts, reusing the current render settings (scale,
 * lighting, turret offset) so candidates are drawn exactly as the game would draw them in that slot.
 */
export function candidateRenderSpec(current: RenderSpec, candidate: Candidate): RenderSpec | null {
  if (!current.voxel || !candidate.files.vxl?.length) return null;
  const actor = current.id;
  const turret = current.voxel.parts.find(p => p.turretOffset);
  const body = current.voxel.parts.find(p => !p.turretOffset);
  const hasDropin = candidate.files.vxl.some(f => f.replace(/\\/g, "/").toLowerCase() === `dropin/${actor}tur.vxl`);
  const parts = candidate.files.vxl.flatMap(file => {
    const name = file.replace(/\\/g, "/");
    const hva = name.replace(/\.vxl$/i, ".hva");
    const vxlUrl = candidate.urls[name];
    const hvaUrl = candidate.urls[hva];
    if (!vxlUrl || !hvaUrl) return [];
    const base = name.split("/").pop()!.replace(/\.vxl$/i, "").toLowerCase();
    const dropin = name.toLowerCase().startsWith("dropin/");
    let label = name, turretOffset: Vec3 | null = null, defaultVisible = true;
    if (base === actor) label = "body";
    else if (base === `${actor}tur`) {
      label = dropin ? "turret (drop-in, for current rules)" : "turret";
      turretOffset = turret?.turretOffset ?? [0, 0, 0];
      defaultVisible = dropin || !hasDropin;
    } else if (base === `${actor}barl`) {
      label = "barrel (needs WithVoxelBarrel)";
      turretOffset = turret?.turretOffset ?? [0, 0, 0];
      defaultVisible = !hasDropin;
    } else defaultVisible = false;
    return [{
      id: `cand:${name}`, label, trait: label, vxl: vxlUrl, hva: hvaUrl, offset: body?.offset ?? [0, 0, 0] as Vec3, showShadow: true,
      requiresCondition: null, turretOffset, turretInitialFacing: null, tickRate: null, frames: 1, defaultVisible,
    }];
  });
  if (!parts.length) return null;
  const pal = candidate.files.pal ? candidate.urls[candidate.files.pal] : null;
  return {
    ...current,
    id: `${current.id}:${candidate.id}`,
    name: `${current.name} · ${candidate.id}`,
    palette: pal && current.palette ? { ...current.palette, name: candidate.files.pal!, url: pal } : current.palette,
    voxel: { ...current.voxel, parts },
  };
}

/** A sprite candidate drawn with the current unit's sequences, but its own SHP and palette. */
export function candidateSprite(spec: RenderSpec, sprite: SpriteArt | null, candidate: Candidate): { spec: RenderSpec; sprite: SpriteArt } | null {
  const shp = candidate.files.shp?.[0];
  if (!shp || !sprite || !spec.sprite) return null;
  const shpUrl = candidate.urls[shp.replace(/\\/g, "/")];
  const palUrl = candidate.files.pal ? candidate.urls[candidate.files.pal] : null;
  if (!shpUrl) return null;
  const swap = <T extends { file: string | null } | null>(s: T): T => (s && s.file && !s.file.endsWith(".png") ? { ...s, file: shpUrl } : s);
  return {
    spec: {
      ...spec, id: `${spec.id}:${candidate.id}`, name: `${spec.name} · ${candidate.id}`,
      palette: palUrl && spec.palette ? { ...spec.palette, name: candidate.files.pal!, url: palUrl } : spec.palette,
      sprite: { ...spec.sprite, stand: swap(spec.sprite.stand), turret: swap(spec.sprite.turret), overlay: swap(spec.sprite.overlay) },
    },
    sprite: { ...sprite, sequences: sprite.sequences.map(s => (s.file && !s.inherited && !s.file.endsWith(".png") ? { ...s, file: shpUrl } : s)) },
  };
}
