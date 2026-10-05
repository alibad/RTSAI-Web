/**
 * One asset chain per actor: what the game draws today, the design it was rebuilt from, the generated 3D
 * model, the native game-model candidate made from it, its animations, the measured checks and the owner's
 * decision. Client-safe and pure; the Studio draws it, the tests pin it down.
 *
 * Honesty rules encoded here:
 *  - a candidate is never "in game": only the current mod art is, and a candidate can at most be installed in
 *    the local preview mod (matched by file bytes, see preview-server.ts);
 *  - counts are per actor over one denominator (the new RA2 roster), never a sum of routes or queued jobs.
 */
import { candidatesForSlot, hasViewableFiles, slotOfKind, type Candidate, type ReviewFile, type SlotDecision, type UnitWorkspace } from "./review";
import type { ModelActor, ModelLibrary, ModelOption } from "./models";
import type { SpriteArt } from "./types";
import type { RenderSpec } from "./spec";
import { spriteAnimations } from "./sprite-anim";

export type ChainStep = "now" | "design" | "glb" | "game" | "anim" | "checks" | "call";
export const chainSteps: { id: ChainStep; label: string }[] = [
  { id: "now", label: "In game now" },
  { id: "design", label: "Design" },
  { id: "glb", label: "3D model" },
  { id: "game", label: "Game model" },
  { id: "anim", label: "Animations" },
  { id: "checks", label: "Checks" },
  { id: "call", label: "Your call" },
];
export const isChainStep = (value: string | null): value is ChainStep => chainSteps.some(s => s.id === value);

/** Local preview mod (RTSAI-Mod rtsai/art-preview): which candidate each actor's installed files came from. */
export type PreviewActor = { model: string | null; icon: string | null; files: string[]; rules: boolean };
export type PreviewStatus = { available: boolean; branch: string | null; head: string | null; actors: Record<string, PreviewActor>; unmatched: string[] };

const newest = (a: Candidate, b: Candidate) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1);

/** Native game-art candidates (VXL/HVA or SHP) for the battlefield model, newest first. */
export const nativeCandidates = (ws: UnitWorkspace | undefined) => [...candidatesForSlot(ws, "model")].sort(newest);

/** Made from the generated 3D model (not an older procedural or image-route candidate). */
export function fromModel(candidate: Candidate, all: Candidate[] = []): boolean {
  if (slotOfKind(candidate.kind) !== "model") return false;
  if (typeof candidate.fromMesh === "string" && candidate.fromMesh) return true;
  if (/(^|-)glb($|-)/i.test(candidate.id)) return true;
  const parent = all.find(c => c.id === candidate.variantOf);
  return Boolean(parent && parent.kind === "mesh");
}

/**
 * The version the Studio opens: the newest native candidate that is not rejected (else the newest one), never
 * the placeholder when a candidate exists. "current" when the actor has no native candidate.
 */
export function defaultModelFocus(ws: UnitWorkspace | undefined, decision?: SlotDecision | null): string {
  const list = nativeCandidates(ws);
  return (list.find(c => !decision?.rejected.includes(c.id)) ?? list[0])?.id ?? "current";
}

const fileUrl = (c: Candidate, file: string | null | undefined) => (file ? c.urls[file.replace(/\\/g, "/")] ?? null : null);
const hasMesh = (c: Candidate) => c.kind === "mesh" && Boolean(c.files.mesh) && Boolean(c.urls[String(c.files.mesh)]);

/** The generated 3D source of a native candidate (its fromMesh), else the actor's newest mesh candidate. */
export function meshCandidate(ws: UnitWorkspace | undefined, native: Candidate | null): Candidate | null {
  const all = ws?.candidates ?? [];
  const named = native?.fromMesh ? all.find(c => c.id === native.fromMesh && hasMesh(c)) : null;
  return named ?? [...all].filter(hasMesh).sort(newest)[0] ?? null;
}

