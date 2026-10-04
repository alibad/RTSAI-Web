import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { decodeShp } from "../lib/art-lab/shp";
import { behaviorFacts } from "../lib/art-lab/behavior";
import { loadModData } from "../lib/art-lab/resolve";
import { loadClassicData } from "../lib/art-lab/classic";
import { computeRosters } from "../lib/art-lab/roster";
import { assertPublishable, type ProvenanceRecord } from "../lib/art-lab/provenance";
import { duelFaction } from "../lib/art-lab/duel-server";
import { baselineCounts, rebuildComplete, rebuildSummary, type RebuildCampaign } from "../lib/art-lab/rebuild";
import { rebuildDependencies } from "../lib/art-lab/rebuild-dependencies";

test("rebuild dependencies follow wrecks, transformations and weapon effects without image access", () => {
  const files: Record<string, string> = {
    "mods/rtsai/mod.yaml": "Rules:\n\tra2|rules/test.yaml\nWeapons:\n\tra2|weapons/test.yaml\nSequences:\n\tra2|sequences/test.yaml\n",
    "mods/rtsai/rules/test.yaml": "air:\n\tRenderSprites:\n\tSpawnActorOnDeath:\n\t\tActor: wreck\n\tArmament:\n\t\tWeapon: Gun\nwreck:\n\tRenderSprites:\n\tTransforms:\n\t\tIntoActor: air\n\tFallsToEarth:\n\t\tExplosion: Gun\n",
    "mods/rtsai/weapons/test.yaml": "Gun:\n\tProjectile: Bullet\n\t\tImage: projectile\n\tWarhead@1: CreateEffect\n\t\tImage: impact\n",
    "mods/rtsai/sequences/test.yaml": "air:\n\tidle:\nwreck:\n\tidle:\nprojectile:\n\tidle:\nimpact:\n\texplode:\n",
  };
  const data = loadModData({ text: p => files[p], exists: p => p in files, bytes: () => { throw new Error("pixels forbidden"); } });
  const graph = rebuildDependencies(data, ["air"]);
  assert.equal(graph.actors.wreck.buildable, false);
  assert.equal(graph.actors.air.buildable, true);
  assert.deepEqual(Object.keys(graph.actors), ["air", "wreck"], "cycles terminate");
  assert.equal(graph.weapons.gun.projectile, "Bullet");
  assert.deepEqual(graph.images.impact.sequences, ["explode"]);
});

test("native encounters use a faction that really builds each actor", () => {
  const unit = (id: string) => ({ id } as never);
  const data = { factions: [{ id: "america", units: [unit("e1")] }, { id: "china", units: [unit("r2qilin"), unit("e1")] }, { id: "france", units: [unit("e1")] }] } as never;
  assert.equal(duelFaction(data, "r2qilin", undefined, "ra2"), "china");
  assert.equal(duelFaction(data, "e1", undefined, "ra2"), "america");
  assert.equal(duelFaction(data, "e1", "france", "ra2"), "france");
  assert.throws(() => duelFaction(data, "r2qilin", "america", "ra2"), /cannot build/);
  assert.throws(() => duelFaction(data, "not-an-actor", undefined, "ra2"), /No faction/);
});

test("rebuild discovery never counts as completed art; summaries omit the image contracts", () => {
  const gates = Object.fromEntries(["design", "model", "icon", "actions", "visual", "native_encounters", "balance", "owner"].map(g => [g, { state: "pending", evidence: [] }]));
  const catalog = { schemaVersion: 1, modes: {}, factions: [], actors: { "classic:e1": { key: "classic:e1", mode: "classic", actor: "e1", gates, currentContract: { originalUrl: "/local-only" }, rebuild: { evidence: "inferred", requiredObservations: [], dependencyAudit: "pending" } } } } as unknown as RebuildCampaign;
  assert.equal(rebuildComplete(catalog.actors["classic:e1"]), false);
  assert.equal("currentContract" in rebuildSummary(catalog).actors["classic:e1"], false);
  for (const g of Object.values(catalog.actors["classic:e1"].gates)) g.state = "pass";
  assert.equal(rebuildComplete(catalog.actors["classic:e1"]), false, "a pass needs evidence");
  for (const g of Object.values(catalog.actors["classic:e1"].gates)) g.evidence.push("local-reviewed-artifact");
  assert.equal(rebuildComplete(catalog.actors["classic:e1"]), true);
});

test("native progress excludes stale actors and runner changes, and counts recordings rather than victories", () => {
  const catalog = { modes: { classic: { actors: 2 }, ra2: { actors: 1 } }, actors: { "classic:e1": { mode: "classic", baselineSha256: "a" }, "classic:e2": { mode: "classic", baselineSha256: "b" }, "ra2:e1": { mode: "ra2", baselineSha256: "c" } } } as unknown as RebuildCampaign;
  const native = { runnerSha256: "runner", actors: { "classic:e1": { status: "complete", baselineSha256: "a", damageEvents: 0 }, "classic:e2": { status: "complete", baselineSha256: "old", damageEvents: 5 }, "ra2:e1": { status: "failed", baselineSha256: "c" } } };
  assert.deepEqual(baselineCounts(catalog, native, "runner"), { classic: { recorded: 1, failed: 0, withDamage: 0, total: 2 }, ra2: { recorded: 0, failed: 1, withDamage: 0, total: 1 } });
  assert.equal(baselineCounts(catalog, native, "changed").classic.recorded, 0);
});

