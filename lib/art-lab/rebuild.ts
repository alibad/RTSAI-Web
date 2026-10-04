/** Summary of the local full rebuild campaign. No art bytes or original file routes. */
export type RebuildGate = { state: "pending" | "pass" | "fail"; evidence: string[] };
export type RebuildActor = { key: string; mode: "ra2" | "classic"; actor: string; name: string; category: string; domain: string; factions: string[]; roles: string[]; cost: number | null; origin: string; gates: Record<string, RebuildGate>; rebuild: { evidence: "inferred"; requiredObservations: string[]; dependencyAudit: string } };
export type RebuildFaction = { key: string; mode: "ra2" | "classic"; id: string; name: string; side: string; actors: string[]; categories: Record<string, number> };
export type BaselineCounts = { recorded: number; failed: number; withDamage: number; total: number };
export type RebuildCampaign = { schemaVersion: 1; modes: Record<"ra2" | "classic", { factions: number; actors: number; categories: Record<string, number>; supportingActors?: number; sourceCommit: string }>; factions: RebuildFaction[]; actors: Record<string, RebuildActor>; nativeBaseline?: Record<"ra2" | "classic", BaselineCounts> };

type NativeBaseline = { runnerSha256: string; actors: Record<string, { status: string; baselineSha256: string; damageEvents?: number }> };
/** A recording is not a pass on art, complete action coverage, or balance. Stale recordings are excluded. */
export function baselineCounts(catalog: RebuildCampaign, native: NativeBaseline | null, runnerSha256: string) {
  const result = Object.fromEntries((["ra2", "classic"] as const).map(mode => [mode, { recorded: 0, failed: 0, withDamage: 0, total: catalog.modes[mode].actors }])) as Record<"ra2" | "classic", BaselineCounts>;
  if (native?.runnerSha256 !== runnerSha256) return result;
  for (const [key, recording] of Object.entries(native.actors)) {
    const actor = catalog.actors[key] as RebuildActor & { baselineSha256?: string };
    if (!actor || !actor.baselineSha256 || actor.baselineSha256 !== recording.baselineSha256) continue;
    if (recording.status === "complete") { result[actor.mode].recorded++; if (recording.damageEvents) result[actor.mode].withDamage++; }
    else if (recording.status === "failed") result[actor.mode].failed++;
  }
  return result;
}

export function rebuildSummary(catalog: RebuildCampaign): RebuildCampaign {
  return { schemaVersion: 1, modes: catalog.modes, factions: catalog.factions, actors: Object.fromEntries(Object.entries(catalog.actors).map(([key, a]) => [key, {
    key: a.key, mode: a.mode, actor: a.actor, name: a.name, category: a.category, domain: a.domain, factions: a.factions, roles: a.roles, cost: a.cost, origin: a.origin, gates: a.gates, rebuild: a.rebuild,
  }])) };
}

export const rebuildComplete = (actor: RebuildActor) => ["design", "model", "icon", "actions", "visual", "native_encounters", "balance", "owner"].every(key => actor.gates[key]?.state === "pass" && actor.gates[key].evidence.length > 0);
