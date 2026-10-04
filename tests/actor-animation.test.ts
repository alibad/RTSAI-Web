import assert from "node:assert/strict";
import test from "node:test";
import { sequenceEvidence } from "../lib/art-lab/animation-evidence";
import { sequenceFrame } from "../lib/art-lab/sprite-render";
import { sequenceDurationMs,sequenceTimeFrame,rigPoseLayers,spriteRig } from "../lib/art-lab/sprite-compose";
import { spriteAnimations } from "../lib/art-lab/sprite-anim";
import { voxelAnimationFrames } from "../lib/art-lab/voxel-animation";
import { loadModData,resolveActor,type ModReader } from "../lib/art-lab/resolve";
import type { SpriteSequence,SpriteArt } from "../lib/art-lab/types";
import type { Shp } from "../lib/art-lab/shp";
import type { RenderSpec } from "../lib/art-lab/spec";

const seq=(name:string,extra:Partial<SpriteSequence>={}):SpriteSequence=>({name,file:`${name}.shp`,external:null,start:0,length:1,stride:1,facings:1,reverseFacings:false,transpose:false,tick:40,zOffset:0,shadowStart:-1,offset:[0,0,0],frames:null,reverses:false,usedBy:["WithSpriteBody"],inherited:false,...extra});
const shp=(count:number):Shp=>({width:1,height:1,frames:Array.from({length:count},(_,i)=>({x:0,y:0,width:1,height:1,compression:1,radarColor:[0,0,0,0],dataOffset:0,pixels:Uint8Array.of(i+1)}))});

test("wildcard construction consumes its own file and death remains on its terminal frame",()=>{
  const sequence=seq("make",{start:2,length:"*",stride:0,tick:80}),source=shp(7);
  assert.equal(sequenceFrame(sequence,4,0,false,source),6);
  assert.equal(sequenceTimeFrame(sequence,source,400,false),4);
  assert.equal(sequenceTimeFrame(sequence,source,800,false),4);
  assert.equal(sequenceTimeFrame(sequence,source,400,true),0);
  const reversing=seq("scan",{length:3,reverses:true});
  assert.equal(sequenceDurationMs(reversing,shp(3)),160);
  assert.deepEqual([0,40,80,120,160].map(t=>sequenceTimeFrame(reversing,shp(3),t)),[0,1,2,1,0]);
});
test("a building roof, fan and turret retain independent authored timing",()=>{
  const art:SpriteArt={image:"factory",palette:"player",shp:null,quantizedFacings:1,turret:{sequence:"turret",name:"primary",offset:[0,0,0],initialFacing:0},sequences:[seq("idle",{length:4,tick:200}),seq("turret",{length:3,tick:80,usedBy:["WithSpriteTurret"]}),seq("fan",{length:5,tick:40,usedBy:["WithIdleOverlay"]})],overlays:[{sequence:"fan",trait:"WithIdleOverlay",offset:[0,0,0],requiresCondition:null,mode:"loop"}]};
  const rig=spriteRig(art,"body")!,sources={body:shp(4),turret:shp(3),overlay:shp(5),overlays:[shp(5)]};
  assert.deepEqual(rigPoseLayers(rig,sources,{facing:0,turretFacing:0,tick:0,timeMs:160,shadow:false}).map(l=>[l.seq.name,l.frame]),[["idle",0],["turret",2],["fan",4]]);
});
test("all native idle variants are selectable and copied frames fail the evidence check",()=>{
  const art:SpriteArt={image:"infantry",palette:"player",shp:null,quantizedFacings:8,turret:null,sequences:[seq("stand",{usedBy:["WithInfantryBody stand"]}),seq("idle1",{length:3,usedBy:["WithInfantryBody idle"]}),seq("idle2",{length:3,usedBy:["WithInfantryBody idle"]})]};
  assert.equal(spriteAnimations(art).find(a=>a.id==="idle2")?.label,"Idle 2");
  const source=shp(3);source.frames.forEach(f=>f.pixels.fill(2));
  assert.equal(sequenceEvidence(art.sequences[1],source).status,"repeated-pose");
  source.frames[2].pixels.fill(3);
  assert.equal(sequenceEvidence(art.sequences[1],source).status,"animated-frames");
});
test("HVA parts keep their own frame rate and conditional parts remain hidden",()=>{
  const part={id:"rotor",frames:4,tickRate:1,requiresCondition:null};
  const spec={voxel:{parts:[part,{...part,id:"fan",tickRate:2},{...part,id:"payload",requiresCondition:"reloading"}]}} as RenderSpec;
  assert.deepEqual(voxelAnimationFrames(spec,120),{rotor:3,fan:1});
});
test("temperate wall and construction filenames resolve before the resting body default",()=>{
  const files:Record<string,string>={"mods/rtsai/mod.yaml":"Rules:\n\tra2|rules/test.yaml\nSequences:\n\tra2|sequences/test.yaml\n","mods/rtsai/rules/test.yaml":"factory:\n\tBuilding:\n\tRenderSprites:\n\tWithSpriteBody:\n\tWithMakeAnimation:\n","mods/rtsai/sequences/test.yaml":"factory:\n\tDefaults:\n\t\tFilename: body.shp\n\tidle:\n\t\tTilesetFilenames:\n\t\t\tTEMPERATE: wall.shp\n\tmake:\n\t\tLength: *\n\t\tTilesetFilenames:\n\t\t\tTEMPERATE: make.shp\n"};
  const reader:ModReader={text:p=>files[p],exists:p=>p in files,bytes:()=>new Uint8Array()};
  const data=loadModData(reader),names:string[]=[],body=new Uint8Array(33),view=new DataView(body.buffer);
  view.setUint16(2,1,true);view.setUint16(4,1,true);view.setUint16(6,1,true);view.setUint16(12,1,true);view.setUint16(14,1,true);body[16]=1;view.setUint32(28,32,true);body[32]=2;
  const art=resolveActor(reader,data,"factory",data.rules.get("factory")!,null,{palettes:{},normalsTypes:new Map(),recordFile:p=>p,ra2:{record:name=>{names.push(name);return name;},bytes:()=>body}});
  assert.equal(art.sprite?.sequences.find(s=>s.name==="make")?.file,"make.shp");
  assert.ok(names.includes("wall.shp"));
});
