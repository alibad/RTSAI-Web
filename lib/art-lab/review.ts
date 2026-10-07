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
import { child, childValue, parseMiniYaml, type Yaml } from "./miniyaml";
import { drawnByDefault, type RenderSpec } from "./spec";
import type { SpriteArt, SpriteSequence, Vec3 } from "./types";
import { parseWDist } from "./resolve";
import type { ImagePlayerColor } from "./image-remap";
import type { MeasuredGroup } from "./measurements";
import type { PreviewAnimation } from "./chain";
import { spinKind } from "./action-labels";

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
  /** How an install agent put the candidate into the local preview copy; `rules` is the actor block as installed. */
  previewInstall?: { route?: string; candidate?: string; palette?: string; rules?: Record<string, unknown> };
  fromConcept?: string;
  variantOf?: string;
  variantNote?: string;
  /** Separate authored identification regions; absent means this image is a static draft. */
  playerColor?: ImagePlayerColor;
  imageTo3d?: { service?: string; model?: string; costUsd?: number; license?: Record<string, string> };
  /** Voxel candidates: where the Forge placed the turret pivot (a Turreted.Offset for current rules). */
  voxelize?: { turretOffsetWorld?: number[]; turretPlacement?: string; sections?: Record<string, unknown>; log?: { paint?: Record<string, { classShares?: Record<string, number> } | undefined>; rotors?: { name?: string }[] } };
  /** GLB route: the mesh candidate this native model was made from, and the pinned source bytes. */
  fromMesh?: string;
  sourceMeshSha256?: string;
  route?: string;
  createdBy?: string;
  /** The voxel light/scale this candidate was authored for: "stock" (RA2 defaults) or explicit values. */
  renderLight?: "stock" | { scale?: number; ambient?: number | number[]; diffuse?: number | number[] };
  /** HVA frame count per voxel file base name. */
  hvaFrames?: Record<string, number>;
  qualityGate?: { passes?: boolean; checksPassed?: number; checksTotal?: number; ownerArtApproved?: boolean };
  animation?: { evidence?: string; frames?: number; actions?: Record<string, unknown> };
  /** Format and layout checks the art tool ran on its own output (frame ranges, clipping, remap, ...). */
  verify?: { pass?: boolean; frames?: number; checks?: Record<string, boolean> };
  /** Sprite candidates: the SHP frame layout the Forge rendered. */
  sprite?: {
    shp?: string;
    facings?: number;
    classicFacingBodyOrientation?: boolean;
    quantizedFacings?: number;
    sequences?: Record<string, Partial<Pick<SpriteSequence, "start" | "facings" | "shadowStart" | "length" | "stride" | "reverseFacings" | "useClassicFacings" | "transpose" | "tick" | "offset" | "frames" | "reverses">> & { file?: string; usedBy?: string; spin?: string; spins?: string[] }>;
    turret?: { sequence?: string; name?: string; offset?: number[] };
    /** What a looping body or turret turns: "rotor", "propeller" or "radar". */
    spin?: string;
    palette?: { file?: string; transparent?: number[]; shadow?: number[]; remap?: number[] };
  };
  calls?: { route?: string; costUsd?: number }[];
  refusals?: unknown[];
  files: {
    concept?: string | null; cameo?: string | null; mesh?: string | null;
    vxl?: string[]; hva?: string[]; shp?: string[]; pal?: string | null; previews?: string[];
    /** Proposed OpenRA rules and sequences (MiniYaml) for using the candidate. */
    rules?: string | null;
  };
};

/** A candidate as the review UI receives it: file names resolved to dev-route URLs; `rulesText` is files.rules. */
export type Candidate = CandidateMeta & { dir: string; urls: Record<string, string>; metaError?: string; rulesText?: string | null; measured?: MeasuredGroup[];
  /** The state omits long prompts; their length is here and /api/art-review/prompt returns the text. */
  promptChars?: number };

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

const ACTOR = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
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
/** Suffix of a voxel part's trait when the preview copy's rules, not RTSAI-Mod main, make it play. */
export const PREVIEW_RULES = " (local preview)";

