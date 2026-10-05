import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { combineSources, modSources, sourceLabel } from "../lib/art-lab/asset-source";
import { localAssetSource } from "../lib/art-lab/asset-source-server";
import type { ProvenanceRecord } from "../lib/art-lab/provenance";

const bytes=new Uint8Array([1,2,3]);
const record:ProvenanceRecord={schemaVersion:1,generatedBy:"fixture",files:{"voxels/test.vxl":{origin:"generated",generator:"forge-voxel",type:"vxl",sha256:createHash("sha256").update(bytes).digest("hex")}}};
test("a generated model needs the exact recorded file hash; folder names prove nothing",()=>{
  const source=localAssetSource("owned/test.vxl","ra2","mods/rtsai/modern-factions/voxels/test.vxl",()=>bytes,record);
  assert.equal(source.kind,"generated");assert.equal(source.evidence,"hash-verified");
  assert.equal(localAssetSource("owned/test.vxl","ra2","mods/rtsai/modern-factions/voxels/test.vxl",()=>new Uint8Array([4]),record).kind,"unknown");
  assert.equal(localAssetSource("owned/test.vxl","ra2",undefined,()=>bytes,null).kind,"unknown");
});
test("original artwork is credited separately from project artwork and unknown local bits",()=>{
  const original=localAssetSource("htnk.vxl","ra2",undefined,()=>{throw Error("no need to read original bytes");},null);
  assert.equal(original.creator,"EA / Westwood");assert.equal(original.rights,"original-game-data");
  const local=localAssetSource("owned/mod.shp","ra2","mods/rtsai/bits/mod.shp",()=>bytes,null);
  assert.equal(local.creator,null);assert.equal(local.kind,"unknown");
  assert.equal(combineSources([original,local],"Model").kind,"mixed");
  assert.equal(sourceLabel({origin:"new"}),"Source unverified");
  const generated=localAssetSource("owned/test.vxl","ra2","mods/rtsai/modern-factions/voxels/test.vxl",()=>bytes,record);
  const mixed=combineSources([original,generated],"Model");
  assert.equal(mixed.evidence,"mixed-verified");assert.equal(mixed.rights,"unreviewed");assert.equal(mixed.creator,null);
});
test("an external project link never implies imported assets or approved artwork rights",()=>{
  assert.equal(modSources.length,4);
  assert.ok(modSources.every(s=>s.importStatus==="not-imported"&&s.artRights==="not-reviewed"));
  assert.equal(modSources.find(s=>s.id==="mental-omega")?.engine,"RA2 / Yuri’s Revenge");
});
