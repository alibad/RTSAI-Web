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
test("Classic default experience loads all ten countries and buildings", { skip: !existsSync(`${classic}/mods/ra/experiences.yaml`) }, () => {
  const data = loadClassicData({ text: p => readFileSync(`${classic}/${p}`, "utf8"), bytes: p => new Uint8Array(readFileSync(`${classic}/${p}`)), exists: p => existsSync(`${classic}/${p}`) });
  const { factions } = computeRosters(data);
  assert.equal(factions.length, 10);
  assert.ok(factions.some(f => f.id === "china"));
  assert.equal(factions.find(f => f.id === "england")?.name, "England");
  assert.equal(factions.find(f => f.id === "china")?.units.find(u => u.id === "cnqilin")?.origin, "new");
  assert.equal(factions.find(f => f.id === "england")?.units.find(u => u.id === "e1")?.name, "Rifle Infantry");
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