/**
 * A voxel candidate drawn in the current actor's frame. `play`: the animations the local preview copy's rules
 * give this actor (a drone's helicopter body, a spinning radar), so frames the candidate authored for them play
 * here too, at those rules' TickRate.
 */
export function candidateRenderSpec(current: RenderSpec, candidate: Candidate, play: PreviewAnimation[] | null = null): RenderSpec | null {
  if (!current.voxel || !candidate.files.vxl?.length) return null;
  const actor = current.id;
  const turret = current.voxel.parts.find(p => p.turretOffset);
  const body = current.voxel.parts.find(p => !p.turretOffset);
  // The candidate's own turret placement wins over the current rules (e.g. a longer hull moves the ring).
  const declared: Vec3 = declaredTurretOffset(candidate) ?? turret?.turretOffset ?? [0, 0, 0];
  const hasDropin = candidate.files.vxl.some(f => f.replace(/\\/g, "/").toLowerCase() === `dropin/${actor}tur.vxl`);
  // A candidate file plays the role of the current part with the same file name (a gunship's "tur" is its rotor).
  // The dev roster serves mod files under a content-hash prefix ("92827ae1d573-r2crane.vxl").
  const fileBase = (path: string) => path.split("?")[0].split("/").pop()!.replace(/\.vxl$/i, "").replace(/^[0-9a-f]{8,}-/i, "").toLowerCase();
  const currentPart = (base: string) => current.voxel!.parts.find(p => fileBase(p.vxl) === base) ?? null;
  // The preview rules' sequence files ("idle" is the actor's own voxel unless the overlay maps it elsewhere).
  const heliTick = current.voxel.parts.find(p => p.trait === "WithVoxelHelicopterBody")?.tickRate ?? 5;
  // What the body's HVA frames turn: the route's rotor sections ("pusher" is a propeller, "main rotor" a rotor).
  const sectionNames = [...(candidate.voxelize?.log?.rotors ?? []).map(r => r.name ?? ""), ...Object.keys(candidate.voxelize?.sections ?? {})];
  const sectionSpin = sectionNames.map(spinKind).find(k => k === "rotor") ?? sectionNames.map(spinKind).find(Boolean) ?? null;
  const played = (base: string): PreviewAnimation | null => {
    const named = play?.filter(a => (a.file ?? (a.sequence === "idle" ? actor : null)) === base) ?? [];
    const own = named.find(a => a.trait !== "sequence");
    if (own) return own;
    // A remapped sequence plays through the actor's own trait for it (e.g. WithVoxelHelicopterBody "rotor").
    for (const a of named) {
      const part = current.voxel!.parts.find(p => p.sequence === a.sequence && p.tickRate !== null && p.tickRate > 0);
      if (part) return { ...a, trait: part.trait, tickRate: part.tickRate, airborne: part.trait === "WithVoxelHelicopterBody" };
    }
    return null;
  };
  const parts = candidate.files.vxl.flatMap(file => {
    const name = file.replace(/\\/g, "/");
    const hva = name.replace(/\.vxl$/i, ".hva");
    const vxlUrl = candidate.urls[name];
    const hvaUrl = candidate.urls[hva];
    if (!vxlUrl || !hvaUrl) return [];
    const base = name.split("/").pop()!.replace(/\.vxl$/i, "").toLowerCase();
    const dropin = name.toLowerCase().startsWith("dropin/");
    let label = name, turretOffset: Vec3 | null = null, defaultVisible = true, trait = "";
    const match = dropin ? null : currentPart(base);
    const anim = dropin ? null : played(base);
    // Marked as the preview's doing only when the actor's own rules would not play these frames.
    if (base === actor) { label = "body"; if (anim && !match?.tickRate) trait = `${anim.trait}${PREVIEW_RULES}`; }
    else if (match && match.turretOffset === null && match.trait !== "WithVoxelTurret") { label = match.label; trait = match.trait; }
    else if (base === `${actor}tur`) {
      label = dropin ? "turret (drop-in, for current rules)" : "turret";
      turretOffset = [...declared] as Vec3;
      defaultVisible = dropin || !hasDropin;
    } else if (base === `${actor}barl`) {
      label = "barrel (needs WithVoxelBarrel)";
      turretOffset = [...declared] as Vec3;
      defaultVisible = !hasDropin;
    } else if (anim) {
      // A spinning model (WithAnimatedVoxelModel): on the body, or riding a turret exactly like the turret model.
      label = anim.sequence; trait = `${anim.trait}${anim.condition ? ` while ${anim.condition}` : ""}${PREVIEW_RULES}`;
      turretOffset = anim.turret ? [...declared] as Vec3 : null;
    } else defaultVisible = false;
    // HVA frames come from the candidate; they only play when the matching rules part has a TickRate.
    const frames = Math.max(1, Math.round(candidate.hvaFrames?.[base] ?? 1));
    return [{
      id: `cand:${name}`, label, trait: trait || label, vxl: vxlUrl, hva: hvaUrl, offset: body?.offset ?? [0, 0, 0] as Vec3, showShadow: true,
      requiresCondition: null, turretOffset, turretInitialFacing: null, frames, defaultVisible,
      tickRate: frames > 1 ? match?.tickRate ?? (anim ? anim.tickRate ?? (anim.trait.startsWith("WithVoxelHelicopterBody") ? heliTick : 2) : null) : null,
      spin: frames > 1 ? (anim && anim.trait.startsWith("WithAnimatedVoxelModel") ? spinKind(anim.sequence) ?? "radar" : base === actor ? sectionSpin ?? undefined : spinKind(label) ?? undefined) : undefined,
    }];
  });
  if (!parts.length) return null;
  const pal = candidate.files.pal ? candidate.urls[candidate.files.pal] : null;
  return {
    ...current,
    id: `${current.id}:${candidate.id}`,
    name: `${current.name} · ${candidate.id}`,
    palette: pal && current.palette ? { ...current.palette, name: candidate.files.pal!, url: pal } : current.palette,
    voxel: { ...current.voxel, ...candidateLight(candidate), parts },
  };
}

