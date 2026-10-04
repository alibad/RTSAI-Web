/** Validate authored native files; resource checks do not approve animation quality. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {decodeShp} from "../lib/art-lab/shp";
import {sequenceEvidence} from "../lib/art-lab/animation-evidence";
import {candidateVehicleSprite,type Candidate} from "../lib/art-lab/review";
import {readState} from "../lib/art-lab/review-server";
import type {RosterPayload} from "../lib/art-lab/originals";
const root=resolve("../RTSAI-Art"),report=JSON.parse(readFileSync(resolve(root,"animations/motion-studies.json"),"utf8"));
const roster=await(await fetch("http://127.0.0.1:3461/api/art-review/roster?mode=ra2")).json() as RosterPayload;
const state=readState(root);let actions=0,frames=0,remapPixels=0;
const actors:Record<string,unknown>={};
for(const [actor,value] of Object.entries(report.actors)){
  const study=value as {candidate:string;sha256:string},stock=roster.stock[actor];assert.ok(stock,`${actor} must belong to the actual roster`);
  const candidate=state.units.find(u=>u.actor===actor)?.candidates.find(c=>c.id==="sprite-v2-motion-study") as Candidate;
  assert.ok(candidate);const built=candidateVehicleSprite(stock.spec,candidate,stock.sprite);assert.ok(built);
  const bytes=readFileSync(resolve(root,study.candidate,`${actor}.shp`));assert.equal(createHash("sha256").update(bytes).digest("hex"),study.sha256);
  const shp=decodeShp(bytes);assert.equal(shp.frames.length,488);assert.deepEqual([shp.width,shp.height],[64,64]);frames+=shp.frames.length;
  const evidence=built.sprite.sequences.map(s=>sequenceEvidence(s,shp));
  for(const e of evidence){assert.equal(e.missingFrames.length,0,`${actor}:${e.sequence}`);if(e.framesPerFacing>1)assert.ok(Math.min(...e.uniqueFramesByFacing)>1,`${actor}:${e.sequence} must visibly vary in every facing`);}
  let left=64,right=0,top=64,bottom=0,mapped=0;
  for(const f of shp.frames)for(let i=0;i<f.pixels.length;i++){
    const p=f.pixels[i];if(!p)continue;const x=i%64,y=Math.floor(i/64);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);if(p>=16&&p<32)mapped++;
  }
  assert.ok(left>0&&right<63&&top>0&&bottom<63,`${actor} clipped native cell`);assert.ok(mapped>0,`${actor} missing player-color indices`);
  actions+=evidence.length;remapPixels+=mapped;actors[actor]={actions:evidence.length,frames:shp.frames.length,unionBounds:[left,top,right+1,bottom+1],playerColorPixels:mapped,clips:evidence};
}
assert.equal(Object.keys(actors).length,20);
const validation={measuredAt:new Date().toISOString(),evidence:"Measured: decoded native SHP, valid facing/frame indices, distinct frames, player remap regions and cell margins. Motion aesthetics and gameplay are unverified.",summary:{actors:20,actions,frames,remapPixels,invalidFrameRanges:0,clippedCells:0},actors};
writeFileSync(resolve(root,"animations/motion-validation.json"),JSON.stringify(validation,null,2)+"\n");console.log(JSON.stringify(validation.summary));
