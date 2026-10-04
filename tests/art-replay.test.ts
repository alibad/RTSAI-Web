import test from "node:test";
import assert from "node:assert/strict";
import { angleDelta, facingToward, replaySample, replayBounds, eventActor } from "../lib/art-lab/replay";
import type { DuelSample } from "../lib/art-lab/duel-server";
import { flagSrc } from "../app/components/art/review/flags";
const actor = { side:0,index:1,x:0,y:0,z:0,facing:1008,health:100,maxHealth:100 };
const samples: DuelSample[] = [{tick:0,actors:[actor]}, {tick:5,actors:[{...actor,x:100,z:20,facing:16,health:60}]}, {tick:10,actors:[]}];
test("replay interpolates position and yaw through north without inventing health", () => {
  const p = replaySample(samples,2.5)!.actors[0];
  assert.equal(p.x,50); assert.equal(p.z,10); assert.equal(p.facing,0); assert.equal(p.health,100);
  assert.equal(replaySample(samples,5)!.actors[0].health,60);
  assert.equal(replaySample(samples,10)!.actors.length,0);
  assert.equal(replaySample([],0),null);
  assert.equal(angleDelta(16,1008),-32);
});
test("native world axes map to OpenRA yaw and precomputed bounds survive deaths", () => {
  assert.equal(facingToward(1,0),768); assert.equal(facingToward(0,1),512); assert.equal(facingToward(-1,0),256); assert.equal(facingToward(0,-1),0);
  assert.deepEqual(replayBounds(samples,(x,y)=>[x,y]),{minX:0,maxX:100,minY:0,maxY:0});
  assert.deepEqual(replayBounds(samples,(x,y,z=0)=>[x,y-z]),{minX:0,maxX:100,minY:-20,maxY:0}, "flight bounds include ground and altitude");
  assert.equal(eventActor(samples,10,0,1)?.health,60);
});
test("every selectable faction in both modes has a local flag, including stock countries", () => {
  for (const id of "america germany england france korea cuba libya iraq russia ukraine israel china iran turkey saudi yemen hezbollah".split(" ")) {
    const src=flagSrc(id); assert.ok(src?.startsWith("data:image/svg+xml"),id);
    const svg=decodeURIComponent(src!.split(",").slice(1).join(","));
    assert.match(svg,/<svg\b/); assert.doesNotMatch(svg,/<script\b|onload=/i);
  }
  assert.equal(flagSrc("unknown"),null);
});