/** RA2's own voxel defaults (RenderVoxels), which "stock" candidates were authored for. */
export const STOCK_VOXEL_LIGHT = { scale: 11.7, ambient: [-0.5, -0.5, -0.5] as Vec3, diffuse: [1.4, 1.4, 1.4] as Vec3 };

/**
 * What a voxel candidate (or an archived voxel model) draws with once the release itself is a prerendered sprite:
 * the modern voxel template the units used before the promotion (RenderVoxels of the modern vehicle template), with
 * no parts of its own. The candidate brings its parts and palette; a light it declares wins (candidateLight).
 */
export function voxelBaseSpec(spec: RenderSpec): RenderSpec {
  if (spec.voxel) return spec;
  return {
    ...spec, render: "voxel", sprite: null,
    palette: { name: "voxel", url: "", remap: Array.from({ length: 16 }, (_, i) => 16 + i), transparent: [0], shadow: [] },
    voxel: {
      scale: 15.2, cameraPitch: 85, lightPitch: 150, lightYaw: 800, ambient: [-0.3, -0.3, -0.3], diffuse: [0.75, 0.75, 0.75],
      useClassicPerspectiveFudge: false, normals: "RedAlert2", altitude: spec.category === "aircraft" ? spec.airAltitude ?? null : null, parts: [],
    },
  };
}
/** The light and scale a voxel candidate declares; absent means it is drawn with the actor's current rules. */
export function candidateLight(candidate: Pick<Candidate, "renderLight">): Partial<{ scale: number; ambient: Vec3; diffuse: Vec3 }> {
  const light = candidate.renderLight;
  if (light === "stock") return { ...STOCK_VOXEL_LIGHT };
  if (!light || typeof light !== "object") return {};
  const v3 = (v: number | number[] | undefined): Vec3 | undefined => typeof v === "number" ? [v, v, v] : Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? [v[0], v[1], v[2]] : undefined;
  const out: Partial<{ scale: number; ambient: Vec3; diffuse: Vec3 }> = {};
  if (typeof light.scale === "number" && light.scale > 0) out.scale = light.scale;
  const ambient = v3(light.ambient), diffuse = v3(light.diffuse);
  if (ambient) out.ambient = ambient;
  if (diffuse) out.diffuse = diffuse;
  return out;
}

