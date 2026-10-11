import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { boundedPath, sha256, verifyFrozenInput } from "./frozen-inputs.mjs";
import { loadModData, type ModReader } from "../lib/art-lab/resolve";
import { computeRosters, playableFactions } from "../lib/art-lab/roster";
import { behaviorFacts } from "../lib/art-lab/behavior";
import { child, childValue, traits } from "../lib/art-lab/miniyaml";

export function standalonePackagePath(reference: string) {
  const match = /^(ra2|rtsai|classic|rtsai-topdown|common)\|(.+)$/.exec(reference);
  if (!match || match[2].includes("\\") || match[2].split("/").some(part => !part || part === "." || part === "..")) throw new Error(`Unsupported standalone package: ${reference}`);
  const prefix = match[1] === "common" ? "engine/mods/common" : ["classic", "rtsai-topdown"].includes(match[1]) ? "mods/rtsai-topdown" : "mods/rtsai";
  return { path: `${prefix}/${match[2]}`, reason: null };
}
export function standaloneFacts(reader: ModReader) {
  return Object.fromEntries(["rtsai", "rtsai-topdown"].map(profile => {
    const data = loadModData(reader, { manifestPath: `mods/${profile}/mod.yaml`, resolvePackage: standalonePackagePath });
    const factions = playableFactions(data), rosters = computeRosters(data, factions);
    return [profile, { grid: childValue(child(data.manifest, "MapGrid")?.value, "Type"), factions: rosters.factions.map(faction => ({ ...faction, units: faction.units.map(unit => ({ ...unit, behavior: behaviorFacts(data, unit.id), waterPlacement: traits(data.rules.get(unit.id) ?? { value: null, nodes: [] }, "Building").some(([, trait]) => (childValue(trait.value, "TerrainTypes") ?? "").split(",").map(value => value.trim()).includes("Water")) })) })) }];
  }));
}
if (process.argv[1]?.endsWith("standalone-facts.ts")) {
  const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const mod = arg("mod"), engine = arg("engine"), modIdentity = arg("mod-identity"), engineIdentity = arg("engine-identity"), catalogPath = arg("catalog"), expectedCatalog = arg("catalog-sha256");
  if (!mod || !engine || !modIdentity || !engineIdentity || !catalogPath || !expectedCatalog) throw new Error("Provide --mod, --engine, both --*-identity, --catalog and --catalog-sha256; --check=<facts.json> is read-only, --out=<private output> stages facts explicitly");
  const modManifest = verifyFrozenInput(mod, modIdentity), engineManifest = verifyFrozenInput(engine, engineIdentity);
  const catalogBytes = readFileSync(catalogPath);
  if (sha256(catalogBytes) !== expectedCatalog) throw new Error("Catalog identity mismatch");
  const pathFor = (path: string) => path.startsWith("engine/") ? boundedPath(engine, path.slice(7)) : boundedPath(mod, path);
  const reader: ModReader = { text: path => readFileSync(pathFor(path), "utf8"), bytes: path => new Uint8Array(readFileSync(pathFor(path))), exists: path => { try { return existsSync(pathFor(path)); } catch { return false; } } };
  const facts = standaloneFacts(reader);
  for (const [profile, fact] of Object.entries(facts)) {
    if (fact.factions.length !== 16 || fact.factions.some(faction => !faction.units.length)) throw new Error(`Incomplete ${profile} standalone factions`);
    if (new Set(fact.factions.map(faction => faction.id)).size !== fact.factions.length) throw new Error("Duplicate faction");
  }
  const output = JSON.stringify({ schema: 1, source: { modIdentity, engineIdentity, catalogSha256: expectedCatalog, modHead: modManifest.head, enginePin: engineManifest.commit }, scope: "Standalone roster facts; independent of historical Art catalog and human approvals; local acceptance is not publication", profiles: facts }, null, 2) + "\n";
  const check = arg("check"), out = arg("out");
  if (Boolean(check) === Boolean(out)) throw new Error("Choose exactly one --check=<facts.json> or --out=<private output>");
  if (check && readFileSync(resolve(check), "utf8") !== output) throw new Error("Standalone facts stale");
  if (out) { if (existsSync(out)) throw new Error("Refusing to overwrite staged facts"); writeFileSync(resolve(out), output); }
  console.log(JSON.stringify({ status: check ? "read-only-check-pass" : "staged", profiles: Object.fromEntries(Object.entries(facts).map(([profile, fact]) => [profile, { grid: fact.grid, factions: fact.factions.length, units: fact.factions.reduce((total, faction) => total + faction.units.length, 0) }])), sha256: sha256(output) }));
}
