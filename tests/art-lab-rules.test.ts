import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { child, childValue, mergeMiniYaml, parseMiniYaml, YamlError, type Yaml } from "../lib/art-lab/miniyaml";
import { cameraMatrix, facingLabel, partMatrices, transformVector, wrotMatrix } from "../lib/art-lab/voxel-math";
import { indexFacing, sequenceFrame } from "../lib/art-lab/sprite-render";
import { poseParts, rasterizeUnit } from "../lib/art-lab/raster";
import { decodeVxl } from "../lib/art-lab/vxl";
import { decodeHva } from "../lib/art-lab/hva";
import { decodePal } from "../lib/art-lab/pal";
import { RA2_NORMALS } from "../lib/art-lab/normals.generated";
import manifest from "../data/art-lab.json";
import type { SpriteSequence } from "../lib/art-lab/types";

const merged = (...files: string[]) => new Map(mergeMiniYaml(files.map((f, i) => parseMiniYaml(f, `f${i}`))).map(n => [n.key, n.value]));
const actor = (m: Map<string, Yaml>, k: string) => m.get(k)!;

test("MiniYaml parses tabs and 4-space indents, comments and escapes", () => {
  const nodes = parseMiniYaml("A: 1 # comment\n\tB: x\\#y\n    C:\n\t\tD: \\  padded  \\\n# whole line\nE:\n");
  const a = nodes[0];
  assert.equal(a.key, "A");
  assert.equal(a.value.value, "1");
  assert.equal(childValue(a.value, "B"), "x#y");
  assert.equal(childValue(child(a.value, "C")?.value, "D"), "  padded  ", "backslash guards keep surrounding spaces");
  assert.equal(nodes[1].key, "E");
  assert.throws(() => parseMiniYaml("A:\n\t\tB: 1"), YamlError, "skipping an indent level is an error");
});

test("MiniYaml merge: Inherits from ^templates, @ instances, -removals and later files", () => {
  const rules = merged(
    "^Base:\n\tHealth:\n\t\tHP: 100\n\tArmor:\n\t\tType: Light\n\tTurreted:\n\t\tTurnSpeed: 10\n^Extra:\n\tCargo:\n\t\tMaxWeight: 2\n",
    "tank:\n\tInherits: ^Base\n\tInherits@cargo: ^Extra\n\tHealth:\n\t\tHP: 350\n\t-Turreted:\n",
    "tank:\n\tArmor:\n\t\tType: Heavy\n",
  );
  const tank = actor(rules, "tank");
  assert.equal(childValue(child(tank, "Health")?.value, "HP"), "350", "own value overrides the template");
  assert.equal(childValue(child(tank, "Armor")?.value, "Type"), "Heavy", "a later file overrides");
  assert.equal(childValue(child(tank, "Cargo")?.value, "MaxWeight"), "2", "Inherits@ adds a second parent");
  assert.equal(child(tank, "Turreted"), undefined, "-Turreted removes the inherited trait");
  assert.throws(() => merged("a:\n\tInherits: ^Missing\n"), /not found/);
  assert.throws(() => merged("^T:\n\tX:\na:\n\tInherits: ^T\n\tInherits@2: ^T\n"), /already inherited/);
  assert.throws(() => merged("a:\n\t-Nothing:\n"), /no elements/);
  assert.equal(merged("a:\n\tX:\n", "-a:\n").has("a"), false, "a top-level removal deletes the actor");
});

test("MiniYaml merge resolves the real mod: Qilin inherits the modern vehicle template", () => {
  const qilin = manifest.actors.r2qilin;
  assert.equal(qilin.voxel!.scale, 15.2, "Scale comes from ^R2ModernVehicle");
  assert.equal(qilin.voxel!.cameraPitch, 85, "CameraPitch comes from the RA2 ^Vehicle default");
  assert.deepEqual(qilin.voxel!.parts.map(p => p.trait), ["WithVoxelBody", "WithVoxelTurret"]);
  // r2phl removes the turret traits it inherits.
  assert.deepEqual(manifest.actors.r2phl.voxel!.parts.map(p => p.trait), ["WithVoxelBody"]);
  // The Crane inherits a helicopter body that draws `idle`; nothing draws its rotor model.
  assert.ok(manifest.actors.r2crane.voxel!.unusedSequences.some(s => s.sequence === "rotor"));
});