/** A sprite candidate drawn with the current unit's sequences, but its own SHP and palette. */
export function candidateSprite(spec: RenderSpec, sprite: SpriteArt | null, candidate: Candidate): { spec: RenderSpec; sprite: SpriteArt } | null {
  const shp = candidate.files.shp?.[0];
  if (!shp || !sprite || !spec.sprite) return null;
  // Building make/body/turret files require a declared mapping. Guessing that
  // every sequence lives in the first SHP can make a broken candidate look valid.
  const sourceFiles = new Set(sprite.sequences.filter(s => s.file && !s.inherited && !s.file.endsWith(".png")).map(s => s.file));
  if (candidate.files.shp!.length > 1 || sourceFiles.size > 1) return null;
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

const vec3 = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length === 3 && v.every(n => typeof n === "number") ? [v[0], v[1], v[2]] : null);
const parseVec = (text: string | null) => { const parts = (text ?? "").split(",").map(t => Number(t.trim())); return parts.length === 3 && parts.every(Number.isFinite) ? (parts as Vec3) : null; };
const parseInts = (text: string | null) => (text ?? "").split(",").map(t => t.trim()).filter(Boolean).map(Number).filter(Number.isFinite);

export type CandidateRules = {
  sequences: Record<string, Omit<SpriteSequence, "name" | "external" | "usedBy" | "inherited">>;
  classicFacingBodyOrientation: boolean | null;
  quantizedFacings: number | null;
  turretOffset: Vec3 | null;
  turretInitialFacing: number | null;
  palette: { transparent: number[]; shadow: number[]; remap: number[] } | null;
  traits: string[];
  removed: string[];
  /** Sequences the snippet's own traits name (sequence -> trait key), e.g. active -> WithIdleOverlay@dish. */
  traitSequences: Record<string, string>;
  /** WithIdleOverlay traits the snippet declares, with their Offset (a dish, a flag, a radar). */
  idleOverlays: { sequence: string; trait: string; offset: Vec3; requiresCondition: string | null }[];
  /** WithSpriteBarrel: its sequence and LocalOffset. */
  barrel: { sequence: string; localOffset: Vec3 } | null;
  /** RequiresCondition of the trait that plays each sequence (alternative bodies and turrets: landed, radar off). */
  traitConditions: Record<string, string>;
};

const SEQUENCE_TRAITS = new Set(["WithIdleOverlay", "WithAttackAnimation", "WithTurretAttackAnimation", "WithSpriteBody", "WithFacingSpriteBody", "WithMakeAnimation", "WithSpriteTurret", "WithSpriteBarrel"]);
/** Sequence a trait plays when the snippet does not name one (OpenRA defaults). */
const DEFAULT_SEQUENCE: Record<string, string> = { WithIdleOverlay: "idle-overlay", WithSpriteBarrel: "barrel" };

/**
 * Reads the OpenRA MiniYaml a candidate proposes (files.rules): the actor's sequences (blocks whose children
 * set Filename/Start/Facings), its traits (Turreted.Offset, ...) and its palette definitions under ^Palettes.
 */
