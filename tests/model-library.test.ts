import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readModelLibrary } from "../lib/art-lab/model-library-server";
import { voxelGlbGeometry } from "../lib/art-lab/voxel-glb";
import type { VxlLimb } from "../lib/art-lab/vxl";

function limb(colors:number[]):VxlLimb {
  return {name:"fixture",spanStartOffset:0,spanEndOffset:0,spanDataOffset:0,scale:1,transform:[],bounds:[0,0,0,colors.length,1,1],size:[colors.length,1,1],normalsMode:4,voxelCount:colors.length,colors:new Uint8Array(colors),normals:new Uint8Array(colors.length),filled:new Uint8Array(colors.length).fill(1),columns:colors.length,spans:colors.length,problems:[]};
}
test("voxel GLB exports exposed faces, suppresses shared interiors and preserves palette ownership",()=>{
  const palette=new Uint8Array(1024);palette.set([235,230,218,255],40*4);palette.set([180,20,15,255],16*4);
  const single=voxelGlbGeometry(limb([40]),palette,[16,17]);
  assert.equal(single[0].geometry.index!.count/3,12);
  const pair=voxelGlbGeometry(limb([40,16]),palette,[16,17]);
  assert.equal(pair.reduce((s,m)=>s+m.geometry.index!.count/3,0),20);
  const fixed=pair.find(m=>m.material.name==="fixed-paint")!,team=pair.find(m=>m.material.name!=="fixed-paint")!;
  assert.ok(fixed.geometry.getAttribute("color"));assert.equal(team.geometry.getAttribute("color"),undefined);
  assert.equal(team.material.userData.playerRemapIndex,16);assert.equal(team.material.userData.playerRemapLength,2);
  const old=Array.from(fixed.geometry.getAttribute("color").array);team.material.color.set("#3867ef");
  assert.deepEqual(Array.from(fixed.geometry.getAttribute("color").array),old);
  [...single,...pair].forEach(m=>{m.geometry.dispose();m.material.dispose();});
});
test("model library shares authored meshes across modes, prefers LOD, rejects paths outside root and keeps origin",()=>{
  const root=mkdtempSync(join(tmpdir(),"rtsai-models-"));
  try{
    const put=(file:string,data:unknown)=>{const path=join(root,file);mkdirSync(join(path,".."),{recursive:true});writeFileSync(path,typeof data==="string"?data:JSON.stringify(data));};
    put("models/manifest.json",{actors:{"ra2:a":{key:"ra2:a",mode:"ra2",actor:"a",name:"Authored",category:"vehicle",factions:["china"],job:"a",status:"linked-design"},"classic:alias":{key:"classic:alias",mode:"classic",actor:"alias",name:"Shared",category:"vehicle",factions:["china"],job:"a",status:"linked-design"}},jobs:{a:{input:"units/a/master.png",status:"geometry-draft",apiSpendUsd:0,requiredWork:["rig"]}}});
    put("models/reuse.json",{actors:{"ra2:a":{mesh:".cache/models/a.glb",hasPlayerRemap:true,hasTurret:true,triangles:12,source:{label:"Original game · private local conversion"}}}});
    put(".cache/models/a.glb","original-fixture");put("units/a/master.png","authored-fixture");
    put("units/a/candidates/draft/mesh.glb","source");put("units/a/candidates/draft/web.glb","optimized");
    put("units/a/candidates/draft/meta.json",{files:{mesh:"mesh.glb",webMesh:"web.glb"},geometry:{triangles:100},webGeometry:{triangles:30},rig:"unrigged",playerColor:{mapped:true}});
    put("units/a/candidates/invalid/meta.json",{files:{mesh:"../../../../../../outside.glb"}});
    const ra2=readModelLibrary(root,"ra2")!,classic=readModelLibrary(root,"classic")!;
    assert.equal(ra2.actors.length,1);assert.equal(classic.actors.length,1);assert.equal(ra2.actors[0].options.length,2);
    assert.match(ra2.actors[0].options[0].url,/web.glb/);assert.equal(ra2.actors[0].options[0].triangles,30);
    assert.equal(classic.actors[0].options[0].url,ra2.actors[0].options[0].url);
    assert.match(ra2.actors[0].options[1].source,/Original game/);assert.equal(ra2.apiSpendUsd,0);
    assert.match(ra2.actors[0].options[0].status,/inferred player-color mask/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("unverified sprite reconstructions are withheld while actual local game icons remain available",()=>{
  const root=mkdtempSync(join(tmpdir(),"rtsai-model-gate-"));
  try{
    const put=(file:string,data:unknown)=>{const path=join(root,file);mkdirSync(join(path,".."),{recursive:true});writeFileSync(path,typeof data==="string"?data:JSON.stringify(data));};
    put("models/manifest.json",{actors:{"ra2:wall":{key:"ra2:wall",mode:"ra2",actor:"wall",name:"Wall",category:"structure",factions:["russia"],job:null,status:"needs-authored-model",nativeRender:"sprite"}},jobs:{}});
    put("models/sprite-reuse.json",{actors:{"ra2:wall":{job:"private"}},jobs:{private:{status:"geometry-draft",candidate:".cache/models/private",qualityGate:{status:"failed",reason:"Cameo used as body"}}}});
    put(".cache/models/private/meta.json",{files:{webMesh:"web.glb"}});put(".cache/models/private/web.glb","bad-reconstruction");
    const lib=readModelLibrary(root,"ra2",{wall:"/api/art-review/ra2/wallicon.png"})!;
    assert.equal(lib.actors[0].thumbnail,"/api/art-review/ra2/wallicon.png");
    assert.equal(lib.actors[0].nativeThumbnail,lib.actors[0].thumbnail);
    assert.equal(lib.actors[0].nativeFormat,"SHP");assert.equal(lib.actors[0].options.length,0);
    assert.equal(lib.actors[0].reconstructionNotice,"Cameo used as body");
    assert.equal(lib.privateJobs.heldBack,1);assert.equal(lib.coverage.withGlb,0);
    assert.deepEqual(lib.nativeExports,{vxl:0,hva:0,shp:0});
  }finally{rmSync(root,{recursive:true,force:true});}
});