export type Design = { candidate: Candidate; image: string; thumb: string };
/** The identity design the chain was built from: the candidate's or the mesh's fromConcept, else the newest concept. */
export function designFor(ws: UnitWorkspace | undefined, mesh: Candidate | null, native: Candidate | null): Design | null {
  const all = ws?.candidates ?? [];
  const pick = (c: Candidate | undefined | null): Design | null => {
    if (!c) return null;
    const master = c.files as Record<string, unknown>;
    const image = fileUrl(c, c.files.concept ?? (typeof master.master === "string" ? master.master : null));
    if (!image) return null;
    return { candidate: c, image, thumb: c.urls["preview-master.png"] ?? image };
  };
  for (const id of [native?.fromConcept, mesh?.fromConcept]) {
    const hit = pick(all.find(c => c.id === id));
    if (hit) return hit;
  }
  return [...candidatesForSlot(ws, "concept")].sort(newest).map(pick).find(Boolean) ?? null;
}

/** New-design GLB options only: converted current voxels or held private reconstructions are not this chain. */
export function glbOptions(actor: ModelActor | undefined, mesh: Candidate | null): ModelOption[] {
  const library = (actor?.options ?? []).filter(o => o.id !== "current-voxel" && o.id !== "sprite-reconstruction");
  if (library.length || !mesh) return library;
  const web = mesh.urls[String((mesh.files as Record<string, unknown>).webMesh ?? "web.glb")] ?? mesh.urls[String(mesh.files.mesh)];
  return web ? [{ id: mesh.id, label: "New design · GLB draft", url: web, bytes: 0, triangles: null, source: "Project-generated source", remap: false, turret: false, status: "Static geometry" }] : [];
}

export type ActionCheck = { id: string; label: string; present: boolean; note?: string };
const infantryActions: [string, string][] = [["stand", "Stand"], ["idle", "Idle"], ["move", "Run"], ["attack", "Fire"], ["prone", "Prone"], ["die", "Die"]];

/** The actions this kind of actor needs, and whether the version's own art provides each one. */
export function actionCoverage(category: string, spec: RenderSpec | null | undefined, sprite: SpriteArt | null | undefined): ActionCheck[] {
  if (spec?.voxel) {
    const parts = spec.voxel.parts.filter(p => p.defaultVisible !== false);
    const out: ActionCheck[] = [{ id: "body", label: "Body", present: parts.some(p => !p.turretOffset) }];
    if (["vehicle", "ship", "defense"].includes(category) || parts.some(p => p.turretOffset)) out.push({ id: "turret", label: "Turret", present: parts.some(p => p.turretOffset !== null) });
    const cycling = parts.filter(p => p.frames > 1);
    if (category === "aircraft" || cycling.length) out.push({
      id: "hva", label: category === "aircraft" ? "Rotor / HVA" : "HVA cycle", present: cycling.some(p => p.tickRate !== null && p.tickRate > 0),
      note: cycling.some(p => !p.tickRate) ? "HVA frames exist, but no TickRate plays them in game." : undefined,
    });
    return out;
  }
  const list = spriteAnimations(sprite ?? null);
  const has = (id: string) => list.some(a => a.id === id && !a.note?.startsWith("No "));
  if (category === "infantry") return infantryActions.map(([id, label]) => ({ id, label, present: has(id) }));
  const seqs = (sprite?.sequences ?? []).filter(s => !s.inherited);
  const out: ActionCheck[] = [{ id: "body", label: "Idle", present: has("body") || has("stand") }];
  if (category === "defense" || category === "structure") {
    out.push({ id: "make", label: "Build-up", present: has("make") });
    out.push({ id: "damaged", label: "Damaged", present: seqs.some(s => s.name.startsWith("damaged")) });
    if (category === "defense") out.push({ id: "turret", label: "Turret", present: Boolean(sprite?.turret) });
  } else {
    out.push({ id: "turret", label: "Turret", present: Boolean(sprite?.turret) });
  }
  return out;
}

