/**
 * The faction review board: every new unit of a faction as one tile (what is in game now beside the new game
 * model), and the rules for deciding quickly. Client-safe and pure.
 *
 * A tile's candidate is the one the local preview copy plays, else the newest native model made from the 3D route
 * (else the newest native candidate); see chain.ts reviewCandidate. A
 * decision always concerns exactly that candidate and is written only when the owner presses a key or a button.
 */
import { decisionState, reviewCandidate, type ActionCheck, type DecisionState, type PreviewStatus } from "./chain";
import type { Candidate, ReviewEntry, ReviewFile, UnitWorkspace } from "./review";

/** The candidate a board tile shows and decides. Rejected ones stay on the tile, marked rejected. */
export function boardCandidate(ws: UnitWorkspace | undefined, installed?: string | null): Candidate | null {
  return reviewCandidate(ws, installed);
}

export type BoardTile = { actor: string; candidate: Candidate | null; decision: DecisionState; notes: number; inPreview: boolean; previewOther: boolean; released?: boolean };

export function boardTile(actor: string, ws: UnitWorkspace | undefined, entry: ReviewEntry | undefined, preview: PreviewStatus | null): BoardTile {
  const p = preview?.actors[actor];
  const candidate = boardCandidate(ws, p?.model);
  return {
    actor, candidate,
    decision: decisionState(entry?.slots.model, candidate),
    notes: (entry?.comments ?? []).filter(c => !candidate || c.candidate === candidate.id || c.candidate === null).length,
    inPreview: Boolean(candidate && p?.model === candidate.id),
    released: Boolean(candidate && p?.model === candidate.id && p?.released),
    previewOther: Boolean(p && p.files.length && (!candidate || p.model !== candidate.id)),
  };
}

/** Decided: the shown candidate is used, rejected, or "keep current" was chosen after it arrived. */
export const isDecided = (t: BoardTile) => t.decision.kind === "use" || t.decision.kind === "rejected" || t.decision.kind === "keep";
/** Waiting for the owner: a candidate exists and nothing decides it yet. */
export const isOpen = (t: BoardTile) => Boolean(t.candidate) && t.decision.kind === "open";

/** The next tile after `from` that still waits for a decision (wrapping), or -1 when every one is decided. */
export function nextOpen(tiles: BoardTile[], from: number): number {
  for (let step = 1; step <= tiles.length; step++) {
    const i = (from + step) % tiles.length;
    if (isOpen(tiles[i])) return i;
  }
  return -1;
}

export type BoardCounts = { units: number; withModel: number; decided: number; inPreview: number; withoutModel: number };
/** Per-faction (or all-faction) counts; each unit counts once. */
export function boardCounts(tiles: BoardTile[]): BoardCounts {
  const withModel = tiles.filter(t => t.candidate).length;
  return { units: tiles.length, withModel, decided: tiles.filter(t => t.candidate && isDecided(t)).length, inPreview: tiles.filter(t => t.inPreview).length, withoutModel: tiles.length - withModel };
}

/** Units whose new model lacks actions its kind needs, with the missing ones named. */
export function missingAnimations(rows: { name: string; actions: ActionCheck[] }[]) {
  return rows.map(r => ({ name: r.name, missing: r.actions.filter(a => !a.present).map(a => a.label) })).filter(r => r.missing.length);
}

/** All factions' tiles from one state, for totals. */
export function allTiles(actors: string[], workspaces: Map<string, UnitWorkspace>, review: ReviewFile | undefined, preview: PreviewStatus | null) {
  return actors.map(a => boardTile(a, workspaces.get(a), review?.[a], preview));
}
