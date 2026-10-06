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
import { candidatesForSlot, hasViewableFiles, PREVIEW_RULES, slotOfKind, type Candidate, type ReviewFile, type SlotDecision, type UnitWorkspace } from "./review";
import type { ModelActor, ModelLibrary, ModelOption } from "./models";
import type { SpriteArt } from "./types";
import type { RenderSpec } from "./spec";
import { measuredGroups, type MeasuredGroup } from "./measurements";
import { barrelSequence, spriteAnimations, spriteSpins } from "./sprite-anim";
import { spinKind, spinLabel, type SpinKind } from "./action-labels";

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
/**
 * A voxel animation the preview copy's rules play for an actor: a helicopter body cycling its HVA frames while
 * airborne (WithVoxelHelicopterBody, e.g. a drone's propeller section) or a model that spins on the body or a
 * turret (WithAnimatedVoxelModel, e.g. a radar). `file` is the voxel the sequence names; a null `tickRate` is
 * inherited from the actor's own rules.
 */
export type PreviewAnimation = { trait: string; sequence: string; file: string | null; tickRate: number | null; turret: string | null; condition: string | null; airborne: boolean };
/* trait "sequence": a voxel sequence the overlay remaps to another file; the actor's own trait for it plays it. */
export type PreviewActor = { model: string | null; icon: string | null; files: string[]; rules: boolean; animations?: PreviewAnimation[];
  /** The release (RTSAI-Mod main) carries this art byte for byte: promoted, so it is what the game plays. */
  released?: boolean };
/** How to play the preview copy: measured facts about the folders, and the command that launches it. */
export type PreviewLaunch = { worktree: string; supportDir: string; engineBuilt: boolean; ra2Content: boolean; companionFiles: boolean; command: string };
export type PreviewStatus = { available: boolean; branch: string | null; head: string | null; actors: Record<string, PreviewActor>; unmatched: string[]; launch?: PreviewLaunch };

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
 * The version the Studio opens: the candidate under review (see reviewCandidate) that is not rejected, else the
 * newest native one; never the placeholder when a candidate exists. "current" when the actor has none.
 */
export function defaultModelFocus(ws: UnitWorkspace | undefined, decision?: SlotDecision | null, installed?: string | null): string {
  return (reviewCandidate(ws, installed, decision?.rejected ?? []) ?? nativeCandidates(ws)[0])?.id ?? "current";
}

/**
 * The candidate under review for an actor: the one the local preview copy plays (its installed bytes; the art route
 * picked it, e.g. a prerendered sprite over a bold-voxel fallback), else the newest made from the 3D model, else the
 * newest native one. `skip`: candidates the owner rejected.
 */
