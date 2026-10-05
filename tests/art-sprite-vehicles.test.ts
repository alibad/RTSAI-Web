import assert from "node:assert/strict";
import test from "node:test";
import { candidateRenderSpec, candidateVehicleSprite, type Candidate } from "../lib/art-lab/review";
import { artLab, renderSpec } from "../lib/art-lab/manifest";
import { spriteAnimations } from "../lib/art-lab/sprite-anim";
import { barrelScreenOffset, rigFiles, spriteRig, turretScreenOffset } from "../lib/art-lab/sprite-compose";
import { actionCoverage } from "../lib/art-lab/chain";
import { sequenceLabel, spinLabel, spinKind } from "../lib/art-lab/action-labels";
import { voxelCycleLabel } from "../lib/art-lab/voxel-animation";
import type { SpriteArt, SpriteSequence } from "../lib/art-lab/types";

const cand = (actor: string, rulesText: string): Candidate => ({
  id: "sprite-v6-prerender", actor, createdAt: "2026-10-05T18:00:00Z", kind: "sprite", dir: "", rulesText,
  urls: { [`${actor}.shp`]: `/x/${actor}.shp`, "p.pal": "/x/p.pal" }, files: { shp: [`${actor}.shp`], pal: "p.pal", rules: "openra-snippet.yaml" },
} as Candidate);

const seqBlock = (actor: string, lines: string[]) => [`${actor}:`, ...lines].join("\n");
const pal = "^Palettes:\n\tPaletteFromFile@p:\n\t\tName: p\n\t\tFilename: p.pal\n\t\tShadowIndex: 1\n\tPlayerColorPalette@p:\n\t\tBasePalette: p\n\t\tBaseName: pplayer\n\t\tRemapIndex: 16, 17\n";

test("labels: one plain-word map for every sequence", () => {
  assert.equal(sequenceLabel("prone-stand"), "Prone");
  assert.equal(sequenceLabel("prone-run"), "Crawl");
  assert.equal(sequenceLabel("die2"), "Die (alt)");
  assert.equal(sequenceLabel("liedown"), "Lie down");
  assert.equal(sequenceLabel("damaged-active"), "Damaged · Active");
  assert.equal(sequenceLabel("some-new-move"), "Some new move");
  assert.deepEqual(["pusher", "main rotor", "radar", "hull"].map(spinKind), ["propeller", "rotor", "radar", null]);
  assert.equal(spinLabel(["propeller", "rotor"]), "Rotor spin");

  const base: SpriteSequence = { name: "stand", file: "/x/i.shp", external: null, start: 0, length: 1, stride: 1, facings: 8, reverseFacings: false, useClassicFacings: false, transpose: false, tick: 40, zOffset: 0, shadowStart: -1, offset: [0, 0, 0], frames: null, reverses: false, usedBy: [], inherited: false };
  const s = (name: string, usedBy: string[] = []) => ({ ...base, name, usedBy });
  const art: SpriteArt = { image: "i", palette: "p", shp: null, quantizedFacings: 8, turret: null, sequences: [
    s("stand", ["WithInfantryBody stand"]), s("run", ["WithInfantryBody move"]), s("shoot", ["WithInfantryBody attack"]), s("idle1", ["WithInfantryBody idle"]),
    s("prone-run"), s("prone-stand"), s("prone-shoot"), s("die1", ["WithDeathAnimation@normal"]), s("die2", ["WithDeathAnimation@normal"]), s("liedown"), s("standup"),
  ] };
  const labels = spriteAnimations(art).map(a => a.label);
  assert.deepEqual(labels, ["Stand", "Walk", "Fire", "Idle", "Prone", "Die", "Crawl", "Prone fire", "Die (alt)", "Lie down", "Stand up"]);
  assert.equal(new Set(labels).size, labels.length, "no two buttons share a label");
  assert.equal(spriteAnimations(art).find(a => a.id === "prone")?.body?.name, "prone-stand", "prone is lying still; crawling is its own action");
});

