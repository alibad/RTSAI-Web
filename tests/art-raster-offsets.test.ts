import assert from "node:assert/strict";
import test from "node:test";
import { partMatrices } from "../lib/art-lab/voxel-math";

// Regression for the renderer used by the Studio and by RTSAI-Art's tools/check_renderer.py (RTSAI-Art df747dd,
// engine rtsai/engine 55ecbb07e2): a part's world offset must reach the model with the camera's depth, so a bow or
// stern turret pivots on the hull's ground plane instead of being depth-tested at the hull origin.
test("voxel part offsets: the pivot of an off-centre turret stays on the model ground plane and up axis", () => {
  const pivot = (worldOffset: [number, number, number]) => partMatrices({
    scale: 11.7, cameraPitch: 85, lightPitch: 150, lightYaw: 800, pose: { yaw: 0, worldOffset },
    limb: { scale: 1 / 12, bounds: [-1, -1, 0, 1, 1, 2], size: [2, 2, 2] }, hvaRow: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
  }).pivot;
  for (const ground of [[0, 529, 0], [0, -529, 0], [400, 300, 0]] as [number, number, number][]) {
    assert.ok(Math.abs(pivot(ground)[2]) < 1e-9, `ground offset ${ground.join(",")} stays at model height 0 (was depth-tested at the hull origin)`);
  }
  const up = pivot([0, 0, 600]);
  assert.ok(Math.abs(up[0]) < 1e-9 && Math.abs(up[1]) < 1e-9 && up[2] > 0, "a height offset stays on the model's up axis");
  const both = pivot([0, 529, 600]), g = pivot([0, 529, 0]);
  assert.ok(Math.abs(both[0] - (g[0] + up[0])) < 1e-9 && Math.abs(both[1] - (g[1] + up[1])) < 1e-9 && Math.abs(both[2] - (g[2] + up[2])) < 1e-9, "ground and height parts add up");
});
