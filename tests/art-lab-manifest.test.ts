import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import manifest from "../data/art-lab.json";
import catalog from "../data/factions.generated.json";
import { assertPublishable, ProvenanceError, type ProvenanceRecord } from "../lib/art-lab/provenance";
import { loadModData, resolveArtLab, type ModReader } from "../lib/art-lab/resolve";
import type { ArtLabManifest } from "../lib/art-lab/types";

const web = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(web, "public/art-lab");
const data = manifest as unknown as ArtLabManifest;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const list = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? list(full) : [relative(publicDir, full).split(sep).join("/")];
});

test("manifest: seven factions, 124 buildable units, every one with a cameo and drawable art", () => {
  assert.deepEqual(data.factions.map(f => f.id), ["china", "iran", "turkey", "saudi", "yemen", "israel", "lebanon"]);
  assert.equal(Object.keys(data.actors).length, 124);
  for (const faction of data.factions) for (const id of faction.actors) {
    const actor = data.actors[id];
    assert.equal(actor.factionId, faction.id);
    assert.ok(actor.name && actor.name !== id, `${id} has a display name from the mod's Fluent text`);
    assert.ok(actor.cameo.file, `${id} has a published cameo`);
    if (actor.render === "voxel") {
      assert.ok(actor.voxel!.parts.length > 0 && actor.voxel!.parts.every(p => p.model.vxl && p.model.hva), `${id} voxel parts are published`);
      assert.ok(actor.voxel!.parts.every(p => p.model.problems.length === 0), `${id} has consistent VXL/HVA files`);
      assert.ok(data.palettes[actor.voxel!.palette]?.remap.length === 16, `${id} draws with a remappable player palette`);
    } else {
      assert.ok(actor.sprite!.sequences.some(s => s.file?.endsWith(".shp") && !s.inherited), `${id} has its own SHP sequences`);
      assert.ok(data.palettes[actor.sprite!.palette]?.remap.length === 16, `${id} draws with a remappable player palette`);
    }
    // Before the promotion the generator was looked up in OpenRA-AI's builders; the promoted art records how each
    // file was made (the RTSAI-Art candidate, its tool) in ART-PROVENANCE.json itself.
    assert.ok(actor.generator.length > 0 || actor.files.every(k => data.files[k]?.provenance.generator), `${id} records its generator`);
  }
});

test("manifest: catalog units link to the right actors and factions", () => {
  const units = catalog.catalog.units.filter(u => u.variants.ra2);
  for (const unit of units) {
    const actor = data.actors[unit.variants.ra2!.actorId];
    assert.ok(actor, `${unit.id} -> ${unit.variants.ra2!.actorId} exists in the Art Lab`);
    assert.equal(actor.catalogUnitId, unit.id);
    assert.equal(data.factions.find(f => f.id === actor.factionId)?.catalogId, unit.factionId);
  }
});

test("published files: exactly the manifest's files, byte-identical to their provenance records", () => {
  const present = list(publicDir).sort();
  assert.deepEqual(present, Object.keys(data.files).sort(), "public/art-lab holds nothing else");
  for (const [key, file] of Object.entries(data.files)) {
    const bytes = new Uint8Array(readFileSync(join(publicDir, key)));
    assert.equal(sha256(bytes), file.sha256, `${key} bytes`);
    assert.equal(file.provenance.sha256, file.sha256, `${key} matches ART-PROVENANCE.json`);
    assert.ok(["generated", "procedural", "rendered-from-project-geometry"].includes(file.provenance.origin), `${key} origin`);
    assert.equal(file.url, `/art-lab/${key}`);
  }
  const referenced = new Set(Object.values(data.actors).flatMap(a => a.files));
  for (const key of referenced) assert.ok(data.files[key], `${key} referenced and published`);
});

test("Levant binding: every Israel/Lebanon file outside ART-PROVENANCE.json carries checked evidence", () => {
  const binding = JSON.parse(readFileSync(join(web, "data/levant-art-binding.json"), "utf8"));
  assert.deepEqual(binding.summary.unbound, [], "nothing is published without evidence");
  const levantFiles = Object.entries(data.files).filter(([key]) => /(^israel-art\/|^lebanon-art\/|r2il|r2hz|r2merkava|r2namer)/.test(key));
  assert.ok(levantFiles.length >= 80, "both Levant packs are published");
  for (const [key, file] of levantFiles) {
    const bound = binding.files[key];
    // Since the promotion the mod's own record covers the Levant packs; a binding is only needed for a file it lacks.
    if (!bound || bound.sha256 !== file.sha256) {
      assert.ok(["procedural", "rendered-from-project-geometry"].includes(file.provenance.origin) && file.provenance.generator === "project-geometry", `${key} is recorded as project geometry`);
      continue;
    }
    assert.equal(bound.sha256, file.sha256, `${key} binding hash matches the published bytes`);
    assert.ok(["generator-record", "reproduced", "copy-of-recorded"].includes(bound.evidence), `${key} evidence`);
    assert.equal(bound.generator, "project-geometry", `${key} is project geometry`);
    if (bound.evidence === "copy-of-recorded") assert.ok(bound.copiedFrom && !binding.files[bound.copiedFrom], `${key} copies a file the mod records`);
  }
  assert.equal(data.mod.levantBinding?.files, levantFiles.filter(([key, file]) => binding.files[key]?.sha256 === file.sha256).length);
});