test("voxel cycles are named by what turns", () => {
  const mohajer = renderSpec(artLab.actors.r2mohajer);
  const play = [{ trait: "WithVoxelHelicopterBody", sequence: "idle", file: "r2mohajer", tickRate: 1, turret: null, condition: null, airborne: true }];
  const drone = { id: "voxel-v5-glb", kind: "voxel", createdAt: "x", actor: "r2mohajer", dir: "", files: { vxl: ["r2mohajer.vxl"], hva: ["r2mohajer.hva"] }, urls: { "r2mohajer.vxl": "/x/a.vxl", "r2mohajer.hva": "/x/a.hva" }, hvaFrames: { r2mohajer: 4 }, voxelize: { sections: { body: {}, pusher: {} }, log: { rotors: [{ name: "pusher" }] } } } as unknown as Candidate;
  assert.equal(voxelCycleLabel(candidateRenderSpec(mohajer, drone, play)!), "Propeller");
  assert.equal(voxelCycleLabel(renderSpec(artLab.actors.r2toufan)), "Rotor spin", "a helicopter body turns a rotor");
});

test("prerendered vehicle sprites: body, turret, turret-riding radar, barrel and rotor overlay", () => {
  // The prerender pilot's own snippet shape (r2qilin sprite-v6-prerender): body + turret, 32 facings.
  const qilin = renderSpec(artLab.actors.r2qilin);
  const pilot = `${pal}\nr2qilin:\n\t-RenderVoxels:\n\t-WithVoxelBody:\n\t-WithVoxelTurret:\n\t-WithVoxelBarrel:\n\tRenderSprites:\n\t\tPlayerPalette: pplayer\n\tWithFacingSpriteBody:\n\tWithSpriteTurret:\n\tBodyOrientation:\n\t\tQuantizedFacings: 32\n\tTurreted:\n\t\tOffset: -1,0,0\n`
    + seqBlock("r2qilin", ["\tidle:", "\t\tFilename: ra2|modern-factions/china-art/r2qilin.shp", "\t\tFacings: 32", "\t\tShadowStart: 32", "\tturret:", "\t\tFilename: ra2|modern-factions/china-art/r2qilin.shp", "\t\tStart: 64", "\t\tFacings: 32", "\t\tShadowStart: 96"]);
  const made = candidateVehicleSprite(qilin, cand("r2qilin", pilot), null)!;
  assert.equal(made.spec.render, "sprite");
  const rig = spriteRig(made.sprite, "stand")!;
  assert.deepEqual([rig.body.name, rig.turret?.name, rig.quantizedFacings, rig.barrel, rig.turretSprites.length], ["idle", "turret", 32, null, 0]);
  assert.deepEqual(actionCoverage("vehicle", made.spec, made.sprite, { spec: qilin }).map(a => [a.label, a.present]), [["Idle", true], ["Turret", true]]);

  // The full shape: a separate barrel (WithSpriteBarrel), a radar dish riding the turret (WithSpriteTurret@radar).
  const mantis = renderSpec(artLab.actors.r2mantis);
  const full = `${pal}\nr2mantis:\n\t-WithVoxelBody:\n\t-WithVoxelTurret:\n\tRenderSprites:\n\tWithFacingSpriteBody:\n\tWithSpriteTurret:\n\tWithSpriteTurret@radar:\n\t\tSequence: radar\n\tWithSpriteBarrel:\n\t\tLocalOffset: 300,0,100\n\tTurreted:\n\t\tOffset: -36,0,0\n`
    + seqBlock("r2mantis", ["\tDefaults:", "\t\tFilename: ra2|art-preview/vehicles/r2mantis.shp", "\tidle:", "\t\tFacings: 32", "\t\tShadowStart: 32", "\tturret:", "\t\tStart: 64", "\t\tFacings: 32",
      "\tbarrel:", "\t\tStart: 128", "\t\tFacings: 32", "\tradar:", "\t\tStart: 160", "\t\tFacings: 32", "\t\tLength: 8", "\t\tTick: 80"]);
  const m = candidateVehicleSprite(mantis, cand("r2mantis", full), null)!;
  const mr = spriteRig(m.sprite, "stand")!;
  assert.deepEqual([mr.turret?.name, mr.barrel?.seq.name, mr.barrel?.localOffset, mr.turretSprites.map(s => s.name)], ["turret", "barrel", [300, 0, 100], ["radar"]]);
  assert.deepEqual(rigFiles(mr), ["/x/r2mantis.shp"], "one SHP holds every layer");
  assert.equal(spriteAnimations(m.sprite)[0].label, "Radar spin");
  assert.deepEqual(actionCoverage("vehicle", m.spec, m.sprite, { spec: mantis }).map(a => [a.label, a.present]), [["Idle", true], ["Turret", true], ["Radar spin", true], ["Barrel", true]]);
  // The barrel turns with the turret; the engine adds the turret's offset unturned (WithSpriteBarrel.BarrelOffset).
  assert.notDeepEqual(barrelScreenOffset([-36, 0, 0], [300, 0, 100], 0), barrelScreenOffset([-36, 0, 0], [300, 0, 100], 256));
  assert.deepEqual(barrelScreenOffset([0, 0, 0], [300, 0, 0], 128), turretScreenOffset([300, 0, 0], 128), "with no turret offset it is the turned LocalOffset");

  // A sprite helicopter: the rotor is a looping idle overlay that turns with the body; a current rotor requires one.
  const crane = renderSpec(artLab.actors.r2crane);
  const heli = `${pal}\nr2crane:\n\t-WithVoxelHelicopterBody:\n\tWithFacingSpriteBody:\n\tWithIdleOverlay@rotor:\n\t\tSequence: rotor\n\t\tOffset: 0,0,200\n`
    + seqBlock("r2crane", ["\tDefaults:", "\t\tFilename: ra2|art-preview/vehicles/r2crane.shp", "\tidle:", "\t\tFacings: 32", "\trotor:", "\t\tStart: 32", "\t\tLength: 4", "\t\tTick: 40"]);
  const h = candidateVehicleSprite(crane, cand("r2crane", heli), null)!;
  assert.equal(spriteAnimations(h.sprite)[0].label, "Rotor spin");
  assert.deepEqual(actionCoverage("aircraft", h.spec, h.sprite, { spec: crane }).find(a => a.id === "spin"), { id: "spin", label: "Rotor spin", present: true });
  const bare = candidateVehicleSprite(crane, cand("r2crane", seqBlock("r2crane", ["\tidle:", "\t\tFilename: r2crane.shp", "\t\tFacings: 32"])), null)!;
  assert.deepEqual(actionCoverage("aircraft", bare.spec, bare.sprite, { spec: crane }).find(a => a.id === "spin")?.present, false, "a helicopter sprite without a rotor overlay is missing it");
});