export function parseCandidateRules(text: string, actor: string): CandidateRules {
  const nodes = parseMiniYaml(text, "openra-snippet.yaml");
  const out: CandidateRules = { sequences: {}, classicFacingBodyOrientation: null, quantizedFacings: null, turretOffset: null, turretInitialFacing: null, palette: null, traits: [], removed: [], traitSequences: {}, idleOverlays: [], barrel: null, traitConditions: {} };
  const isSequence = (n: Yaml) => n.nodes.some(c => ["Filename", "Start", "Facings", "Length", "ShadowStart", "Stride", "Frames", "UseClassicFacings", "Transpose"].includes(c.key));
  let playerPalette: string | null = null;
  for (const node of nodes.filter(n => n.key.toLowerCase() === actor.toLowerCase())) {
    const children = node.value.nodes;
    if (children.some(c => isSequence(c.value)) && children.every(c => isSequence(c.value) || !c.value.nodes.length || c.key === "Defaults" || c.key.startsWith("Inherits"))) {
      const defaults = child(node.value, "Defaults")?.value;
      for (const seq of children) {
        if (seq.key === "Defaults" || seq.key.startsWith("Inherits")) continue;
        // "-turret:" removes an inherited sequence; it is not a sequence to draw.
        if (seq.key.startsWith("-")) { out.removed.push(seq.key.slice(1)); continue; }
        const v = seq.value;
        const field = (key: string) => childValue(v, key) ?? childValue(defaults, key);
        const filename = field("Filename");
        const length = field("Length") === "*" ? "*" : Number(field("Length") ?? 1);
        const facings = Number(field("Facings") ?? 1);
        out.sequences[seq.key] = {
          file: filename ? filename.split("|").pop()!.split("/").pop()! : null,
          start: Number(field("Start") ?? 0), length, stride: Number(field("Stride") ?? (typeof length === "number" ? length : 0)),
          facings: Math.abs(facings), reverseFacings: facings < 0, useClassicFacings: /^true$/i.test(field("UseClassicFacings") ?? ""),
          transpose: /^true$/i.test(field("Transpose") ?? ""), reverses: /^true$/i.test(field("Reverses") ?? ""), frames: field("Frames") ? parseInts(field("Frames")) : null,
          zOffset: parseWDist(field("ZOffset")), shadowStart: Number(field("ShadowStart") ?? -1),
          offset: parseVec(field("Offset")) ?? [0, 0, 0], tick: Number(field("Tick") ?? 40),
        };
      }
    } else {
      for (const trait of children) (trait.key.startsWith("-") ? out.removed : out.traits).push(trait.key.replace(/^-/, ""));
      // Which sequence each art trait plays. Only an explicit Sequence counts, except the defaults above.
      for (const trait of children) {
        const kind = trait.key.split("@")[0];
        // A layer drawn from another image (damage smoke, fire) is not this actor's art.
        if (trait.key.startsWith("-") || !SEQUENCE_TRAITS.has(kind) || childValue(trait.value, "Image")) continue;
        const sequence = childValue(trait.value, "Sequence") ?? DEFAULT_SEQUENCE[kind] ?? null;
        if (!sequence) continue;
        const condition = childValue(trait.value, "RequiresCondition");
        // An overlay that is off until a condition (damage states) is not part of the idle picture.
        if (kind === "WithIdleOverlay" && condition && !drawnByDefault(condition)) continue;
        out.traitSequences[sequence] = trait.key;
        if (condition) out.traitConditions[sequence] = condition;
        if (kind === "WithSpriteBarrel") out.barrel = { sequence, localOffset: parseVec(childValue(trait.value, "LocalOffset")) ?? [0, 0, 0] };
        if (kind === "WithIdleOverlay") out.idleOverlays.push({ sequence, trait: trait.key, offset: parseVec(childValue(trait.value, "Offset")) ?? [0, 0, 0], requiresCondition: childValue(trait.value, "RequiresCondition") });
      }
      const turreted = child(node.value, "Turreted")?.value;
      out.turretOffset = parseVec(childValue(turreted, "Offset")) ?? out.turretOffset;
      const initial = childValue(turreted, "InitialFacing");
      if (initial !== null) out.turretInitialFacing = Number(initial);
      playerPalette = childValue(child(node.value, "RenderSprites")?.value, "PlayerPalette") ?? playerPalette;
      const orientation = child(node.value, "ClassicFacingBodyOrientation")?.value ?? child(node.value, "BodyOrientation")?.value;
      if (child(node.value, "ClassicFacingBodyOrientation")) out.classicFacingBodyOrientation = true;
      if (child(node.value, "-ClassicFacingBodyOrientation")) out.classicFacingBodyOrientation = false;
      if (childValue(orientation, "QuantizedFacings") !== null) out.quantizedFacings = Number(childValue(orientation, "QuantizedFacings"));
    }
  }
  const palettes = nodes.find(n => n.key === "^Palettes")?.value;
  if (palettes) {
    const players = palettes.nodes.filter(n => n.key.startsWith("PlayerColorPalette"));
    const player = players.find(n => childValue(n.value, "BaseName") === playerPalette) ?? players[0];
    const baseName = player ? childValue(player.value, "BasePalette") : null;
    const file = palettes.nodes.find(n => n.key.startsWith("PaletteFromFile") && (!baseName || childValue(n.value, "Name") === baseName));
    if (file || player) {
      out.palette = {
        transparent: file && childValue(file.value, "TransparentIndex") ? parseInts(childValue(file.value, "TransparentIndex")) : [0],
        shadow: file ? parseInts(childValue(file.value, "ShadowIndex")) : [],
        remap: player ? parseInts(childValue(player.value, "RemapIndex")) : [],
      };
    }
  }
  return out;
}

