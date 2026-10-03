/**
 * Publication guard: the Art Lab publishes a file only when ART-PROVENANCE.json records it, its bytes hash
 * to the recorded SHA-256, and its recorded origin is one of the project's own (generated or rendered
 * from project geometry). Anything else fails the sync, so no EA/RA2 game data can reach public/.
 */
import type { ProvenanceSummary } from "./types";

export type ProvenanceEntry = ProvenanceSummary & Record<string, unknown>;
export type ProvenanceRecord = {
  schemaVersion: number;
  generatedBy: string;
  commercialRa2Data?: string;
  summary?: { flags?: Record<string, unknown> };
  files: Record<string, ProvenanceEntry>;
};

export const PUBLISHABLE_ORIGINS = new Set(["generated", "procedural", "rendered-from-project-geometry"]);
export const PUBLISHABLE_GENERATORS = new Set(["qwen-image", "project-geometry", "forge-voxel"]);

export class ProvenanceError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Refusing to publish art that is not covered by ART-PROVENANCE.json:\n- ${problems.join("\n- ")}`);
  }
}

/**
 * @param keys files (relative to modern-factions) the resolved art references
 * @param sha256Of returns the SHA-256 of the file's current bytes
 */
export function assertPublishable(keys: Iterable<string>, record: ProvenanceRecord, sha256Of: (key: string) => string) {
  const problems: string[] = [];
  const flagged = Object.keys(record.summary?.flags ?? {});
  if (flagged.length) problems.push(`the provenance record flags files: ${flagged.join(", ")}`);
  const entries = new Map<string, ProvenanceEntry>();
  for (const key of keys) {
    if (key.includes("#") || key.includes("..") || key.startsWith("/")) { problems.push(`${key}: not a whole file inside modern-factions`); continue; }
    const entry = record.files[key];
    if (!entry) { problems.push(`${key}: referenced by the mod's rules or sequences but not recorded in ART-PROVENANCE.json`); continue; }
    if (!PUBLISHABLE_ORIGINS.has(entry.origin)) problems.push(`${key}: origin "${entry.origin}" is not publishable`);
    if (!PUBLISHABLE_GENERATORS.has(entry.generator)) problems.push(`${key}: generator "${entry.generator}" is not publishable`);
    if (entry.generator === "forge-voxel" && (entry.source?.repo !== "RTSAI-Art (local)" || !/^[a-f0-9]{7,40}$/.test(entry.source?.commit ?? "") || !/^units\/[a-z0-9]+\/candidates\/[a-z0-9-]+\//.test(entry.source?.path ?? "") || entry.source?.path?.includes("..") || entry.generation?.model !== "gpt-image-2.5-sunburst")) problems.push(`${key}: Forge source must identify the committed authored candidate and its image model`);
    const actual = sha256Of(key);
    if (actual !== entry.sha256) problems.push(`${key}: bytes (sha256 ${actual.slice(0, 12)}…) differ from the provenance record (${entry.sha256.slice(0, 12)}…)`);
    entries.set(key, entry);
  }
  if (problems.length) throw new ProvenanceError(problems);
  return entries;
}

export function summarizeProvenance(entry: ProvenanceEntry): ProvenanceSummary {
  const generation = entry.generation as ProvenanceSummary["generation"] | undefined;
  return {
    sha256: entry.sha256, type: entry.type, origin: entry.origin, generator: entry.generator,
    ...(entry.script ? { script: entry.script } : {}),
    ...(entry.geometry ? { geometry: entry.geometry } : {}),
    ...(entry.source ? { source: entry.source } : {}),
    ...(entry.tool ? { tool: entry.tool } : {}),
    ...(entry.date ? { date: entry.date } : {}),
    ...(generation ? { generation: { model: generation.model, model_revision: generation.model_revision, seed: generation.seed, variant: generation.variant, prompt: generation.prompt, subject: generation.subject, runtime: generation.runtime } } : {}),
    ...(entry.replaced ? { replaced: entry.replaced } : {}),
  };
}
