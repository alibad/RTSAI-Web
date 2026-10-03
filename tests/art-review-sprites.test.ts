import assert from "node:assert/strict";
import test from "node:test";
import { candidateRenderSpec, candidateVehicleSprite, declaredTurretOffset, parseCandidateRules, type Candidate } from "../lib/art-lab/review";
import { artLab, renderSpec } from "../lib/art-lab/manifest";
import { pickAnimation, turretSequence } from "../lib/art-lab/sprite-anim";

// The shape of the Forge's openra-snippet.yaml for a pre-rendered vehicle sprite (r2qilin sprite-v1).
const snippet = [
  "^Palettes:", "\tPaletteFromFile@r2qilin-sprite:", "\t\tName: r2qilin-sprite", "\t\tFilename: ra2|modern-factions/china-art/r2qilin-sprite.pal", "\t\tShadowIndex: 1",
  "\tPlayerColorPalette@r2qilin-sprite:", "\t\tBasePalette: r2qilin-sprite", "\t\tBaseName: r2qilin-spriteplayer", "\t\tRemapIndex: 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31",
  "r2qilin:", "\t-RenderVoxels:", "\t-WithVoxelBody:", "\t-WithVoxelTurret:", "\tRenderSprites:", "\t\tPlayerPalette: r2qilin-spriteplayer",
  "\tWithFacingSpriteBody:", "\tWithSpriteTurret:", "\tBodyOrientation:", "\t\tQuantizedFacings: 32", "\tTurreted:", "\t\tOffset: -45,0,0",
  "r2qilin:", "\tidle:", "\t\tFilename: ra2|modern-factions/china-art/r2qilin.shp", "\t\tFacings: 32", "\t\tShadowStart: 32",
  "\tturret:", "\t\tFilename: ra2|modern-factions/china-art/r2qilin.shp", "\t\tStart: 64", "\t\tFacings: 32", "\t\tShadowStart: 96",
].join("\n");

const spriteCandidate = (rulesText: string | null): Candidate => ({
  id: "sprite-v1", actor: "r2qilin", createdAt: "2026-10-03T10:00:00Z", kind: "sprite", dir: "", rulesText,
  urls: { "r2qilin.shp": "/x/r2qilin.shp", "r2qilin-sprite.pal": "/x/r2qilin-sprite.pal", "openra-snippet.yaml": "/x/openra-snippet.yaml" },
  files: { shp: ["r2qilin.shp"], pal: "r2qilin-sprite.pal", rules: "openra-snippet.yaml" },
  sprite: {
    shp: "r2qilin.shp", facings: 32,
    sequences: { idle: { start: 0, facings: 32, shadowStart: 32, usedBy: "WithFacingSpriteBody" }, turret: { start: 64, facings: 32, shadowStart: 96, usedBy: "WithSpriteTurret (Turreted 'primary')" } },
    turret: { sequence: "turret", name: "primary", offset: [-45, 0, 0] },
    palette: { transparent: [0], shadow: [1], remap: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31] },
  },
});

test("the candidate's rules snippet is read with MiniYaml: sequences, Turreted.Offset, palette and trait changes", () => {
  const rules = parseCandidateRules(snippet, "r2qilin");
  assert.deepEqual(rules.sequences.idle, { file: "r2qilin.shp", start: 0, length: 1, facings: 32, shadowStart: 32, offset: [0, 0, 0], tick: 40 });
  assert.equal(rules.sequences.turret.start, 64);
  assert.equal(rules.sequences.turret.shadowStart, 96);
  assert.deepEqual(rules.turretOffset, [-45, 0, 0]);
  assert.deepEqual(rules.palette, { transparent: [0], shadow: [1], remap: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31] });
  assert.deepEqual(rules.removed, ["RenderVoxels", "WithVoxelBody", "WithVoxelTurret"]);
  assert.ok(rules.traits.includes("WithFacingSpriteBody") && rules.traits.includes("WithSpriteTurret"));
});

test("a vehicle sprite candidate draws body + turret with shadows from the declared layout, never guessed", () => {
  const current = renderSpec(artLab.actors.r2qilin);
  for (const rulesText of [snippet, null]) {
    const built = candidateVehicleSprite(current, spriteCandidate(rulesText))!;
    assert.ok(built, rulesText ? "from the snippet" : "from meta.sprite");
    assert.equal(built.layoutSource, rulesText ? "openra-snippet.yaml" : "meta.sprite");
    assert.equal(built.spec.voxel, null, "drawn as a sprite, not a voxel");
    assert.deepEqual(built.spec.palette!.shadow, [1], "shadow index 1 draws black at alpha 140");
    assert.equal(built.spec.palette!.url, "/x/r2qilin-sprite.pal");
    assert.deepEqual(built.sprite.turret!.offset, [-45, 0, 0]);
    const body = pickAnimation(built.sprite, "stand")!.body!;
    assert.deepEqual([body.name, body.start, body.facings, body.shadowStart], ["idle", 0, 32, 32]);
    const turret = turretSequence(built.sprite)!;
    assert.deepEqual([turret.start, turret.facings, turret.shadowStart, turret.file], [64, 32, 96, "/x/r2qilin.shp"]);
  }
  assert.equal(candidateVehicleSprite(current, { ...spriteCandidate(null), sprite: undefined }), null, "no layout, no drawing");
});

test("voxel candidates use the turret offset they declare and the unit's true in-game scale", () => {
  const current = renderSpec(artLab.actors.r2m1a2s);
  const urls = Object.fromEntries(["r2m1a2s.vxl", "r2m1a2s.hva", "dropin/r2m1a2stur.vxl", "dropin/r2m1a2stur.hva"].map(f => [f, `/x/${f}`]));
  const candidate: Candidate = { id: "voxel-v1", actor: "r2m1a2s", createdAt: "", kind: "voxel", dir: "", urls, files: { vxl: ["r2m1a2s.vxl", "dropin/r2m1a2stur.vxl"] }, voxelize: { turretOffsetWorld: [-123, 0, 0] } };
  assert.deepEqual(declaredTurretOffset(candidate), [-123, 0, 0]);
  const spec = candidateRenderSpec(current, candidate)!;
  assert.deepEqual(spec.voxel!.parts.find(p => p.label.startsWith("turret"))!.turretOffset, [-123, 0, 0]);
  assert.equal(spec.voxel!.scale, 15.2);
  assert.ok(Math.abs(spec.voxel!.scale / 12 - 1.2667) < 1e-4, "about 1.27 px per voxel, as OpenRA draws it");
});
