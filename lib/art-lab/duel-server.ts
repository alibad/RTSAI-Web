/** Local headless engine jobs. No shell, AI calls, repository edits or external requests. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { classicConfig, rosterPayload, type OriginalsConfig, type RosterPayload } from "./originals";

export type DuelSide = { id: string; count: number; deploy: boolean; health?: number; faction?: string; ruleKey?: string };
export type DuelPlacement = { key: string; id: string; side: 0 | 1; u: number; v: number; deploy: boolean; faction?: string; ruleKey?: string; order?: "engage" | "hold" | "move"; destination?: { u: number; v: number } };
export type DuelRequest = { mode: "ra2" | "classic"; a: DuelSide; b: DuelSide; gap: number; level: number; placements?: DuelPlacement[]; waterSide?: "none" | "a" | "b" | "both" };
export type DuelSample = { tick: number; actors: { side: number; index: number; actor?: number; turretFacing?: number; x: number; y: number; z: number; facing: number; health: number; maxHealth: number }[]; wrecks?: { side: number; type: string; x: number; y: number; z: number; facing: number }[] };
export type DuelShot = { tick: number; actor: number; weapon: string; projectile: string; x: number; y: number; z: number; tx: number; ty: number; tz: number; facing: number; muzzle?: string | null; palette?: string };
export type DuelVisual = { tick: number; id: number; kind: "projectile" | "effect"; actor?: number; type: string; x: number; y: number; z: number; tx?: number | null; ty?: number | null; tz?: number | null; facing: number; image?: string; sequence?: string; frame: number; palette: string };
export type DuelResult = { evidence: "measured"; engine: string; contentRevision?: string; request: DuelRequest; ticksPerSecond: number; samples: DuelSample[]; shots?: DuelShot[]; visuals?: DuelVisual[]; events?: { tick: number; kind: string; side: number; index: number; attackerSide: number; attackerIndex: number; damage: number }[]; effects?: { kind: "crash"; tick: number; side: number; type: string; x: number; y: number; z: number }[]; limitations: string };
type Job = { id: string; status: "running" | "complete" | "failed"; error?: string; result?: DuelResult };
const jobs = new Map<string, Job>();
let running = false;

/** A unit may only use a faction whose real roster contains it. Legacy callers get a valid owner. */
export function duelFaction(data: Pick<RosterPayload, "factions">, actor: string, requested: string | undefined, mode: "ra2" | "classic") {
  const available = data.factions.filter(f => f.units.some(u => u.id === actor));
  if (requested !== undefined) {
    if (!available.some(f => f.id === requested)) throw new Error("This faction cannot build the selected actor");
    return requested;
  }
  const preferred = mode === "classic" ? "england" : "america";
  const faction = available.find(f => f.id === preferred) ?? available[0];
  if (!faction) throw new Error("No faction can build the selected actor");
  return faction.id;
}

/** Validate the direct-placement editor before any process starts. Coordinates are disposable map columns. */
export function duelPlacements(input: unknown, data: RosterPayload, mode: "ra2" | "classic"): DuelPlacement[] {
  if (!Array.isArray(input) || input.length < 2 || input.length > 12) throw new Error("Place two to twelve actors");
  const keys = new Set<string>();
  const cell = (p: { u: number; v: number }) => Number.isInteger(p?.u) && Number.isInteger(p?.v) && p.u >= 36 && p.u <= 92 && p.v >= 40 && p.v <= 92;
  const placements = input.map((p: DuelPlacement) => {
    if (!p || ![0, 1].includes(p.side) || typeof p.key !== "string" || !/^[a-z0-9-]{1,40}$/.test(p.key) || keys.has(p.key) || !cell(p)) throw new Error("Invalid actor placement");
    keys.add(p.key);
    const actor = Object.hasOwn(data.stock, p.id) ? data.stock[p.id] : undefined;
    if (!actor?.behavior.health || typeof p.deploy !== "boolean" || !["engage", "hold", "move"].includes(p.order ?? "engage")) throw new Error("Invalid placed actor or order");
    if (p.deploy && !actor.behavior.actions.some(a => a.id === "GrantConditionOnDeploy")) throw new Error("This actor cannot start deployed");
    if (p.order === "move" && (!actor.behavior.speed || !p.destination || !cell(p.destination))) throw new Error("Choose a mobile actor and a valid move destination");
    const faction = duelFaction(data, p.id, p.faction, mode);
    return { key: p.key, id: p.id, side: p.side, u: p.u, v: p.v, deploy: p.deploy, faction, ruleKey: actor.ruleKey, order: p.order ?? "engage", ...(p.destination ? { destination: { u: p.destination.u, v: p.destination.v } } : {}) };
  });
  for (const side of [0, 1]) {
    const team = placements.filter(p => p.side === side);
    if (!team.length || team.length > 6 || new Set(team.map(p => p.faction)).size !== 1) throw new Error("Each team needs one faction and one to six actors");
    if (new Set(team.map(p => data.stock[p.id].info?.domain === "naval")).size > 1) throw new Error("Use a separate coastline experiment for mixed land and naval actors on one team");
  }
  return placements;
}

