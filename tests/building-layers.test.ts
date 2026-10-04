import assert from "node:assert/strict";
import test from "node:test";
import { spriteAnimations } from "../lib/art-lab/sprite-anim";
import { composeRig, rigAnimates, rigFiles, rigLayers, spriteRig } from "../lib/art-lab/sprite-compose";
import { buildRenderSpec } from "../lib/art-lab/render-spec";
import { loadModData, resolveActor, type ModReader } from "../lib/art-lab/resolve";
import type { Palette } from "../lib/art-lab/pal";
import type { Shp } from "../lib/art-lab/shp";
import type { SpriteArt, SpriteSequence } from "../lib/art-lab/types";

const seq = (name: string, usedBy: string[], extra: Partial<SpriteSequence> = {}): SpriteSequence => ({ name, usedBy, file: `${name}.shp`, external: null, start: 0, length: 1, stride: 1, facings: 1, reverseFacings: false, transpose: false, tick: 40, zOffset: 0, shadowStart: -1, offset: [0, 0, 0], frames: null, reverses: false, inherited: false, ...extra });
const factory: SpriteArt = {
  image: "factory", palette: "player", shp: null, quantizedFacings: 1, turret: null,
  sequences: [seq("idle", ["WithSpriteBody"]), seq("damaged-idle", ["WithSpriteBody (damaged)"]), seq("make", ["WithMakeAnimation"], { length: 3 }), seq("build-top", ["WithProductionDoorOverlay"], { length: 3 }), seq("damaged-build-top", ["WithProductionDoorOverlay (damaged)"], { length: 3 }), seq("fan", ["WithIdleOverlay@fan"], { length: 2 }), seq("bib", ["WithIdleOverlay@bib"], { zOffset: -10 })],
  overlays: [{ sequence: "fan", trait: "WithIdleOverlay@fan", offset: [0, 0, 0], requiresCondition: null, mode: "loop" }, { sequence: "bib", trait: "WithIdleOverlay@bib", offset: [0, 0, 0], requiresCondition: null, mode: "loop" }, { sequence: "build-top", trait: "WithProductionDoorOverlay", offset: [0, 0, 0], requiresCondition: null, mode: "door" }],
};
const shp = (w: number, h: number, color: number, frames = 1): Shp => ({ width: w, height: h, frames: Array.from({ length: frames }, (_, i) => ({ x: 0, y: 0, width: w, height: h, compression: 0, radarColor: [0, 0, 0, 0], dataOffset: 0, pixels: new Uint8Array(w * h).fill(color + i) })) });
const palette: Palette = new Uint8ClampedArray(1024);
for (let i = 1; i < 256; i++) palette.set([i, i, i, 255], i * 4);
const shps = { body: shp(4, 4, 10), turret: null, overlay: shp(4, 4, 20, 2), overlays: [shp(4, 4, 20, 2), shp(6, 6, 30), shp(8, 8, 40, 3)] };
const pose = { facing: 0, turretFacing: 0, tick: 0, shadow: false };

test("factory idle composes every layer, keeps the production door closed, and draws the bib behind the body", () => {
  const rig = spriteRig(factory, "body")!;
  assert.deepEqual(rigFiles(rig), ["idle.shp", "fan.shp", "bib.shp", "build-top.shp"]);
  const a = rigLayers(rig, shps, 0, 0, 0, 0), b = rigLayers(rig, shps, 0, 0, 0, 2);
  assert.equal(a[0].seq.name, "bib");
  assert.equal(b.find(l => l.seq.name === "build-top")!.frame, 0);
  const image = composeRig(rig, shps, palette, pose);
  assert.equal(image.data[(image.anchorY * image.width + image.anchorX) * 4], 40, "roof is visible on top");
  assert.equal(Array.from(image.data).filter((_, i) => i % 4 === 3 && image.data[i] > 0).length, 64, "no roof pixels clipped");
});

