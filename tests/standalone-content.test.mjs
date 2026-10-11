import assert from "node:assert/strict";
import test from "node:test";
import { standaloneSnapshot } from "../scripts/standalone-content.mjs";

function inputs() {
  const unit = { id: "r2fixture", name: "Rule-derived fixture name", category: "structure", cost: 500, roles: ["support"], waterPlacement: true, behavior: { health: 1000, armor: "Steel", speed: null, footprint: "2,2", description: "Fixture rule description", weapons: [], actions: [], targetTypes: ["Building"], source: "mods/rtsai/fixture.yaml" } };
  const factions = Array.from({ length: 16 }, (_, index) => ({ id: index === 0 ? "fixture" : `country${index}`, name: `Rule faction ${index}`, side: "Fixture", units: [unit] }));
  const catalog = { factions: [{ id: "fixture", flavour: { privateVoiceIdea: "exclude" } }], units: [{ id: "signature", factionId: "fixture", variants: { ra: { actorId: "OLD", name: "Historical" }, ra2: { actorId: "r2fixture", name: "Catalog" } } }] };
  const facts = { schema: 1, source: { catalogSha256: "catalog", modIdentity: "mod", modHead: "head", engineIdentity: "engine" }, profiles: { rtsai: { grid: "RectangularIsometric", factions }, "rtsai-topdown": { grid: "Rectangular", factions } } };
  return { catalog, facts };
}
test("standalone staging reconciles signature IDs and names from actual faction facts without mutating historical inputs", () => {
  const { catalog, facts } = inputs();
  const before = JSON.stringify({ catalog, facts });
  const snapshot = standaloneSnapshot(catalog, facts, "facts", "catalog");
  assert.equal(snapshot.catalog.units[0].variants.ra.actorId, "r2fixture");
  assert.equal(snapshot.catalog.units[0].variants.ra.name, "Rule-derived fixture name");
  assert.equal(snapshot.catalog.units[0].variants.ra.repository, "mod");
  assert.equal(snapshot.catalog.factions[0].flavour, undefined);
  assert.equal(snapshot.rosters.factions.length, 32);
  assert.equal(snapshot.rosters.actors.length, 2);
  assert.equal(snapshot.rosters.actors[0].behavior.waterPlacement, true);
  assert.equal(snapshot.derivation.humanReview, "not-modified");
  assert.equal(JSON.stringify({ catalog, facts }), before);
});
test("standalone staging fails missing ownership, conflicting actor facts and mismatched catalog provenance", () => {
  const { catalog, facts } = inputs();
  assert.throws(() => standaloneSnapshot(catalog, facts, "facts", "wrong"), /provenance/);
  catalog.units[0].factionId = "absent";
  assert.throws(() => standaloneSnapshot(catalog, facts, "facts", "catalog"), /missing/);
  catalog.units[0].factionId = "fixture";
  facts.profiles.rtsai.factions[1] = structuredClone(facts.profiles.rtsai.factions[1]);
  facts.profiles.rtsai.factions[1].units[0].cost = 999;
  assert.throws(() => standaloneSnapshot(catalog, facts, "facts", "catalog"), /Conflicting/);
});

test("actual ownership adds a formerly absent Classic signature variant without assuming release availability", () => {
  const { catalog, facts } = inputs();
  delete catalog.units[0].variants.ra;
  const snapshot = standaloneSnapshot(catalog, facts, "facts", "catalog");
  assert.equal(snapshot.catalog.units[0].variants.ra.actorId, "r2fixture");
  assert.equal(catalog.units[0].variants.ra, undefined);
  assert.equal(snapshot.catalog.units[0].variants.ra.name, "Rule-derived fixture name");
});
