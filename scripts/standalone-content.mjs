import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256 } from "./frozen-inputs.mjs";

export function standaloneSnapshot(catalogInput, facts, factsSha256, catalogSha256) {
  if (facts.schema !== 1 || facts.source.catalogSha256 !== catalogSha256) throw new Error("Standalone/catalog provenance mismatch");
  const catalog = structuredClone(catalogInput);
  for (const faction of catalog.factions) delete faction.flavour;
  const rosters = { sources: {}, factions: [], actors: [] };
  const unitsByMode = new Map();
  for (const [profile, mode] of [["rtsai", "ra2"], ["rtsai-topdown", "ra"]]) {
    const data = facts.profiles[profile];
    if (!data || data.factions.length !== 16) throw new Error(`Incomplete ${profile}`);
    rosters.sources[mode] = { commit: facts.source.modHead, snapshotSha256: factsSha256, sourceIdentity: facts.source.modIdentity, profile, grid: data.grid };
    const actors = new Map();
    for (const faction of data.factions) {
      const keys = faction.units.map(unit => `${mode}:${unit.id}`);
      if (!keys.length || new Set(keys).size !== keys.length) throw new Error("Invalid faction roster");
      rosters.factions.push({ id: faction.id, mode, name: faction.name, side: faction.side, actors: keys });
      for (const unit of faction.units) {
        const actor = { key: `${mode}:${unit.id}`, id: unit.id, mode, name: unit.name, category: unit.category, cost: unit.cost, roles: unit.roles, behavior: { health: unit.behavior.health, armor: unit.behavior.armor, speed: unit.behavior.speed, footprint: unit.behavior.footprint, waterPlacement: unit.category === "ship" || unit.waterPlacement, description: unit.behavior.description, weapons: unit.behavior.weapons, actions: unit.behavior.actions, targetTypes: unit.behavior.targetTypes } };
        if (actors.has(actor.id) && JSON.stringify(actors.get(actor.id)) !== JSON.stringify(actor)) throw new Error(`Conflicting actor ${actor.id}`);
        actors.set(actor.id, actor);
      }
    }
    unitsByMode.set(mode, actors);
    rosters.actors.push(...actors.values());
  }
  for (const unit of catalog.units) for (const mode of ["ra", "ra2"]) {
    const variant = unit.variants[mode] ?? (mode === "ra" ? unit.variants.ra2 : undefined);
    if (!variant) continue;
    const roster = rosters.factions.find(faction => faction.mode === mode && faction.id === (unit.factionId === "saudi-arabia" ? "saudi" : unit.factionId));
    const candidates = [variant.actorId, unit.variants.ra2?.actorId].filter(Boolean).map(id => id.toLowerCase());
    const id = candidates.find(id => roster?.actors.includes(`${mode}:${id}`));
    const actor = id && unitsByMode.get(mode).get(id);
    if (!actor) throw new Error(`Signature actor missing from actual faction: ${unit.id}/${mode}`);
    const factUnit = facts.profiles[mode === "ra" ? "rtsai-topdown" : "rtsai"].factions.find(faction => faction.id === roster.id).units.find(value => value.id === id);
    unit.variants[mode] = { ...variant, actorId: actor.id, name: actor.name, repository: "mod", rulesPath: factUnit.behavior.source };
  }
  return { source: "OpenRA-AI/catalog/factions.json", sha256: catalogSha256, derivation: { type: "standalone-frozen-facts", factsSha256, modIdentity: facts.source.modIdentity, engineIdentity: facts.source.engineIdentity, catalogPreserved: true, humanReview: "not-modified" }, catalog, rosters };
}
if (process.argv[1]?.endsWith("standalone-content.mjs")) {
  const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const factsPath = arg("facts"), expectedFacts = arg("facts-sha256"), catalogPath = arg("catalog"), expectedCatalog = arg("catalog-sha256");
  if (!factsPath || !expectedFacts || !catalogPath || !expectedCatalog) throw new Error("Provide frozen facts and catalog paths and SHA256 values");
  const factsBytes = readFileSync(factsPath), catalogBytes = readFileSync(catalogPath);
  if (sha256(factsBytes) !== expectedFacts || sha256(catalogBytes) !== expectedCatalog) throw new Error("Input hash mismatch");
  const output = JSON.stringify(standaloneSnapshot(JSON.parse(catalogBytes), JSON.parse(factsBytes), expectedFacts, expectedCatalog), null, 2) + "\n";
  const out = arg("out"), check = arg("check");
  if (Boolean(out) === Boolean(check)) throw new Error("Choose --out=<new private staged file> or read-only --check=<imported snapshot>");
  if (out) { if (existsSync(out)) throw new Error("Refusing to overwrite staged content"); writeFileSync(resolve(out), output); }
  if (check && readFileSync(check, "utf8") !== output) throw new Error("Standalone website snapshot is stale");
  console.log(JSON.stringify({ status: check ? "read-only-check-pass" : "staged", sha256: sha256(output) }));
}
