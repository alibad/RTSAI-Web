import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { legacyArt as artLab, legacyBytes, legacySpriteWithUrls as spriteWithUrls } from "./legacy-art";
import { decodePal } from "../lib/art-lab/pal";
import {
  appendChip, cellZoom, clampZoom, dragFacing, dragTurret, fitZoom, letter, lineupFacings, provenanceChain, relativeTime, reviewProgress, versionLabels,
} from "../lib/art-lab/review-ui";
import { decodeShp } from "../lib/art-lab/shp";
import { composeRig, rigAnimates, rigFiles, rigLength, spriteRig } from "../lib/art-lab/sprite-compose";
import type { SpriteArt } from "../lib/art-lab/types";

test("versions get short labels by kind, lettered in creation order", () => {
  const labels = versionLabels([
    { id: "sprite-v2", kind: "sprite", createdAt: "2026-10-03T10:15:00Z" },
    { id: "voxel-v2", kind: "voxel", createdAt: "2026-10-03T02:38:00Z" },
    { id: "voxel-v1", kind: "voxel", createdAt: "2026-10-03T02:11:00Z" },
    { id: "sprite-v1", kind: "sprite", createdAt: "2026-10-03T10:02:00Z" },
    { id: "cameo-v10", kind: "cameo", createdAt: "2026-10-03T02:37:00Z" },
  ]);
  assert.deepEqual(Object.fromEntries(labels), { "voxel-v1": "Voxel A", "cameo-v10": "Icon A", "voxel-v2": "Voxel B", "sprite-v1": "Sprite A", "sprite-v2": "Sprite B" });
  assert.deepEqual([0, 25, 26, 27].map(letter), ["A", "Z", "AA", "AB"]);
});

test("dragging turns through the 32 facings: right is counter-clockwise, 10 px per step, wrapping", () => {
  assert.equal(dragFacing(896, 0), 896);
  assert.equal(dragFacing(896, 10), 928, "one step right");
  assert.equal(dragFacing(896, -10), 864, "one step left");
  assert.equal(dragFacing(896, 4), 896, "less than half a step does nothing");
  assert.equal(dragFacing(1000, 40), 104, "wraps past north");
  assert.equal(dragFacing(0, 320), 0, "320 px is a full turn");
  const turret = dragTurret(480, 100);
  assert.ok(turret >= -512 && turret < 512, "turret angle stays relative (-512..511)");
  assert.equal(dragTurret(0, -10), -32);
});

test("zoom stays a whole number from 1x to 6x and fits the unit's turning circle", () => {
  assert.equal(fitZoom(50, 900, 700), 5, "a 50 px tank on a 900x700 stage");
  assert.equal(fitZoom(20, 900, 700), 6, "capped at 6x");
  assert.equal(fitZoom(400, 300, 300), 1, "never below 1x");
  assert.equal(cellZoom(90, 55, 191, 117), 2);
  assert.equal(clampZoom(9, 6), 6);
  assert.equal(clampZoom(0, 6), 1);
  assert.equal(clampZoom(3.4, 6), 3);
});

test("the lineup shows the four diagonals (or eight compass points), turned together", () => {
  assert.deepEqual(lineupFacings(4), [896, 640, 384, 128]);
  assert.equal(lineupFacings(8).length, 8);
  assert.deepEqual(lineupFacings(4, 256), [128, 896, 640, 384]);
});

test("progress counts only units with candidates; a unit is decided when it needs nothing", () => {
  assert.deepEqual(reviewProgress([{ count: 4, needs: true }, { count: 2, needs: false }, { count: 0, needs: false }]), { decided: 1, total: 2 });
});

test("Details names what a candidate was made from, oldest step first", () => {
  assert.deepEqual(provenanceChain({ kind: "voxel", fromConcept: "concept-v1", imageTo3d: { model: "trellis", license: { weights: "microsoft/TRELLIS.2-4B" } } }), ["concept-v1", "TRELLIS.2", "Voxel"]);
  assert.deepEqual(provenanceChain({ kind: "sprite", fromConcept: "concept-v1", variantOf: "voxel-v1", model: "Blender 5.2.2 LTS Cycles (CPU) render" }), ["concept-v1", "voxel-v1", "Blender render", "Sprite"]);
  assert.deepEqual(provenanceChain({ kind: "cameo", fromConcept: "concept-v1", model: "gpt-image-2.5-sunburst" }), ["concept-v1", "Sunburst", "Icon"]);
});