export async function startDuel(webRoot: string, cfg: OriginalsConfig, input: unknown): Promise<Job> {
  if (running) throw new Error("An engine match is already running. Wait for it to finish.");
  if (!input || typeof input !== "object") throw new Error("Invalid duel");
  const r = input as DuelRequest;
  if (!["ra2", "classic"].includes(r.mode) || !Number.isInteger(r.gap) || r.gap < 4 || r.gap > 24 || ![0, 1, 2].includes(r.level)) throw new Error("Invalid mode, distance or veterancy");
  const data = await rosterPayload(r.mode === "classic" ? classicConfig(cfg) : cfg);
  const request: DuelRequest = { mode: r.mode, gap: r.gap, level: r.level, a: r.a, b: r.b };
  if (r.placements !== undefined) {
    request.placements = duelPlacements(r.placements, data, r.mode);
    for (const [side, n] of [["a", 0], ["b", 1]] as const) {
      const group = request.placements.filter(p => p.side === n);
      request[side] = { id: group[0].id, count: group.length, deploy: group[0].deploy, faction: group[0].faction, ruleKey: group[0].ruleKey };
    }
  }
  for (const side of ["a", "b"] as const) {
    const s = request[side];
    const actor = s && Object.hasOwn(data.stock, s.id) ? data.stock[s.id] : undefined;
    if (!actor?.behavior.health || !Number.isInteger(s.count) || s.count < 1 || s.count > 6 || typeof s.deploy !== "boolean") throw new Error("Pick a living actor and one to six units");
    if (s.health !== undefined && (!Number.isInteger(s.health) || s.health < 1 || s.health > 100000)) throw new Error("Invalid health experiment");
    if (s.deploy && !actor.behavior.actions.some(a => a.id === "GrantConditionOnDeploy")) throw new Error("This Arena supports condition deployment; actor transformations need a separate scenario.");
    request[side] = { id: s.id, ruleKey: actor.ruleKey, count: s.count, deploy: s.deploy, faction: duelFaction(data, s.id, s.faction, r.mode), ...(s.health ? { health: s.health } : {}) };
  }
  const navyA = data.stock[request.a.id].info?.domain === "naval", navyB = data.stock[request.b.id].info?.domain === "naval";
  request.waterSide = navyA && navyB ? "both" : navyA ? "a" : navyB ? "b" : "none";
  for (const p of request.placements ?? []) {
    for(const position of [p,...(p.destination?[p.destination]:[])]) {
    const water = request.waterSide === "both" || request.waterSide === "a" && position.u < 64 || request.waterSide === "b" && position.u >= 64;
    if (water !== (data.stock[p.id].info?.domain === "naval") && data.stock[p.id].info?.category !== "aircraft") throw new Error("Place land actors and move destinations on land, and ships on their team's water side");
    }
  }
  if (request.a.id === request.b.id && request.a.health !== request.b.health) throw new Error("Both copies of the same actor share an experimental health rule.");
  if (running) throw new Error("An engine match is already running. Wait for it to finish.");
  const id = randomUUID(), dir = resolve(webRoot, ".cache/studio-jobs", id);
  mkdirSync(dir, { recursive: true });
  const previewFile = resolve(webRoot, '.cache/unit-preview-latest.json');
  if (!existsSync(previewFile)) throw new Error('Build a local Studio preview before running an Encounter.');
  const preview = JSON.parse(readFileSync(previewFile, 'utf8')) as { native: string; revision: string };
  const current = JSON.parse(readFileSync(resolve(cfg.modRoot, 'mods/rtsai/unit-overrides/manifest.json'), 'utf8')) as { revision: string };
  if (preview.revision !== current.revision) { running = false; throw new Error('Build the current Studio revision before running an Encounter. Your saved edits are preserved.'); }
  writeFileSync(resolve(dir, "request.json"), JSON.stringify(request));
  const job: Job = { id, status: "running" }; jobs.set(id, job); running = true;
  // Keep memory bounded; prior results remain in the ignored local cache.
  for (const [key, value] of jobs) if (jobs.size > 40 && value.status !== "running") jobs.delete(key);
  const proc = spawn(process.env.RTSAI_STUDIO_PYTHON ?? "python", [resolve(webRoot, "../RTSAI-Art/tools/studio_duel.py"), resolve(dir, "request.json")], { cwd: webRoot, windowsHide: true, stdio: "ignore",
    env: { ...process.env, RTSAI_MOD_ROOT: cfg.modRoot, RTSAI_ENGINE_ROOT: preview.native, RTSAI_STUDIO_GAME_ROOT: preview.native,
      RTSAI_STUDIO_RUNTIME_RECEIPT: resolve(preview.native, '../receipt.json') } });
  const fail = (error: string) => { job.status = "failed"; job.error = error; running = false; };
  proc.once("error", e => fail(e.message));
  proc.once("exit", code => {
    running = false;
    const result = resolve(dir, "result.json"), error = resolve(dir, "error.json");
    try {
      if (code === 0 && existsSync(result)) { job.status = "complete"; job.result = { ...JSON.parse(readFileSync(result, "utf8")), contentRevision: preview.revision }; }
      else fail(existsSync(error) ? JSON.parse(readFileSync(error, "utf8")).error : `Engine job exited ${code}. Inspect .cache/studio-jobs/${id}.`);
    } catch { fail(`Unreadable engine result. Inspect .cache/studio-jobs/${id}.`); }
  });
  return { ...job };
}
export function duelJob(id: string, webRoot?: string): Job | null {
  const hit = jobs.get(id); if (hit) return hit;
  if (!webRoot || !/^[a-f0-9-]{36}$/.test(id)) return null;
  try { return { id, status: "complete", result: JSON.parse(readFileSync(resolve(webRoot, ".cache/studio-jobs", id, "result.json"), "utf8")) }; } catch { return null; }
}
