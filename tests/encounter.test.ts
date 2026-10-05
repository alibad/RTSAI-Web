import test from "node:test";
import assert from "node:assert/strict";
import { placementActor, placementWorld, projectEncounter, screenCell, setupSample, visualAt } from "../lib/art-lab/encounter";
import { duelPlacements, type DuelVisual } from "../lib/art-lab/duel-server";
import { replaySample } from "../lib/art-lab/replay";
import type { RosterPayload } from "../lib/art-lab/originals";

test("field placement round trips both map geometries, including odd RA2 columns",()=>{
  for(const mode of ["ra2","classic"] as const) for(let u=36;u<=92;u++)for(let v=40;v<=92;v++){
    const [x,y]=placementWorld(mode,u,v),[px,py]=projectEncounter(mode,x,y);
    assert.deepEqual(screenCell(mode,px,py),{u,v});
  }
});
const plans=[{key:"red-1",id:"tank",side:0 as const,u:58,v:62,deploy:false,faction:"china"},{key:"blue-1",id:"defense",side:1 as const,u:70,v:64,deploy:false,faction:"england"},{key:"red-2",id:"soldier",side:0 as const,u:59,v:63,deploy:false,faction:"china"}];
test("mixed groups retain per-side native indices and independent map positions",()=>{
  const s=setupSample("classic",plans);
  assert.deepEqual(s.actors.map(p=>[p.side,p.index]),[[0,1],[1,1],[0,2]]);
  assert.equal(placementActor(plans,0,2,["old-a","old-b"]),"soldier");
  assert.equal(placementActor(undefined,1,1,["old-a","old-b"]),"old-b");
  assert.notEqual(s.actors[0].x,s.actors[2].x);
});
test("recorded visuals expire, interpolate actual positions, and retain measured frame steps",()=>{
  const p={id:1,kind:"projectile",type:"Bullet",x:0,y:0,z:0,facing:0,frame:2,palette:"effect"} as const;
  const at=visualAt([{...p,tick:10},{...p,tick:11,x:100,z:20,frame:3}] as DuelVisual[],0);
  assert.equal(at(9).length,0);assert.equal(at(13).length,0);
  assert.equal(at(10.5)[0].x,50);assert.equal(at(10.5)[0].frame,2);
  const actor={side:0,index:1,x:0,y:0,z:0,facing:0,health:10,maxHealth:10,turretFacing:1008};
  assert.equal(replaySample([{tick:0,actors:[actor]},{tick:5,actors:[{...actor,turretFacing:16}]}],2.5)?.actors[0].turretFacing,0);
});
test("placed actors enforce ownership, bounded teams, deployment and mobile destinations",()=>{
  const stock=Object.fromEntries(["tank","soldier","defense"].map(id=>[id,{ruleKey:id,behavior:{health:100,speed:id==="defense"?null:50,actions:[]},info:{domain:id==="defense"?"defense":"ground"}}]));
  const data={stock,factions:[{id:"china",units:[{id:"tank"},{id:"soldier"}]},{id:"england",units:[{id:"defense"}]}]} as unknown as RosterPayload;
  assert.equal(duelPlacements(plans,data,"ra2").length,3);
  assert.throws(()=>duelPlacements(plans.map(p=>({...p,u:1000})),data,"ra2"),/placement/);
  assert.throws(()=>duelPlacements(plans.map(p=>({...p,faction:"england"})),data,"ra2"),/cannot build/);
  assert.throws(()=>duelPlacements(plans.map(p=>({...p,deploy:true})),data,"ra2"),/cannot start deployed/);
  assert.throws(()=>duelPlacements(plans.map(p=>({...p,order:"move",destination:{u:62,v:64}})),data,"ra2"),/mobile actor/);
  assert.throws(()=>duelPlacements([plans[0],plans[0],plans[1]],data,"ra2"),/placement/);
  assert.throws(()=>duelPlacements([plans[0],plans[2]],data,"ra2"),/Each team/);
});