/** The turret offset a candidate declares: its rules snippet's Turreted.Offset, else the Forge's recorded placement. */
export function declaredTurretOffset(candidate: Candidate): Vec3 | null {
  const rules = candidate.rulesText ? parseCandidateRules(candidate.rulesText, candidate.actor) : null;
  return rules?.turretOffset ?? vec3(candidate.voxelize?.turretOffsetWorld) ?? vec3(candidate.sprite?.turret?.offset);
}

/**
 * The trait that plays a candidate sequence when the candidate does not say: the current actor's role for the
 * same sequence name, else the OpenRA naming conventions (damaged-/critical- variants keep their base role).
 */
export function sequenceRole(name: string, category: string, traits: string[], currentSprite?: SpriteArt | null, declared?: Record<string, string>): string[] {
  const base = name.replace(/^(damaged|critical)-/, "");
  const damaged = base !== name ? " (damaged)" : "";
  // The candidate's own rules first: a new dish overlay or attack animation is what the candidate says it is.
  if (declared?.[name]) return [declared[name]];
  if (declared?.[base]) return [`${declared[base]}${damaged}`];
  const known = currentSprite?.sequences.find(s => s.name === name)?.usedBy;
  if (known?.length) return known;
  const baseRole = currentSprite?.sequences.find(s => s.name === base)?.usedBy[0]?.replace(/ \(damaged\)$/, "");
  if (base === "turret") return [`WithSpriteTurret${damaged}`];
  if (base === "make") return ["WithMakeAnimation (build-up)"];
  if (base === "fire" && traits.includes("WithTurretAttackAnimation")) return [`WithTurretAttackAnimation${damaged}`];
  if (baseRole) return [`${baseRole}${damaged}`];
  if (base === "idle" || base === "stand") return [`${category === "defense" || category === "structure" ? "WithSpriteBody" : "WithFacingSpriteBody"}${damaged}`];
  // A building's body is its idle sequence; an undeclared extra sequence never replaces it.
  if (category === "defense" || category === "structure") return [];
  return ["WithFacingSpriteBody"];
}

/**
 * What a sprite candidate's looping body or turret turns, for naming its action: the candidate's own hint
 * (meta.sprite.spin or a sequence's spin), else what turns on the voxel model it replaces (its rotor or radar).
 */
function spinOf(candidate: Candidate, current: RenderSpec): string | null {
  // The route names the spinning sections per sequence ("spins": ["pusher"]), or the whole sprite ("spin").
  const named = [candidate.sprite?.spin, ...Object.values(candidate.sprite?.sequences ?? {}).flatMap(s => [s.spin, ...(s.spins ?? [])])].filter((n): n is string => Boolean(n));
  const own = named.map(spinKind).find(k => k === "radar") ?? named.map(spinKind).find(k => k === "rotor") ?? named.map(spinKind).find(Boolean);
  if (own) return own;
  const parts = current.voxel?.parts.filter(p => p.tickRate !== null && p.tickRate > 0) ?? [];
  return parts.map(p => p.spin ?? spinKind(p.label) ?? (p.trait === "WithVoxelHelicopterBody" ? "rotor" : null)).find(Boolean) ?? null;
}

/**
 * A pre-rendered vehicle sprite candidate (body + turret, with shadow frames) for a unit that is a voxel model
 * today. The frame layout comes from the candidate's rules snippet, else from meta.sprite; it is never guessed.
 */
/** MiniYaml for a rules block given as JSON (meta.previewInstall.rules): trait -> fields, null for a bare key. */
function rulesYaml(actor: string, block: Record<string, unknown>): string {
  const lines = [`${actor}:`];
  const walk = (node: Record<string, unknown>, depth: number) => {
    for (const [key, value] of Object.entries(node)) {
      const pad = "\t".repeat(depth);
      if (value && typeof value === "object" && !Array.isArray(value)) { lines.push(`${pad}${key}:`); walk(value as Record<string, unknown>, depth + 1); }
      else lines.push(`${pad}${key}:${value === null || value === undefined ? "" : ` ${Array.isArray(value) ? value.join(", ") : String(value)}`}`);
    }
  };
  walk(block, 1);
  return lines.join("\n");
}