export function reviewCandidate(ws: UnitWorkspace | undefined, installed?: string | null, skip: string[] = []): Candidate | null {
  const natives = nativeCandidates(ws).filter(c => !skip.includes(c.id));
  return natives.find(c => c.id === installed) ?? natives.find(c => fromModel(c, ws?.candidates)) ?? natives[0] ?? null;
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
const infantryActions: [string, string][] = [["stand", "Stand"], ["idle", "Idle"], ["move", "Walk"], ["attack", "Fire"], ["prone", "Prone"], ["die", "Die"]];

/** The actions this kind of actor needs, and whether the version's own art provides each one. */
/**
 * The actions this actor needs, and whether the version's own art provides each one. What the game's rules use
 * today (`current`: a turret, a rotor or other HVA cycle) decides what a replacement must have: a jet needs no rotor
 * and a turretless artillery piece no turret.
 */
export function actionCoverage(category: string, spec: RenderSpec | null | undefined, sprite: SpriteArt | null | undefined, current?: { spec?: RenderSpec | null; sprite?: SpriteArt | null } | null): ActionCheck[] {
  if (spec?.voxel) {
    const parts = spec.voxel.parts.filter(p => p.defaultVisible !== false);
    const now = current?.spec?.voxel?.parts.filter(p => p.defaultVisible !== false) ?? null;
    const out: ActionCheck[] = [{ id: "body", label: "Body", present: parts.some(p => !p.turretOffset) }];
    const needsTurret = now ? now.some(p => p.turretOffset !== null) : ["vehicle", "ship", "defense"].includes(category);
    if (needsTurret || parts.some(p => p.turretOffset)) out.push({ id: "turret", label: "Turret", present: parts.some(p => p.turretOffset !== null) });
    const cycling = parts.filter(p => p.frames > 1);
    const playing = cycling.filter(p => p.tickRate !== null && p.tickRate > 0);
    const needsCycle = now ? now.some(p => p.tickRate !== null && p.tickRate > 0) : category === "aircraft";
    // Rotor and propeller sections cycle through WithVoxelHelicopterBody; radars through WithAnimatedVoxelModel.
    const preview = playing.filter(p => p.trait.endsWith(PREVIEW_RULES));
    if (needsCycle || cycling.length) out.push({
      id: "hva", label: spinLabel(cycling.map(p => (p.spin as SpinKind | undefined) ?? spinKind(p.label) ?? (p.trait.startsWith("WithVoxelHelicopterBody") ? "rotor" : null)), category === "aircraft" ? "Rotor spin" : "Moving parts"), present: playing.length > 0,
      note: cycling.some(p => !p.tickRate) ? "HVA frames exist, but no TickRate plays them in game."
        : preview.length ? `Played by the local preview copy's rules: ${[...new Set(preview.map(p => p.trait.slice(0, -PREVIEW_RULES.length)))].join(", ")}.` : undefined,
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
    // A bunker may drop the turret by design and fire from its slit by swapping body frames (WithAttackAnimation).
    const slit = !sprite?.turret && seqs.some(s => s.usedBy.some(u => u.split("@")[0] === "WithAttackAnimation"));
    if (slit) out.push({ id: "fire", label: "Fires from its slit", present: true, note: "No turret by design: it fires by swapping its body frames (WithAttackAnimation)." });
    else if (current ? Boolean(current.sprite?.turret) || Boolean(sprite?.turret) : category === "defense") out.push({ id: "turret", label: "Turret", present: Boolean(sprite?.turret) });
  } else {
    if (current ? Boolean(current.sprite?.turret) || Boolean(current.spec?.voxel?.parts.some(p => p.turretOffset !== null)) || Boolean(sprite?.turret) : true) {
      out.push({ id: "turret", label: "Turret", present: Boolean(sprite?.turret) });
    }
    // A sprite vehicle's moving parts are rendered overlays: rotors, propellers, radars (idle or turret-riding).
    const spinning = spriteSpins(sprite ?? null);
    const needsSpin = current?.spec?.voxel?.parts.some(p => p.defaultVisible !== false && p.tickRate !== null && p.tickRate > 0) ?? false;
    if (needsSpin || spinning.length) out.push({ id: "spin", label: spinLabel(spinning.map(spinKind), category === "aircraft" ? "Rotor spin" : "Moving parts"), present: spinning.length > 0 });
    if (sprite?.barrel) out.push({ id: "barrel", label: "Barrel", present: Boolean(barrelSequence(sprite)) });
  }
  return out;
}

/**
 * The Checks step: the measured results the art routes saved for this candidate (see measurements.ts). An empty
 * list means "not measured yet"; nothing is computed here.
 */
export function candidateChecks(candidate: Candidate | null): MeasuredGroup[] {
  if (!candidate) return [];
  return candidate.measured ?? measuredGroups({}, candidate as unknown as Record<string, unknown>);
}

export type ChecksSummary = { state: "none" | "pass" | "fail" | "partial" | "info"; failing: number; passed: number; total: number; headline: MeasuredGroup | null; advisory: boolean };
/** Counts what the tools recorded: failing rows plus failed groups without rows; the headline is the family gate. */
export function checksSummary(groups: MeasuredGroup[]): ChecksSummary {
  if (!groups.length) return { state: "none", failing: 0, passed: 0, total: 0, headline: null, advisory: false };
  const rows = groups.flatMap(g => g.rows);
  const failing = rows.filter(r => !r.pass).length + groups.filter(g => g.pass === false && !g.rows.some(r => !r.pass)).length;
  const headline = groups.find(g => g.id === "family" && g.rows.length) ?? groups.find(g => g.rows.length) ?? null;
  const recorded = groups.some(g => g.pass !== null) || rows.length > 0;
  // Format or decode checks alone never read as "all passed": the stock-family comparison is the art check.
  const family = groups.some(g => g.id === "family" && g.pass !== null);
  const advisory = groups.some(g => g.id === "family" && g.advisory);
  return { state: failing ? "fail" : !family ? (recorded ? "partial" : "info") : "pass", failing, passed: rows.filter(r => r.pass).length, total: rows.length, headline, advisory };
}

/** Failing checks first, across every group, then each group's passing rows. */
export function failingFirst(groups: MeasuredGroup[]) {
  const failing = groups.flatMap(g => g.rows.filter(r => !r.pass).map(r => ({ group: g, row: r })));
  const failedGroups = groups.filter(g => g.pass === false && !g.rows.some(r => !r.pass));
  return { failing, failedGroups, passing: groups.map(g => ({ group: g, rows: g.rows.filter(r => r.pass) })) };
}

export type DecisionState = { kind: "use" | "keep" | "rejected" | "open" | "none"; label: string };
export function decisionState(decision: SlotDecision | undefined, candidate: Candidate | null): DecisionState {
  if (!candidate) return decision?.chosen === "current" ? { kind: "keep", label: "Keep current" } : { kind: "none", label: "Nothing to decide" };
  if (decision?.chosen === candidate.id) return { kind: "use", label: "Use in game" };
  if (decision?.rejected.includes(candidate.id)) return { kind: "rejected", label: "Rejected" };
  if (decision?.chosen === "current" && (decision.at ?? "") >= candidate.createdAt) return { kind: "keep", label: "Keep current" };
  return { kind: "open", label: "Not decided" };
}

export type RosterCounts = { total: number; designs: number; models3d: number; gameModels: number; inPreview: number; decided: number;
  /** Of those in preview, how many the release (RTSAI-Mod main) already plays byte for byte. */
  released?: number };
/**
 * Per-actor counts over the new RA2 roster. An actor counts once per column whatever number of files, jobs or
 * routes it has; queued work and converted existing art never count as new coverage.
 */
export function rosterCounts(actors: string[], workspaces: Map<string, UnitWorkspace>, library: ModelLibrary | null, preview: PreviewStatus | null, review: ReviewFile | undefined): RosterCounts {
  const byActor = new Map((library?.actors ?? []).map(a => [a.actor, a]));
  let designs = 0, models3d = 0, gameModels = 0, inPreview = 0, decided = 0, released = 0;
  for (const actor of actors) {
    const ws = workspaces.get(actor);
    const natives = nativeCandidates(ws);
    const fromGlb = natives.filter(c => fromModel(c, ws?.candidates));
    const mesh = meshCandidate(ws, fromGlb[0] ?? null);
    if (designFor(ws, mesh, fromGlb[0] ?? null)) designs++;
    if (glbOptions(byActor.get(actor), mesh).length) models3d++;
    if (fromGlb.length) gameModels++;
    // The same rules as the review board: the candidate under review is the newest GLB-made native one (else the
    // newest native one); "in preview" means that candidate's exact bytes are installed (an icon alone is not a
    // model in the preview), and "decided" means it is used, rejected, or "keep current" came after it.
    const candidate = reviewCandidate(ws, preview?.actors[actor]?.model);
    if (candidate && preview?.actors[actor]?.model === candidate.id) { inPreview++; if (preview.actors[actor].released) released++; }
    const state = decisionState(review?.[actor]?.slots.model, candidate);
    if (state.kind === "use" || state.kind === "rejected" || state.kind === "keep") decided++;
  }
  return { total: actors.length, designs, models3d, gameModels, inPreview, decided, released };
}

export { hasViewableFiles };
