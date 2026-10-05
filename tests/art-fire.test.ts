import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { fireActions, fireLayers, firePeriod, fireState, muzzleScreenOffset, placeholderMuzzle, recoilScreenOffset, voxelMuzzleLayers, withInstalledArmaments, type FireRules } from "../lib/art-lab/fire";
import { fireRules } from "../lib/art-lab/fire-server";
import { rigPoseLayers, spriteRig, stampLayers } from "../lib/art-lab/sprite-compose";
import type { Shp } from "../lib/art-lab/shp";
import type { SpriteArt, SpriteSequence } from "../lib/art-lab/types";

const rules = (over: Partial<FireRules> = {}): FireRules => ({
  source: "preview", image: "r2x", muzzleOverlay: true, spriteRecoils: true, voxelBarrel: null, turrets: { primary: [-1, 0, 0] }, originals: true,
  armaments: [{ name: "primary", turret: "primary", localOffset: [[809, 2, 460]], recoil: 72, recoilRecovery: 14, muzzle: "muzzle", muzzlePalette: "effect" }],
  ...over,
});
const muzzle = placeholderMuzzle();

test("fire: recoil jumps to Recoil and falls by RecoilRecovery each 40 ms tick; the flash plays once", () => {
  const r = rules();
  const art = { muzzle };
  const period = firePeriod(r, art);
  assert.ok(period >= 600);
  assert.deepEqual(fireState(r, 0, art)[0], { name: "primary", recoil: 72, barrel: 0, muzzleFrame: 0 });
  assert.equal(fireState(r, 40, art)[0].recoil, 58);
  assert.equal(fireState(r, 79, art)[0].recoil, 58, "whole ticks only");
  assert.equal(fireState(r, 6 * 40, art)[0].recoil, 0, "72 - 6 x 14 never goes below zero");
  assert.equal(fireState(r, 3 * 40, art)[0].muzzleFrame, 3);
  assert.equal(fireState(r, 4 * 40, art)[0].muzzleFrame, null, "the four-frame flash is over");
  assert.equal(fireState({ ...r, muzzleOverlay: false }, 0, art)[0].muzzleFrame, null, "no WithMuzzleOverlay, no flash");
  // Two barrels take turns, one per shot.
  const twin = rules({ armaments: [{ ...r.armaments[0], localOffset: [[20, -248, 704], [20, 248, 704]] }] });
  assert.deepEqual([0, 1, 2].map(k => fireState(twin, k * firePeriod(twin, art), art)[0].barrel), [0, 1, 0]);
  assert.deepEqual(fireActions(r).map(a => a.label), ["Fire"]);
  assert.deepEqual(fireActions(rules({ armaments: [{ ...r.armaments[0], recoil: 0, muzzle: null }] })), [], "nothing to show: no Fire action");
});

test("fire: the turret slides back along its facing; the flash sits at the barrel's LocalOffset", () => {
  const a = rules().armaments[0];
  for (const facing of [0, 256, 512, 896]) {
    const back = recoilScreenOffset(72, facing), ahead = muzzleScreenOffset({ ...a, localOffset: [[700, 0, 0]] }, 0, 0, facing, facing, [0, 0, 0]);
    assert.ok(back.dx * ahead.dx + back.dy * ahead.dy < 0, `facing ${facing}: recoil points away from the muzzle`);
  }
  const still = muzzleScreenOffset(a, 0, 0, 0, 0, [0, 0, 0]), kicked = muzzleScreenOffset(a, 0, 72, 0, 0, [0, 0, 0]);
  assert.ok(kicked.dy > still.dy, "facing north, the recoiling muzzle moves down the screen");
});

test("fire: the installed rules block wins (meta.previewInstall.rules)", () => {
  const r = withInstalledArmaments(rules(), { Turreted: { Offset: "-39,0,0" }, Armament: { LocalOffset: "20,-248,704, 20,248,704", Recoil: "0c64", RecoilRecovery: "12" } });
  assert.deepEqual(r.turrets.primary, [-39, 0, 0]);
  assert.deepEqual(r.armaments[0].localOffset, [[20, -248, 704], [20, 248, 704]]);
  assert.deepEqual([r.armaments[0].recoil, r.armaments[0].recoilRecovery], [64, 12]);
});

test("fire: a sprite turret recoils and the flash is drawn on top with its own palette; a voxel frame is stamped", () => {
  const frame = (w: number, h: number) => ({ x: 0, y: 0, width: w, height: h, compression: 0, radarColor: [0, 0, 0, 0] as [number, number, number, number], dataOffset: 0, pixels: new Uint8Array(w * h).fill(5) });
  const shp: Shp = { width: 20, height: 16, frames: Array.from({ length: 64 }, () => frame(20, 16)) };
  const seq = (name: string, start: number, usedBy: string): SpriteSequence => ({ name, file: "/x/a.shp", external: null, start, length: 1, stride: 1, facings: 32, reverseFacings: false, useClassicFacings: false, transpose: false, tick: 40, zOffset: 0, shadowStart: -1, offset: [0, 0, 0], frames: null, reverses: false, usedBy: [usedBy], inherited: false });
  const art: SpriteArt = { image: "r2x", palette: "p", shp: null, quantizedFacings: 32, sequences: [seq("idle", 0, "WithFacingSpriteBody"), seq("turret", 32, "WithSpriteTurret")], turret: { sequence: "turret", name: "primary", offset: [-1, 0, 0], initialFacing: 0 } };
  const rig = spriteRig(art, "stand")!;
  const shps = { body: shp, turret: shp, overlay: null };
  const base = rigPoseLayers(rig, shps, { facing: 0, turretFacing: 0, tick: 0, shadow: false });
  const r = rules();
  const states = fireState(r, 0, { muzzle });
  const fired = fireLayers(base, rig, r, states, { muzzle }, 0, 0);
  const turret = (ls: typeof base) => ls.find(l => l.seq.name === "turret")!;
  assert.ok((turret(fired).dy ?? 0) > (turret(base).dy ?? 0), "facing north, the turret kicks down the screen");
  assert.equal(fired.at(-1)?.palette, muzzle.palette, "the flash is last, with its own palette");
  const settled = fireState(r, 600, { muzzle });
  assert.deepEqual(fireLayers(base, rig, r, settled, { muzzle }, 0, 0), base, "after the shot the picture is the idle one");
  // A voxel picture grows to hold a flash outside it.
  const image = { width: 10, height: 10, anchorX: 5, anchorY: 5, data: new Uint8ClampedArray(400).fill(255) };
  const stamped = stampLayers(image, voxelMuzzleLayers(r, states, { muzzle }, 0, 0, false));
  assert.ok(stamped.height > image.height && stamped.anchorY > image.anchorY, "the flash ahead of the unit extends the frame upward");
});

test("fire: the marked placeholder is a magenta-ringed burst, never original art", () => {
  const m = placeholderMuzzle();
  assert.equal(m.placeholder, true);
  assert.deepEqual([...m.palette.slice(12, 16)], [232, 40, 220, 255]);
  assert.ok(m.shp.frames.every(f => f.pixels.includes(3)), "every frame carries the magenta ring");
});

test("fire: rules come from the merged mod rules (local preview copy when present)", { skip: !existsSync("../RTSAI-Mod-wt-art-preview/mods/rtsai/mod.yaml") }, () => {
  const r = fireRules("../RTSAI-Mod-wt-art-preview", "r2qilin", "preview")!;
  assert.equal(r.source, "preview");
  assert.ok(r.armaments.length > 0 && r.armaments[0].muzzle, "the Qilin's gun has a muzzle sequence");
  assert.ok(r.muzzleOverlay);
});