/**
 * The candidate's rules: its proposed snippet (sequences, palettes, traits), with the actor block replaced by the one
 * an install agent actually put into the local preview copy when there is one (meta.previewInstall.rules).
 */
export function candidateRules(candidate: Candidate): CandidateRules | null {
  const proposed = candidate.rulesText ? parseCandidateRules(candidate.rulesText, candidate.actor) : null;
  const block = candidate.previewInstall?.rules;
  if (!block || typeof block !== "object") return proposed;
  const installed = parseCandidateRules(rulesYaml(candidate.actor, block), candidate.actor);
  return {
    ...(proposed ?? installed), turretOffset: installed.turretOffset, turretInitialFacing: installed.turretInitialFacing ?? proposed?.turretInitialFacing ?? null,
    quantizedFacings: installed.quantizedFacings ?? proposed?.quantizedFacings ?? null, classicFacingBodyOrientation: installed.classicFacingBodyOrientation ?? proposed?.classicFacingBodyOrientation ?? null,
    traits: installed.traits, removed: [...installed.removed, ...(proposed?.removed.filter(r => !installed.traits.includes(r) && !installed.removed.includes(r)) ?? [])],
    traitSequences: installed.traitSequences, idleOverlays: installed.idleOverlays, barrel: installed.barrel, traitConditions: installed.traitConditions,
  };
}

