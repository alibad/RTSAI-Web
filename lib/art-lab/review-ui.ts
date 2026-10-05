/**
 * Pure helpers for the Review screen: short version labels, drag and zoom maths, lineup facings, progress and
 * the provenance chain shown in Details. Client-safe and DOM-free so they are unit-tested directly.
 */
import type { Candidate } from "./review";

export const kindNames: Record<string, string> = { voxel: "Voxel", sprite: "Sprite", cameo: "Icon", concept: "Concept" };
export const kindTags: Record<string, string> = { voxel: "VXL", sprite: "SHP", cameo: "PNG", concept: "PNG" };

/** Oldest first; ties by id. */
export const byCreation = (a: Pick<Candidate, "id" | "createdAt">, b: Pick<Candidate, "id" | "createdAt">) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function letter(index: number) {
  let n = index + 1, out = "";
  while (n > 0) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
  return out;
}

/** "Voxel A", "Voxel B", "Sprite A": letters by creation order within each kind. */
export function versionLabels(candidates: Pick<Candidate, "id" | "kind" | "createdAt">[]) {
  const labels = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const c of [...candidates].sort(byCreation)) {
    const n = counts.get(c.kind) ?? 0;
    counts.set(c.kind, n + 1);
    labels.set(c.id, `${kindNames[c.kind] ?? c.kind} ${letter(n)}`);
  }
  return labels;
}

/** One of OpenRA's 32 vehicle facings (WAngle 0-1023). */
export const FACING_STEP = 32;
/** Pixels of horizontal drag per facing step: a full turn is 320 px. */
export const DRAG_STEP_PX = 10;

/**
 * Facing after dragging `dx` pixels from `start`. Dragging right turns the unit counter-clockwise seen from above
 * (the side nearest the camera follows the pointer); OpenRA facings increase counter-clockwise.
 */
export function dragFacing(start: number, dx: number, step = DRAG_STEP_PX) {
  return (((start + Math.round(dx / step) * FACING_STEP) % 1024) + 1024) % 1024;
}

/** Turret angle relative to the body after a drag, kept in -512..511. */
export function dragTurret(start: number, dx: number, step = DRAG_STEP_PX) {
  return ((dragFacing(start + 512, dx, step) + 1024) % 1024) - 512;
}

/**
 * The largest integer zoom (1..max) at which a unit whose turning circle has `radius` 1x pixels stays inside
 * `fill` of a width x height pane, whatever its facing.
 */
export function fitZoom(radius: number, width: number, height: number, max = 6, fill = 0.8) {
  const z = Math.floor(((Math.min(width, height) / 2) * fill) / Math.max(1, radius));
  return Math.max(1, Math.min(max, z));
}

/** Integer zoom for a lineup cell of cellWidth x cellHeight showing a w x h unit picture. */
export function cellZoom(w: number, h: number, cellWidth: number, cellHeight: number, max = 6) {
  return Math.max(1, Math.min(max, Math.floor(Math.min(cellWidth / Math.max(1, w), cellHeight / Math.max(1, h)))));
}

export const clampZoom = (zoom: number, max: number) => Math.max(1, Math.min(Math.max(1, max), Math.round(zoom)));

/** Lineup columns: the four diagonals, or eight compass facings, turned together by `offset`. */
export function lineupFacings(count: 4 | 8, offset = 0) {
  const base = count === 4 ? [896, 640, 384, 128] : [896, 768, 640, 512, 384, 256, 128, 0];
  return base.map(f => (((f + offset) % 1024) + 1024) % 1024);
}

/** Units with candidates make up the queue; a unit is decided when it no longer needs a decision. */
export function reviewProgress(rows: { count: number; needs: boolean }[]) {
  const queue = rows.filter(r => r.count > 0);
  return { decided: queue.filter(r => !r.needs).length, total: queue.length };
}

/** The image-to-3D or render tool behind a candidate, in a word or two. */
export function generatorName(c: Pick<Candidate, "imageTo3d" | "model">) {
  const weights = c.imageTo3d?.license?.weights ?? "";
  if (/TRELLIS\.2/i.test(weights) || /trellis/i.test(c.imageTo3d?.model ?? "")) return "TRELLIS.2";
  if (c.imageTo3d?.model) return c.imageTo3d.model;
  const model = c.model ?? "";
  if (/blender/i.test(model)) return "Blender render";
  if (/sunburst/i.test(model)) return "Sunburst";
  return model ? model.split(/\s+/).slice(0, 2).join(" ") : null;
}

/** "concept-v1 → TRELLIS.2 → Voxel": what a candidate was made from, oldest step first. */
export function provenanceChain(c: Pick<Candidate, "kind" | "fromConcept" | "variantOf" | "imageTo3d" | "model">) {
  return [c.fromConcept, c.variantOf, generatorName(c), kindNames[c.kind] ?? c.kind].filter((s): s is string => Boolean(s));
}

export const quickChips = ["Too dark", "Less camo noise", "More contrast", "Bigger/smaller", "Wrong shape", "Love it"];

/** Adds a quick chip to a draft note once. */
export function appendChip(text: string, chip: string) {
  const t = text.trim();
  if (!t) return chip;
  if (t.toLowerCase().includes(chip.toLowerCase())) return t;
  return `${t.replace(/[.\s]+$/, "")}. ${chip}`;
}

/** "just now", "12 min ago", "3 h ago", "2 d ago", then the date. */
export function relativeTime(iso: string, now: number) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(at).toISOString().slice(0, 10);
}