test("Facings follow OpenRA: 0 is north, counter-clockwise, matching the SHP frame order", () => {
  assert.equal(indexFacing(0, 8), 0);
  assert.equal(indexFacing(896, 8), 7);
  assert.equal(indexFacing(256, 8), 2);
  assert.deepEqual([0, 128, 256, 512, 768, 896].map(facingLabel), ["N", "NW", "W", "S", "E", "NE"]);
  const seq = manifest.actors.r2cnrifle.sprite!.sequences.find(s => s.name === "run") as SpriteSequence;
  assert.equal(sequenceFrame(seq, 0, 896), 8 + 7 * 6, "run, facing NE, frame 0 = Start + facing * Length");
  // Rotation matrices are orthonormal.
  const m = wrotMatrix(0, 85 - 256, 256);
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(Math.hypot(m[4 * c], m[4 * c + 1], m[4 * c + 2]) - 1) < 1e-3);
});

test("Voxel projection: a unit facing north points up the screen, facing east points right", () => {
  const limb = { scale: 1, bounds: [0, 0, 0, 1, 1, 1] as [number, number, number, number, number, number], size: [1, 1, 1] as [number, number, number] };
  const forward = (facing: number) => {
    const m = partMatrices({ scale: 1, cameraPitch: 85, lightPitch: 150, lightYaw: 800, pose: { yaw: facing, worldOffset: [0, 0, 0] }, limb, hvaRow: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] });
    return transformVector(cameraMatrix(85), transformVector(m.modelToWorld, [1, 0, 0, 0]));
  };
  const north = forward(0);
  assert.ok(north[1] < -0.4 && Math.abs(north[0]) < 1e-3, "north: screen up, foreshortened");
  const east = forward(768);
  assert.ok(east[0] > 0.9 && Math.abs(east[1]) < 1e-3, "east: screen right");
});

test("CPU reference render: the Karrar at facing 896 points up-right with a shadow on the ground", () => {
  const read = (key: string) => new Uint8Array(readFileSync(new URL(`../public/art-lab/${key}`, import.meta.url)));
  const v = manifest.actors.r2karrar.voxel!;
  const parts = poseParts(v.parts as never[], 896, 0, v.useClassicPerspectiveFudge, v.cameraPitch).map(({ part, yaw, worldOffset }: { part: { model: { vxl: string; hva: string }; showShadow: boolean }; yaw: number; worldOffset: [number, number, number] }) => ({
    vxl: decodeVxl(read(part.model.vxl)), hva: decodeHva(read(part.model.hva)), yaw, worldOffset, frame: 0, showShadow: part.showShadow,
  }));
  const pal = manifest.palettes[v.palette as keyof typeof manifest.palettes];
  const image = rasterizeUnit({ parts, scale: v.scale, cameraPitch: v.cameraPitch, lightPitch: v.lightPitch, lightYaw: v.lightYaw, ambient: v.ambient as [number, number, number], diffuse: v.diffuse as [number, number, number], palette: decodePal(read(pal.file!)), normals: RA2_NORMALS, shadowColor: [0, 0, 0, 140] });
  let far = { d: 0, x: 0, y: 0 }, opaque = 0, shadow = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const a = image.data[4 * (y * image.width + x) + 3];
    if (a === 255) { opaque++; const d = Math.hypot(x - image.anchorX, y - image.anchorY); if (d > far.d) far = { d, x, y }; }
    else if (a === 140) shadow++;
  }
  assert.ok(opaque > 1000 && opaque < 2500, `model covers ${opaque} px at 1x`);
  assert.ok(shadow > 100, "the ground shadow is drawn");
  assert.ok(far.x > image.anchorX && far.y < image.anchorY, "the gun tip, farthest from the centre, is up and to the right");
});