test("provenance guard: refuses unrecorded, altered, flagged or non-project files", () => {
  const record: ProvenanceRecord = {
    schemaVersion: 1, generatedBy: "test",
    files: {
      "voxels/a.vxl": { sha256: "aa", type: "VXL", origin: "rendered-from-project-geometry", generator: "project-geometry" },
      "icons/a.png": { sha256: "bb", type: "PNG", origin: "generated", generator: "qwen-image" },
      "voxels/ea.vxl": { sha256: "cc", type: "VXL", origin: "extracted", generator: "ra2-mix" },
    },
  };
  const hashes: Record<string, string> = { "voxels/a.vxl": "aa", "icons/a.png": "bb", "voxels/ea.vxl": "cc", "voxels/b.vxl": "dd" };
  const sha = (key: string) => hashes[key];
  assert.equal(assertPublishable(["voxels/a.vxl", "icons/a.png"], record, sha).size, 2);
  const refuse = (keys: string[], r = record, h = sha) => {
    try { assertPublishable(keys, r, h); } catch (error) { assert.ok(error instanceof ProvenanceError); return error.problems.join("\n"); }
    assert.fail(`published ${keys.join(", ")}`);
  };
  assert.match(refuse(["voxels/b.vxl"]), /not recorded in ART-PROVENANCE\.json/);
  assert.match(refuse(["voxels/a.vxl"], record, () => "ff"), /differ from the provenance record/);
  assert.match(refuse(["voxels/ea.vxl"]), /origin "extracted" is not publishable/);
  assert.match(refuse(["../uibits/buttons.png#china"]), /not a whole file/);
  assert.match(refuse(["voxels/a.vxl"], { ...record, summary: { flags: { "voxels/a.vxl": "suspect" } } }), /flags files/);
});

test("resolver: art outside modern-factions is recorded as external, never published", () => {
  const files: Record<string, string | Uint8Array> = {
    "mods/rtsai/mod.yaml": "Rules:\n\tra2|rules/r.yaml\nSequences:\n\tra2|sequences/s.yaml\nModelSequences:\n\tra2|sequences/v.yaml\nFluentMessages:\n\tra2|f.ftl\n",
    "mods/rtsai/rules/r.yaml": [
      "World:", "\tFaction@c:", "\t\tName: c-name", "\t\tInternalName: china", ...["iran", "turkey", "saudi", "yemen", "israel", "lebanon"].flatMap(f => [`\tFaction@${f}:`, `\t\tInternalName: ${f}`]),
      "\tPaletteFromFile@p:", "\t\tName: p", "\t\tFilename: ra2|modern-factions/x.pal",
      "\tPlayerColorPalette@p:", "\t\tBasePalette: p", "\t\tBaseName: pp", "\t\tRemapIndex: 16, 17",
      "^Inf:", "\tWithInfantryBody:", "\tRenderSprites:", "\t\tPlayerPalette: pp",
      "solder:", "\tInherits: ^Inf", "\tTooltip:", "\t\tName: s-name", "\tBuildable:", "\t\tQueue: Infantry", "\t\tPrerequisites: ~faction.china",
    ].join("\n") + "\n",
    "mods/rtsai/sequences/s.yaml": "^Mc:\n\tmindcontrol:\n\t\tFilename: yuricntl.shp\nsolder:\n\tInherits: ^Mc\n\tstand:\n\t\tFilename: ra2|modern-factions/a.shp\n\ticon:\n\t\tFilename: ra2|modern-factions/a.png\n",
    "mods/rtsai/sequences/v.yaml": "",
    "mods/rtsai/f.ftl": "s-name = Soldier\nc-name = China\n",
    "mods/rtsai/modern-factions/x.pal": new Uint8Array(768),
    "mods/rtsai/modern-factions/a.png": new Uint8Array(4),
    "mods/rtsai/modern-factions/a.shp": new Uint8Array([0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32, 0, 0, 0, 7]),
  };
  const reader: ModReader = {
    text: p => String(files[p]), bytes: p => files[p] as Uint8Array, exists: p => p in files,
  };
  const resolution = resolveArtLab(reader, loadModData(reader));
  const soldier = resolution.actors.solder;
  assert.equal(soldier.name, "Soldier");
  assert.equal(soldier.category, "infantry");
  const external = soldier.sprite!.sequences.find(s => s.name === "mindcontrol")!;
  assert.equal(external.file, null);
  assert.match(external.external!.reason, /RA2 game data/);
  assert.deepEqual([...resolution.files.keys()].sort(), ["a.png", "a.shp", "x.pal"], "only modern-faction files are candidates for publication");
  // A file the rules reference but the provenance record lacks stops the sync.
  assert.throws(() => assertPublishable(resolution.files.keys(), { schemaVersion: 1, generatedBy: "t", files: {} }, () => ""), ProvenanceError);
});

test("sync:art --check: the committed copy matches the sibling RTSAI-Mod (skipped without the checkout)", { skip: !existsSync(join(web, "../RTSAI-Mod/mods/rtsai/mod.yaml")) }, () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/sync-mod-art.mjs", "--check"], { cwd: web, encoding: "utf8" });
  assert.match(output, /124 actors in 7 factions/);
});