export function candidateVehicleSprite(current: RenderSpec, candidate: Candidate, currentSprite?: SpriteArt | null): { spec: RenderSpec; sprite: SpriteArt; layoutSource: string } | null {
  if (candidate.kind !== "sprite" || !candidate.files.shp?.length) return null;
  const rules = candidateRules(candidate);
  const metaSeqs = candidate.sprite?.sequences ?? {};
  const fromRules = Boolean(rules && Object.keys(rules.sequences).length > 0);
  const names = fromRules ? Object.keys(rules!.sequences) : Object.keys(metaSeqs);
  if (!names.length) return null;
  const shpUrl = (file: string | null) => {
    const name = (file ?? candidate.sprite?.shp ?? candidate.files.shp![0]).replace(/\\/g, "/");
    return candidate.urls[name] ?? candidate.urls[candidate.files.shp!.find(f => f.endsWith(name)) ?? ""] ?? null;
  };
  const sequences: SpriteSequence[] = [];
  for (const name of names) {
    const r = fromRules ? rules!.sequences[name] : null;
    const m = metaSeqs[name];
    const file = shpUrl(r?.file ?? m?.file ?? null);
    if (!file) continue;
    const length = r?.length ?? m?.length ?? 1;
    const usedBy = name === "turret" || /WithSpriteTurret/.test(m?.usedBy??"") ? ["WithSpriteTurret"] : m?.usedBy ? [m.usedBy] : sequenceRole(name, current.category, rules?.traits ?? [], currentSprite, rules?.traitSequences);
    sequences.push({
      name, file, external: null, start: r?.start ?? m?.start ?? 0, length, stride: r?.stride ?? m?.stride ?? (typeof length === "number" ? length : 0), facings: r?.facings ?? m?.facings ?? 1,
      reverseFacings: r?.reverseFacings ?? m?.reverseFacings ?? false, useClassicFacings: r?.useClassicFacings ?? m?.useClassicFacings ?? false,
      transpose: r?.transpose ?? m?.transpose ?? false, tick: r?.tick ?? m?.tick ?? 40, zOffset: r?.zOffset ?? 0, shadowStart: r?.shadowStart ?? m?.shadowStart ?? -1,
      offset: r?.offset ?? m?.offset ?? [0, 0, 0], frames: r?.frames ?? m?.frames ?? null, reverses: r?.reverses ?? m?.reverses ?? false, usedBy, inherited: false,
    });
  }
  const body = sequences.find(s => s.name === "idle" || s.name === "stand") ?? sequences.find(s => s.usedBy.includes("WithFacingSpriteBody"));
  if (!body) return null;
  // The main turret sprite; other WithSpriteTurret@x sprites (a radar dish) ride it and loop.
  const turretSeq = sequences.find(s => s.usedBy.includes("WithSpriteTurret")) ?? sequences.find(s => s.name === "turret" && s.usedBy.some(u => u.startsWith("WithSpriteTurret"))) ?? null;
  // Riders are drawn with the turret; a conditional one (a radar's "turret-still" while not deployed) swaps with
  // the main turret instead, so it is offered as its own action and never drawn over it.
  const turretSprites = sequences.filter(s => s !== turretSeq && !s.name.startsWith("damaged-") && s.usedBy.some(u => u.startsWith("WithSpriteTurret")));
  const conditional = (s: SpriteSequence) => Boolean(rules?.traitConditions[s.name]);
  const riders = turretSprites.filter(s => !conditional(s)), variants = turretSprites.filter(conditional);
  const barrel = rules?.barrel && sequences.some(s => s.name === rules.barrel!.sequence) ? rules.barrel : null;
  const pal = candidate.files.pal ? candidate.urls[candidate.files.pal] : null;
  const metaPal = candidate.sprite?.palette;
  const palette = pal ? {
    name: candidate.files.pal!, url: pal,
    remap: rules?.palette?.remap ?? metaPal?.remap ?? current.palette?.remap ?? [],
    transparent: rules?.palette?.transparent ?? metaPal?.transparent ?? [0],
    shadow: rules?.palette?.shadow ?? metaPal?.shadow ?? [],
  } : current.palette;
  const turretOffset = rules?.turretOffset ?? vec3(candidate.sprite?.turret?.offset) ?? currentSprite?.turret?.offset ?? [0, 0, 0];
  const sprite: SpriteArt = {
    image: current.id, palette: palette?.name ?? "", shp: null, sequences, quantizedFacings: rules?.quantizedFacings ?? candidate.sprite?.quantizedFacings ?? currentSprite?.quantizedFacings ?? body.facings,
    classicFacingBodyOrientation: rules?.classicFacingBodyOrientation ?? candidate.sprite?.classicFacingBodyOrientation ?? currentSprite?.classicFacingBodyOrientation ?? false,
    turret: turretSeq ? { sequence: turretSeq.name, name: candidate.sprite?.turret?.name ?? "primary", offset: turretOffset, initialFacing: rules?.turretInitialFacing ?? currentSprite?.turret?.initialFacing ?? 0 } : null,
    ...(turretSeq && riders.length ? { turretSprites: riders.map(s => s.name) } : {}),
    ...(turretSeq && variants.length ? { turretVariants: variants.map(s => s.name) } : {}),
    ...(spinOf(candidate, current) ? { spin: spinOf(candidate, current)! } : {}),
    ...(turretSeq && barrel ? { barrel } : {}),
  };
  // Overlays the candidate's rules declare keep their own Offset; overlays known only by role keep the old layout.
  const declaredOverlays = (rules?.idleOverlays ?? []).filter(o => sequences.some(s => s.name === o.sequence));
  if (declaredOverlays.length) sprite.overlays = [
    ...declaredOverlays.map(o => ({ ...o, mode: "loop" as const })),
    ...sequences.filter(s => s.usedBy.some(u => u.startsWith("WithIdleOverlay")) && !s.name.startsWith("damaged-") && !declaredOverlays.some(o => o.sequence === s.name))
      .map(s => ({ sequence: s.name, trait: "WithIdleOverlay", offset: [0, 0, 0] as Vec3, requiresCondition: null, mode: "loop" as const })),
  ];
  return {
    spec: {
      ...current, id: `${current.id}:${candidate.id}`, name: `${current.name} · ${candidate.id}`, render: "sprite", palette, voxel: null,
      airAltitude: current.voxel?.altitude ?? current.airAltitude ?? null,
      sprite: { stand: body, turret: turretSeq, turretInitialFacing: sprite.turret?.initialFacing ?? null, overlay: null },
    },
    sprite,
    layoutSource: fromRules ? candidate.files.rules ?? "rules snippet" : "meta.sprite",
  };
}