test("prerendered spins baked into the body or turret, conditional variants and foreign-image overlays", () => {
  // A drone whose body loops its propeller frames (32 facings x 8, facing-major), with the landed body and a
  // damage-smoke overlay drawn from another image.
  const mohajer = renderSpec(artLab.actors.r2mohajer);
  const drone = `${pal}\nr2mohajer:\n\t-WithVoxelBody:\n\tWithFacingSpriteBody:\n\t\tRequiresCondition: airborne\n\tWithFacingSpriteBody@landed:\n\t\tSequence: idle-landed\n\t\tRequiresCondition: !airborne\n\tWithIdleOverlay@R2FXSMOKE:\n\t\tImage: smallsmoke\n\t\tSequence: idle\n\t\tRequiresCondition: r2fx-heavy\n`
    + seqBlock("r2mohajer", ["\tDefaults:", "\t\tFilename: ra2|art-preview/vehicles/r2mohajer.shp", "\tidle:", "\t\tFacings: 32", "\t\tLength: 8", "\t\tTick: 40", "\tidle-landed:", "\t\tStart: 256", "\t\tFacings: 32"]);
  const c = { ...cand("r2mohajer", drone), sprite: { sequences: { idle: { spins: ["pusher"] } } } } as Candidate;
  const d = candidateVehicleSprite(mohajer, c, null)!;
  assert.equal(d.spec.sprite?.stand?.name, "idle", "the smoke overlay's Sequence: idle (another image) does not take the body");
  const anims = spriteAnimations(d.sprite);
  assert.deepEqual(anims.map(a => a.label), ["Propeller", "Landed"]);
  assert.deepEqual(actionCoverage("aircraft", d.spec, d.sprite, { spec: mohajer }).find(a => a.id === "spin"), { id: "spin", label: "Propeller", present: true });

  // A deploy-gated radar: the spinning turret, and a still one until deployed (an alternative, never both).
  const raad = renderSpec(artLab.actors.r2raad);
  const radar = `${pal}\nr2raad:\n\tWithFacingSpriteBody:\n\tWithSpriteTurret:\n\t\tRequiresCondition: active-radar\n\tWithSpriteTurret@still:\n\t\tSequence: turret-still\n\t\tRequiresCondition: !active-radar\n\tTurreted:\n\t\tOffset: -52,0,0\n`
    + seqBlock("r2raad", ["\tDefaults:", "\t\tFilename: ra2|art-preview/vehicles/r2raad.shp", "\tidle:", "\t\tFacings: 32", "\tturret:", "\t\tStart: 64", "\t\tFacings: 32", "\t\tLength: 8", "\tturret-still:", "\t\tStart: 320", "\t\tFacings: 32"]);
  const r = candidateVehicleSprite(raad, { ...cand("r2raad", radar), sprite: { spin: "radar" } } as Candidate, null)!;
  const rig = spriteRig(r.sprite, "stand")!;
  assert.deepEqual([rig.turret?.name, rig.turretSprites.length], ["turret", 0], "the still dish is not drawn over the spinning one");
  const list = spriteAnimations(r.sprite);
  assert.deepEqual(list.map(a => a.label), ["Radar spin", "Turret still"]);
  assert.equal(spriteRig(r.sprite, "turret-still")!.turret?.name, "turret-still");
});

