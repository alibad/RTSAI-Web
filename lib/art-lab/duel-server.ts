/** Local headless engine jobs. No shell, AI calls, repository edits or external requests. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { classicConfig, rosterPayload, type OriginalsConfig, type RosterPayload } from "./originals";

export type DuelSide = { id: string; count: number; deploy: boolean; health?: number; faction?: string; ruleKey?: string };
export type DuelRequest = { mode: "ra2" | "classic"; a: DuelSide; b: DuelSide; gap: number; level: number; waterSide?: "none" | "a" | "b" | "both" };
export type DuelSample = { tick: number; actors: { side: number; index: number; x: number; y: number; z: number; facing: number; health: number; maxHealth: number }[]; wrecks?: { side: number; type: string; x: number; y: number; z: number; facing: number }[] };
export type DuelResult = { evidence: "measured"; engine: string; request: DuelRequest; ticksPerSecond: number; samples: DuelSample[]; events?: { tick: number; kind: string; side: number; index: number; attackerSide: number; attackerIndex: number; damage: number }[]; effects?: { kind: "crash"; tick: number; side: number; type: string; x: number; y: number; z: number }[]; limitations: string };
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

export async function startDuel(webRoot: string, cfg: OriginalsConfig, input: unknown): Promise<Job> {
  if (running) throw new Error("An engine match is already running. Wait for it to finish.");
  if (!input || typeof input !== "object") throw new Error("Invalid duel");
  const r = input as DuelRequest;
  if (!["ra2", "classic"].includes(r.mode) || !Number.isInteger(r.gap) || r.gap < 4 || r.gap > 24 || ![0, 1, 2].includes(r.level)) throw new Error("Invalid mode, distance or veterancy");
  const data = await rosterPayload(r.mode === "classic" ? classicConfig(cfg) : cfg);
  const request: DuelRequest = { mode: r.mode, gap: r.gap, level: r.level, a: r.a, b: r.b };
  for (const side of ["a", "b"] as const) {
    const s = r[side];
    const actor = s && Object.hasOwn(data.stock, s.id) ? data.stock[s.id] : undefined;
    if (!actor?.behavior.health || !Number.isInteger(s.count) || s.count < 1 || s.count > 6 || typeof s.deploy !== "boolean") throw new Error("Pick a living actor and one to six units");
    if (s.health !== undefined && (!Number.isInteger(s.health) || s.health < 1 || s.health > 100000)) throw new Error("Invalid health experiment");
    if (s.deploy && !actor.behavior.actions.some(a => a.id === "GrantConditionOnDeploy")) throw new Error("This Arena supports condition deployment; actor transformations need a separate scenario.");
    request[side] = { id: s.id, ruleKey: actor.ruleKey, count: s.count, deploy: s.deploy, faction: duelFaction(data, s.id, s.faction, r.mode), ...(s.health ? { health: s.health } : {}) };
  }
  const navyA = data.stock[request.a.id].info?.domain === "naval", navyB = data.stock[request.b.id].info?.domain === "naval";
  request.waterSide = navyA && navyB ? "both" : navyA ? "a" : navyB ? "b" : "none";
  if (request.a.id === request.b.id && request.a.health !== request.b.health) throw new Error("Both copies of the same actor share an experimental health rule.");
  if (running) throw new Error("An engine match is already running. Wait for it to finish.");
  const id = randomUUID(), dir = resolve(webRoot, ".cache/studio-jobs", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, "request.json"), JSON.stringify(request));
  const job: Job = { id, status: "running" }; jobs.set(id, job); running = true;
  // Keep memory bounded; prior results remain in the ignored local cache.
  for (const [key, value] of jobs) if (jobs.size > 40 && value.status !== "running") jobs.delete(key);
  const proc = spawn(process.env.RTSAI_STUDIO_PYTHON ?? "python", [resolve(webRoot, "../RTSAI-Art/tools/studio_duel.py"), resolve(dir, "request.json")], { cwd: webRoot, windowsHide: true, stdio: "ignore" });
  const fail = (error: string) => { job.status = "failed"; job.error = error; running = false; };
  proc.once("error", e => fail(e.message));
  proc.once("exit", code => {
    running = false;
    const result = resolve(dir, "result.json"), error = resolve(dir, "error.json");
    try {
      if (code === 0 && existsSync(result)) { job.status = "complete"; job.result = JSON.parse(readFileSync(result, "utf8")); }
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