test("quick chips add to the note once; times read as short relative phrases", () => {
  assert.equal(appendChip("", "Too dark"), "Too dark");
  assert.equal(appendChip("Turret too small.", "Too dark"), "Turret too small. Too dark");
  assert.equal(appendChip("too dark", "Too dark"), "too dark");
  const now = Date.parse("2026-10-03T12:00:00Z");
  assert.equal(relativeTime("2026-10-03T11:59:40Z", now), "just now");
  assert.equal(relativeTime("2026-10-03T11:48:00Z", now), "12 min ago");
  assert.equal(relativeTime("2026-10-03T09:00:00Z", now), "3 h ago");
  assert.equal(relativeTime("2026-09-01T09:00:00Z", now), "2026-09-01");
});

// The freeze: a one-frame stand re-rendered (and recomposed every facing) on a 40 ms timer. A sprite now
// animates only when its picture changes, and its frames keep one fixed centre at every facing.
test("sprite rigs animate only when the picture changes, around a fixed centre", () => {
  const actor = artLab.actors.r2sang;
  const sprite = spriteWithUrls(actor) as SpriteArt;
  const local = (url: string) => legacyBytes(url);
  const palette = decodePal(local("/art-lab/saudi-art/saudi.pal"), [0], []);
  const shpFor = (rig: NonNullable<ReturnType<typeof spriteRig>>) => {
    const [file] = rigFiles(rig);
    return { body: decodeShp(local(file)), turret: null, overlay: null };
  };
  const stand = spriteRig(sprite, "stand")!;
  const move = spriteRig(sprite, "move")!;
  assert.equal(stand.body.name, "stand");
  assert.equal(rigAnimates(stand, shpFor(stand)), false, "a one-frame stand never ticks");
  assert.equal(rigAnimates(move, shpFor(move)), true, "walking does");
  assert.equal(rigLength(move, shpFor(move)), 6);
  const shps = shpFor(stand);
  const pictures = [0, 128, 256, 384, 512, 640, 768, 896].map(facing => composeRig(stand, shps, palette, { facing, turretFacing: 0, tick: 0, shadow: true }));
  assert.equal(new Set(pictures.map(p => `${p.width}x${p.height}@${p.anchorX},${p.anchorY}`)).size, 1, "same frame box and centre at every facing");
  assert.equal(new Set(pictures.map(p => Buffer.from(p.data).toString("base64"))).size, 8, "eight distinct facings");
  const again = composeRig(stand, shps, palette, { facing: 900, turretFacing: 0, tick: 0, shadow: true });
  assert.deepEqual(again.data, pictures[7].data, "facings within one of the eight sectors share a picture");
});

test("Review is an app screen: dev-only, no marketing chrome, no floating feedback button", () => {
  const page = readFileSync(new URL("../app/art/review/page.tsx", import.meta.url), "utf8");
  assert.match(page, /process\.env\.NODE_ENV === "production"\) notFound\(\)/);
  assert.match(page, /await import\("\.\.\/\.\.\/components\/art\/ReviewApp"\)/, "the review UI is loaded only on the dev route");
  assert.doesNotMatch(page, /ArtLabChrome|SiteHeader|SiteFooter/);
  const app = readFileSync(new URL("../app/components/art/ReviewApp.tsx", import.meta.url), "utf8");
  assert.match(app, /setHideTrigger\(true\)/);
});

test("one WebGL context: the Review frame cache renders voxels through a single shared engine", () => {
  const frames = readFileSync(new URL("../app/components/art/review/frames.ts", import.meta.url), "utf8");
  assert.equal((frames.match(/new three\.VoxelEngine\(/g) ?? []).length, 1);
  assert.match(frames, /this\.engineInstance \?\?= new three\.VoxelEngine\(\)/, "created once, lazily");
  assert.match(frames, /renderInGameAsync/, "read back without blocking the main thread");
  for (const file of ["Stage.tsx", "Filmstrip.tsx", "ImageStages.tsx", "../ReviewApp.tsx"]) {
    const source = readFileSync(new URL(`../app/components/art/review/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /new (VoxelStage|VoxelEngine|THREE\.WebGLRenderer)\b/, `${file} creates no WebGL context`);
    assert.doesNotMatch(source, /renderInGame\(/, `${file} never runs the CPU reference renderer per frame`);
  }
});