test("the rules an install agent put into the preview copy win over the candidate's proposed snippet", () => {
  const mantis = renderSpec(artLab.actors.r2mantis);
  const proposed = `${pal}\nr2mantis:\n\tWithFacingSpriteBody:\n\tWithSpriteTurret:\n\tTurreted:\n\t\tOffset: -36,0,0\n`
    + seqBlock("r2mantis", ["\tDefaults:", "\t\tFilename: r2mantis.shp", "\tidle:", "\t\tFacings: 32", "\tturret:", "\t\tStart: 64", "\t\tFacings: 32"]);
  const installed = { "-RenderVoxels": null, "-WithVoxelBody": null, RenderSprites: { PlayerPalette: "r2prerender-chinaplayer" }, BodyOrientation: { QuantizedFacings: 32 }, WithFacingSpriteBody: {}, Turreted: { Offset: "-39,0,0" }, WithSpriteTurret: {} };
  const c = { ...cand("r2mantis", proposed), previewInstall: { route: "sprite", rules: installed } } as Candidate;
  const m = candidateVehicleSprite(mantis, c, null)!;
  assert.deepEqual(m.sprite.turret?.offset, [-39, 0, 0], "the installed Turreted.Offset");
  assert.equal(spriteRig(m.sprite, "stand")!.body.name, "idle");
  // A sprite aircraft keeps the cruise altitude its voxel version flew at, so the stage can lift it.
  const crane = renderSpec(artLab.actors.r2crane);
  const h = candidateVehicleSprite(crane, cand("r2crane", seqBlock("r2crane", ["\tidle:", "\t\tFilename: r2crane.shp", "\t\tFacings: 32"])), null)!;
  assert.equal(h.spec.airAltitude, crane.voxel!.altitude);
  assert.ok((h.spec.airAltitude ?? 0) > 0);
});