export type Check = { label: string; result: string; pass: boolean | null };
/** Measured checks the candidate records. Absent measurements stay absent; a pass is never owner approval. */
export function candidateChecks(candidate: Candidate | null): Check[] {
  if (!candidate) return [];
  const out: Check[] = [];
  const gate = candidate.qualityGate;
  if (gate && typeof gate.checksPassed === "number" && typeof gate.checksTotal === "number") {
    out.push({ label: "Numerical gate", result: `${gate.checksPassed}/${gate.checksTotal}`, pass: gate.passes === true });
  }
  const verify = candidate.verify?.checks;
  if (verify && Object.keys(verify).length) {
    const entries = Object.entries(verify);
    out.push({ label: "Format checks", result: `${entries.filter(([, ok]) => ok === true).length}/${entries.length}`, pass: entries.every(([, ok]) => ok === true) });
    for (const [name, ok] of entries) out.push({ label: checkName(name), result: ok === true ? "pass" : "fail", pass: ok === true });
  }
  const animation = candidate.animation;
  if (animation && typeof animation.frames === "number") out.push({ label: "Frames decoded", result: `${animation.frames}`, pass: true });
  const paint = candidate.voxelize?.log?.paint;
  if (paint) {
    const shares = Object.values(paint).map(p => p?.classShares?.team).filter((n): n is number => typeof n === "number");
    if (shares.length) out.push({ label: "Player colour", result: `${(Math.max(...shares) * 100).toFixed(1)}% of surface`, pass: null });
  }
  if (candidate.sourceMeshSha256) out.push({ label: "Source GLB pinned", result: candidate.sourceMeshSha256.slice(0, 8), pass: true });
  return out;
}

/** "noClipping" -> "No clipping"; "sixColoursOnlyRemapChanges" -> "Six colours only remap changes". */
export const checkName = (name: string) => {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export type DecisionState = { kind: "use" | "keep" | "rejected" | "open" | "none"; label: string };
export function decisionState(decision: SlotDecision | undefined, candidate: Candidate | null): DecisionState {
  if (!candidate) return decision?.chosen === "current" ? { kind: "keep", label: "Keep current" } : { kind: "none", label: "Nothing to decide" };
  if (decision?.chosen === candidate.id) return { kind: "use", label: "Use in game" };
  if (decision?.rejected.includes(candidate.id)) return { kind: "rejected", label: "Rejected" };
  if (decision?.chosen === "current" && (decision.at ?? "") >= candidate.createdAt) return { kind: "keep", label: "Keep current" };
  return { kind: "open", label: "Not decided" };
}

export type RosterCounts = { total: number; designs: number; models3d: number; gameModels: number; inPreview: number; decided: number };
/**
 * Per-actor counts over the new RA2 roster. An actor counts once per column whatever number of files, jobs or
 * routes it has; queued work and converted existing art never count as new coverage.
 */
export function rosterCounts(actors: string[], workspaces: Map<string, UnitWorkspace>, library: ModelLibrary | null, preview: PreviewStatus | null, review: ReviewFile | undefined): RosterCounts {
  const byActor = new Map((library?.actors ?? []).map(a => [a.actor, a]));
  let designs = 0, models3d = 0, gameModels = 0, inPreview = 0, decided = 0;
  for (const actor of actors) {
    const ws = workspaces.get(actor);
    const natives = nativeCandidates(ws);
    const fromGlb = natives.filter(c => fromModel(c, ws?.candidates));
    const mesh = meshCandidate(ws, fromGlb[0] ?? null);
    if (designFor(ws, mesh, fromGlb[0] ?? null)) designs++;
    if (glbOptions(byActor.get(actor), mesh).length) models3d++;
    if (fromGlb.length) gameModels++;
    const p = preview?.actors[actor];
    if (p && (p.model || p.files.length)) inPreview++;
    if (review?.[actor]?.slots.model.chosen) decided++;
  }
  return { total: actors.length, designs, models3d, gameModels, inPreview, decided };
}

export { hasViewableFiles };