test("production and damaged previews animate the roof over the matching body; construction omits all finished layers", () => {
  const door = spriteRig(factory, "build-top")!, damaged = spriteRig(factory, "damaged-build-top")!, make = spriteRig(factory, "make")!;
  assert.equal(door.body.name, "idle");
  assert.equal(damaged.body.name, "damaged-idle");
  assert.equal(damaged.overlays.at(-1)!.seq.name, "damaged-build-top");
  assert.equal(rigLayers(door, shps, 0, 0, 0, 2).find(l => l.seq.name === "build-top")!.frame, 2);
  assert.deepEqual(make.overlays, []);
  assert.deepEqual(rigFiles(make), ["make.shp"]);
  const quiet = { ...factory, sequences: factory.sequences.filter(s => !["fan", "bib"].includes(s.name)), overlays: factory.overlays!.filter(o => o.mode === "door") };
  assert.equal(rigAnimates(spriteRig(quiet, "body")!, { ...shps, overlay: shps.overlays[2], overlays: [shps.overlays[2]] }), false, "closed door does not trigger idle timers");
  assert.match(spriteAnimations(factory).find(a => a.id === "build-top")!.label, /Production door/);
});

test("frames larger than the body and displaced layers retain every pixel and a fixed anchor", () => {
  const rig = spriteRig({ ...factory, overlays: [{ ...factory.overlays![2], offset: [0, 0, 1024] }] }, "body")!;
  const loaded = { ...shps, overlay: shp(9, 15, 40, 3), overlays: [shp(9, 15, 40, 3)] };
  const image = composeRig(rig, loaded, palette, pose);
  assert.equal(Array.from(image.data).filter((_, i) => i % 4 === 3 && image.data[i] > 0).length, 135 + 16);
  const next = composeRig(rig, loaded, palette, { ...pose, tick: 2 });
  assert.deepEqual([image.width, image.height, image.anchorX, image.anchorY], [next.width, next.height, next.anchorX, next.anchorY]);
});

test("rules resolver records door and multiple overlay traits for both viewer and thumbnail specs", () => {
  const files: Record<string, string> = {
    "mods/rtsai/mod.yaml": "Rules:\n\tra2|rules/test.yaml\nSequences:\n\tra2|sequences/test.yaml\n",
    "mods/rtsai/rules/test.yaml": "factory:\n\tBuilding:\n\tRenderSprites:\n\tWithSpriteBody:\n\tWithProductionDoorOverlay:\n\t\tSequence: build-top\n\t\tRequiresCondition: !build-incomplete\n\tWithIdleOverlay@fan:\n\t\tSequence: fan\n\t\tOffset: 0,0,512\n\tWithIdleOverlay@bib:\n\t\tSequence: bib\n",
    "mods/rtsai/sequences/test.yaml": "factory:\n\tDefaults:\n\t\tFilename: factory.shp\n\tidle:\n\tbuild-top:\n\t\tFilename: roof.shp\n\tfan:\n\tbib:\n",
  };
  const reader: ModReader = { text: p => files[p], exists: p => p in files, bytes: () => new Uint8Array(0) };
  const data = loadModData(reader);
  const art = resolveActor(reader, data, "factory", data.rules.get("factory")!, null, { palettes: {}, normalsTypes: new Map(), recordFile: p => p });
  assert.deepEqual(art.sprite!.overlays!.map(o => [o.sequence, o.mode]), [["fan", "loop"], ["bib", "loop"], ["build-top", "door"]]);
  assert.deepEqual(art.sprite!.overlays![0].offset, [0, 0, 512]);
  assert.equal(art.sprite!.overlays![2].requiresCondition, "!build-incomplete");
  assert.ok(art.sprite!.sequences.find(s => s.name === "build-top")!.usedBy.includes("WithProductionDoorOverlay"));
  const spec = buildRenderSpec({ ...art, sprite: factory }, f => f ?? null, () => null);
  assert.equal(spec.sprite!.overlays!.length, 3);
  assert.equal(spec.sprite!.overlays!.at(-1)!.animated, false);
});
