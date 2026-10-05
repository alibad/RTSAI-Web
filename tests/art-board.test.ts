import assert from "node:assert/strict";
import test from "node:test";
import { allTiles, boardCandidate, boardCounts, boardTile, isOpen, missingAnimations, nextOpen } from "../lib/art-lab/board";
import { actionCoverage } from "../lib/art-lab/chain";
import type { Candidate, ReviewEntry, UnitWorkspace } from "../lib/art-lab/review";
import { artLab, renderSpec, spriteWithUrls } from "../lib/art-lab/manifest";

const cand = (id: string, kind: string, createdAt: string, extra: Partial<Candidate> = {}): Candidate => ({ id, actor: "r2x", kind, createdAt, files: kind === "voxel" ? { vxl: ["a.vxl"] } : kind === "sprite" ? { shp: ["a.shp"] } : { concept: "c.png" }, dir: "", urls: {}, ...extra } as Candidate);
const ws = (actor: string, candidates: Candidate[]): UnitWorkspace => ({ actor, spec: null, candidates, comparisons: [] });
const entry = (model: Partial<ReviewEntry["slots"]["model"]>, comments: ReviewEntry["comments"] = []): ReviewEntry => ({ version: 2, status: "in-review", slots: { model: { chosen: null, rejected: [], at: null, ...model }, icon: { chosen: null, rejected: [], at: null }, concept: { chosen: null, rejected: [], at: null } }, comments, log: [] });

test("board: a tile decides the newest model from the 3D route, and keeps showing it once rejected", () => {
  const older = cand("sprite-v2-motion-study", "sprite", "2026-10-04T00:00:00Z");
  const glb = cand("sprite-v3-glb", "sprite", "2026-10-05T00:00:00Z", { fromMesh: "mesh-v1" });
  const newerOlderRoute = cand("sprite-v9", "sprite", "2026-10-06T00:00:00Z");
  assert.equal(boardCandidate(ws("r2a", [older, glb, newerOlderRoute]))?.id, "sprite-v3-glb", "the 3D route wins over a newer older-route study");
  assert.equal(boardCandidate(ws("r2a", [older]))?.id, "sprite-v2-motion-study");
  assert.equal(boardCandidate(ws("r2a", [cand("concept-v1", "concept", "x")])), null);
  const rejected = boardTile("r2a", ws("r2a", [older, glb]), entry({ rejected: ["sprite-v3-glb"] }), null);
  assert.equal(rejected.candidate?.id, "sprite-v3-glb");
  assert.equal(rejected.decision.kind, "rejected");
});

test("board: counts per unit, the next open tile, preview by bytes, notes on the shown candidate", () => {
  const glb = (a: string) => cand("voxel-v5-glb", "voxel", "2026-10-05T00:00:00Z", { actor: a, fromMesh: "mesh-v1" });
  const spaces = new Map([["r2a", ws("r2a", [glb("r2a")])], ["r2b", ws("r2b", [glb("r2b")])], ["r2c", ws("r2c", [glb("r2c")])], ["r2d", ws("r2d", [])]]);
  const review = { r2b: entry({ chosen: "voxel-v5-glb", at: "2026-10-05T01:00:00Z" }, [{ at: "x", slot: "model", candidate: "voxel-v5-glb", view: null, text: "ok", author: "owner" }]) };
  const preview = { available: true, branch: null, head: null, unmatched: [], actors: { r2a: { model: "voxel-v5-glb", icon: null, files: ["voxels/r2a.vxl"], rules: false }, r2c: { model: null, icon: null, files: ["voxels/r2c.vxl"], rules: false } } };
  const tiles = allTiles(["r2a", "r2b", "r2c", "r2d"], spaces, review, preview);
  assert.deepEqual(boardCounts(tiles), { units: 4, withModel: 3, decided: 1, inPreview: 1, withoutModel: 1 });
  assert.deepEqual(tiles.map(t => [t.inPreview, t.previewOther, t.notes]), [[true, false, 0], [false, false, 1], [false, true, 0], [false, false, 0]]);
  assert.deepEqual(tiles.map(isOpen), [true, false, true, false]);
  assert.equal(nextOpen(tiles, 0), 2, "skips the decided tile and the one without a model");
  assert.equal(nextOpen(tiles, 2), 0, "wraps");
  assert.equal(nextOpen(tiles.map(t => ({ ...t, decision: { kind: "use" as const, label: "" } })), 0), -1, "-1 when all are decided");
});

test("board: required actions follow the unit's current rules (no rotor for a jet, no turret for a turretless unit)", () => {
  const coverage = (id: string, category: string) => { const a = artLab.actors[id]; const s = renderSpec(a); return actionCoverage(category, s, spriteWithUrls(a), { spec: s, sprite: spriteWithUrls(a) }).map(x => x.label); };
  assert.deepEqual(coverage("r2skyspear", "aircraft"), ["Body"]);
  assert.deepEqual(coverage("r2crane", "aircraft"), ["Body", "Rotor spin"]);
  assert.deepEqual(coverage("r2mantis", "vehicle"), ["Body", "Turret"]);
  assert.deepEqual(missingAnimations([{ name: "Rifle", actions: [{ id: "prone", label: "Prone", present: false }, { id: "stand", label: "Stand", present: true }] }, { name: "Tank", actions: [{ id: "body", label: "Body", present: true }] }]), [{ name: "Rifle", missing: ["Prone"] }]);
});

test("board: the candidate the preview copy plays is the one under review, not merely the newest", () => {
  const mesh = cand("mesh-v1", "mesh", "2026-10-05T00:00:00Z", { files: { mesh: "m.glb" } as Candidate["files"] });
  const sprite = cand("sprite-v6-prerender", "sprite", "2026-10-05T19:45:38Z", { fromMesh: "mesh-v1" });
  const bold = cand("voxel-v6-bold", "voxel", "2026-10-05T19:45:45Z", { fromMesh: "mesh-v1" });
  const w = ws("r2a", [mesh, sprite, bold]);
  assert.equal(boardCandidate(w)?.id, "voxel-v6-bold", "nothing installed: the newest made from the 3D model");
  assert.equal(boardCandidate(w, "sprite-v6-prerender")?.id, "sprite-v6-prerender", "the route installed the sprite");
  const tile = boardTile("r2a", w, undefined, { available: true, branch: null, head: null, actors: { r2a: { model: "sprite-v6-prerender", icon: null, files: ["vehicles/r2a.shp"], rules: true } }, unmatched: [] });
  assert.deepEqual([tile.candidate?.id, tile.inPreview, tile.previewOther], ["sprite-v6-prerender", true, false]);
});
