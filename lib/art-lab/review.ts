/**
 * Review mode data model for the local RTSAI-Art workspace (the Art Forge's output). Client-safe and pure:
 * the dev-only middleware (review-server.ts) does the file I/O.
 *
 *   RTSAI-Art/units/<actor>/spec.json, units/<actor>/candidates/<id>/meta.json + files, review.json,
 *   reference-local/ (local RA2 comparisons; never published)
 */
import type { RenderSpec } from "./spec";
import type { Vec3 } from "./types";

export type ReviewStatus = "draft" | "in-review" | "approved" | "rejected";
export const reviewStatuses: ReviewStatus[] = ["draft", "in-review", "approved", "rejected"];

export type ReviewComment = { at: string; candidate: string | null; view: string | null; text: string; author: string };
export type ReviewEntry = { status: ReviewStatus; approved: string | null; comments: ReviewComment[] };
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
  | { type: "approve"; actor: string; candidate: string; view?: string | null; text?: string; author?: string }
  | { type: "reject"; actor: string; candidate: string; view?: string | null; text?: string; author?: string }
  | { type: "comment"; actor: string; candidate?: string | null; view?: string | null; text: string; author?: string }
  | { type: "status"; actor: string; status: ReviewStatus; author?: string };

export const emptyEntry = (): ReviewEntry => ({ status: "draft", approved: null, comments: [] });

const ACTOR = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CANDIDATE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Validates an action from the browser; returns an error message or null. */
export function validateAction(action: unknown): string | null {
  if (!action || typeof action !== "object") return "Expected a JSON object";
  const a = action as Record<string, unknown>;
  if (typeof a.actor !== "string" || !ACTOR.test(a.actor)) return "Bad actor";
  if (a.type === "approve" || a.type === "reject") {
    if (typeof a.candidate !== "string" || !CANDIDATE.test(a.candidate)) return "Bad candidate";
  } else if (a.type === "comment") {
    if (typeof a.text !== "string" || !a.text.trim()) return "Empty comment";
    if (a.candidate !== undefined && a.candidate !== null && (typeof a.candidate !== "string" || !CANDIDATE.test(a.candidate))) return "Bad candidate";
  } else if (a.type === "status") {
    if (!reviewStatuses.includes(a.status as ReviewStatus)) return "Bad status";
  } else return "Unknown action";
  for (const key of ["text", "view", "author"]) if (a[key] !== undefined && a[key] !== null && (typeof a[key] !== "string" || (a[key] as string).length > 4000)) return `Bad ${key}`;
  return null;
}

/** Applies an action to review.json content (immutably) and returns the new file. */
export function applyReviewAction(file: ReviewFile, action: ReviewAction, now = new Date().toISOString()): ReviewFile {
  const entry: ReviewEntry = { ...emptyEntry(), ...(file[action.actor] ?? {}) };
  entry.comments = [...(entry.comments ?? [])];
  const author = action.author?.trim() || "owner";
  const note = (verb: string, candidate: string, text?: string) => entry.comments.push({ at: now, candidate, view: ("view" in action ? action.view : null) ?? null, text: text?.trim() ? `${verb}: ${text.trim()}` : verb, author });
  switch (action.type) {
    case "approve":
      entry.status = "approved";
      entry.approved = action.candidate;
      note("Approved", action.candidate, action.text);
      break;
    case "reject":
      if (entry.approved === action.candidate) entry.approved = null;
      entry.status = entry.approved ? "approved" : "rejected";
      note("Rejected", action.candidate, action.text);
      break;
    case "comment":
      entry.comments.push({ at: now, candidate: action.candidate ?? null, view: action.view ?? null, text: action.text.trim(), author });
      if (entry.status === "draft") entry.status = "in-review";
      break;
    case "status":
      entry.status = action.status;
      if (action.status !== "approved") entry.approved = action.status === "rejected" ? null : entry.approved;
      break;
  }
  return { ...file, [action.actor]: entry };
}

const latest = (dates: string[]) => dates.reduce((a, b) => (b > a ? b : a), "");

/**
 * Needs attention: units with candidates the owner has not yet decided on — no decision at all, a draft or
 * in-review status, or a candidate newer than the last decision or comment.
 */
export function needsAttention(unit: UnitWorkspace, entry: ReviewEntry | undefined) {
  const candidates = unit.candidates.filter(c => hasViewableFiles(c));
  if (!candidates.length) return false;
  if (!entry || entry.status === "draft" || entry.status === "in-review") return true;
  const lastReview = latest(entry.comments.map(c => c.at));
  return latest(candidates.map(c => c.createdAt)) > lastReview;
}

export function hasViewableFiles(c: CandidateMeta) {
  const f = c.files ?? {};
  return Boolean(f.cameo || f.concept || f.vxl?.length || f.shp?.length || f.previews?.length);
}

export function effectiveStatus(entry: ReviewEntry | undefined): ReviewStatus {
  return entry?.status ?? "draft";
}

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