test("Classic LCW base and previous-frame XOR decode through the shared sprite loader", () => {
  const b = new Uint8Array(49), v = new DataView(b.buffer);
  v.setUint16(0, 2, true); v.setUint16(6, 2, true); v.setUint16(8, 1, true);
  v.setUint32(14, 46 | 0x80000000, true); v.setUint32(22, 50 | 0x20000000, true);
  // Resize to include both encoded frames, then bind EOF to the actual length.
  const bytes = new Uint8Array(55); bytes.set(b); const h = new DataView(bytes.buffer);
  h.setUint32(30, bytes.length, true);
  bytes.set([0x82, 7, 8, 0x80], 46); bytes.set([1, 3, 0x80, 0, 0], 50);
  const shp = decodeShp(bytes);
  assert.deepEqual([...shp.frames[0].pixels], [7, 8]);
  assert.deepEqual([...shp.frames[1].pixels], [4, 8]);
  h.setUint32(14, 46 | 0x40000000, true); h.setUint16(18, 46, true);
  assert.throws(() => decodeShp(bytes), /reference/);
});

test("configured weapon targets include engine defaults and damage is not labelled measured", () => {
  const files: Record<string, string> = {
    "mods/rtsai/mod.yaml": "Rules:\n\tra2|rules/test.yaml\nWeapons:\n\tra2|weapons/test.yaml\n",
    "mods/rtsai/rules/test.yaml": "test:\n\tHealth:\n\t\tHP: 200\n\tArmament:\n\t\tWeapon: Gun\n",
    "mods/rtsai/weapons/test.yaml": "Gun:\n\tRange: 5c512\n\tWarhead@1: SpreadDamage\n\t\tDamage: 40\n",
  };
  const d = loadModData({ text: p => files[p], exists: p => p in files, bytes: () => new Uint8Array() });
  const facts = behaviorFacts(d, "test");
  assert.equal(facts.evidence, "configured"); assert.equal(facts.weapons[0].range, 5.5);
  assert.deepEqual(facts.weapons[0].targets, ["Ground", "Water"]); assert.equal(facts.weapons[0].damage, 40);
});

const classic = fileURLToPath(new URL("../../OpenRA/", import.meta.url));
test("Classic default experience loads current countries and buildings", { skip: !existsSync(`${classic}/mods/ra/experiences.yaml`) }, () => {
  const data = loadClassicData({ text: p => readFileSync(`${classic}/${p}`, "utf8"), bytes: p => new Uint8Array(readFileSync(`${classic}/${p}`)), exists: p => existsSync(`${classic}/${p}`) });
  const { factions } = computeRosters(data);
  for (const id of ["china", "israel", "hezbollah", "england", "ukraine"]) assert.ok(factions.some(f => f.id === id), `${id} is in the actual roster`);
  assert.ok(factions.some(f => f.id === "china"));
  assert.equal(factions.find(f => f.id === "england")?.name, "England");
  assert.equal(factions.find(f => f.id === "china")?.units.find(u => u.id === "cnqilin")?.origin, "new");
  assert.equal(factions.find(f => f.id === "england")?.units.find(u => u.id === "e1")?.name, "Rifle Infantry");
  assert.equal(factions.find(f => f.id === "england")?.units.find(u => u.id === "pbox")?.category, "defense");
  assert.equal(data.ruleKeys.get("afld.ukraine"), "AFLD.Ukraine", "map overrides must retain exact rule key case");
  assert.ok(factions.every(f => f.units.some(u => u.category === "structure")));
  assert.ok(behaviorFacts(data, "yak").actions.some(a => a.label === "Falling wreck"));
});

test("Forge publication requires bound committed authorship plus unchanged bytes", () => {
  const entry = { sha256: "aa", type: "VXL", origin: "rendered-from-project-geometry", generator: "forge-voxel", source: { repo: "RTSAI-Art (local)", commit: "6ac68b6", path: "units/r2qilin/candidates/voxel-v4-ra2-jade/r2qilin.vxl" }, generation: { model: "gpt-image-2.5-sunburst", seed: 0, variant: 0, prompt: "Authored test fixture" } };
  const record = { schemaVersion: 1, generatedBy: "test", files: { "voxels/q.vxl": entry } } as ProvenanceRecord;
  assert.equal(assertPublishable(["voxels/q.vxl"], record, () => "aa").size, 1);
  assert.throws(() => assertPublishable(["voxels/q.vxl"], { ...record, files: { "voxels/q.vxl": { ...entry, source: { ...entry.source, path: "../original.vxl" } } } }, () => "aa"), /Forge source/);
  assert.throws(() => assertPublishable(["voxels/q.vxl"], record, () => "bb"), /differ/);
});


