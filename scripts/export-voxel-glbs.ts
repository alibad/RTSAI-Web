/** Local CPU export of existing voxel geometry. All GLBs stay in RTSAI-Art's ignored cache. */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { decodeVxl } from "../lib/art-lab/vxl";
import { decodeHva } from "../lib/art-lab/hva";
import { decodePal } from "../lib/art-lab/pal";
import { limbTransform, partMatrices, localToWorld } from "../lib/art-lab/voxel-math";
import { voxelGlbGeometry } from "../lib/art-lab/voxel-glb";
import type { RosterPayload } from "../lib/art-lab/originals";
const root=resolve("../RTSAI-Art"),base="http://127.0.0.1:3461";
// three's browser-independent exporter uses FileReader only to finish the output Blob.
class NodeFileReader {
  result:ArrayBuffer|string|null=null;onloadend:(()=>void)|null=null;
  readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(b=>{this.result=b;this.onloadend?.();});}
  readAsDataURL(blob:Blob){void blob.arrayBuffer().then(b=>{this.result=`data:${blob.type};base64,${Buffer.from(b).toString("base64")}`;this.onloadend?.();});}
}
Object.assign(globalThis,{FileReader:NodeFileReader});
const cache=new Map<string,Promise<Uint8Array>>();
const bytes=(url:string)=>{if(!url.startsWith("/api/art-review/"))throw Error("Only private local assets");let hit=cache.get(url);if(!hit){hit=fetch(base+url).then(async r=>{if(!r.ok)throw Error(`Missing file ${r.status}`);return new Uint8Array(await r.arrayBuffer());});cache.set(url,hit);}return hit;};
const index:{schemaVersion:number;updatedAt:string;policy:string;actors:Record<string,unknown>}={schemaVersion:1,updatedAt:new Date().toISOString(),policy:"Existing geometry conversion; not a new art rebuild. Local private caches only.",actors:{}};
for(const mode of ["ra2","classic"] as const){
  const roster=await(await fetch(`${base}/api/art-review/roster?mode=${mode}`)).json() as RosterPayload;
  let done=0;
  for(const [actor,stock] of Object.entries(roster.stock)){
    const spec=stock.spec,v=spec.voxel;if(!v||!spec.palette)continue;
    const key=`${mode}:${actor}`;
    try {
      const sourceHashes:Record<string,string>={};
      const paletteBytes=await bytes(spec.palette.url);sourceHashes[spec.palette.url]=createHash("sha256").update(paletteBytes).digest("hex");
      const palette=decodePal(paletteBytes,spec.palette.transparent,spec.palette.shadow),scene=new THREE.Scene();
      scene.name=stock.info?.name??actor;scene.userData={mode,actor,sourceArtwork:stock.sources?.model??null,derivedFrom:"VXL/HVA",nativeScale:v.scale,scaleValidation:"native matrix chain in display pixels; physical metre scale unassigned",gameplayImplemented:false};
      // OpenRA's model world is Z-up; GLB is Y-up. This proper rotation keeps handedness.
      const axis=new THREE.Matrix4().makeRotationX(-Math.PI/2);
      for(const part of v.parts){
        const vb=await bytes(part.vxl),hb=await bytes(part.hva),model=decodeVxl(vb),hva=decodeHva(hb);
        sourceHashes[part.vxl]=createHash("sha256").update(vb).digest("hex");sourceHashes[part.hva]=createHash("sha256").update(hb).digest("hex");
        const parent=new THREE.Group();parent.name=part.label;parent.visible=part.defaultVisible??(!part.requiresCondition||part.requiresCondition.startsWith("!"));
        parent.userData={trait:part.trait,requiresCondition:part.requiresCondition,independentTurret:Boolean(part.turretOffset),nativeOffset:part.turretOffset??part.offset,hvaFrames:hva.frameCount};
        scene.add(parent);
        model.limbs.forEach((limb,i)=>{
          const row=hva.rows[0]?.[i];if(!row)throw Error("Missing HVA section");
          const world=part.turretOffset?localToWorld(part.turretOffset,v.useClassicPerspectiveFudge,v.cameraPitch):part.offset;
          const matrices=partMatrices({scale:v.scale,cameraPitch:v.cameraPitch,lightPitch:v.lightPitch,lightYaw:v.lightYaw,pose:{yaw:part.turretInitialFacing??0,worldOffset:world},limb,hvaRow:row});
          const pivot=new THREE.Vector3(...matrices.pivot).applyMatrix4(axis);parent.position.copy(pivot);
          const group=new THREE.Group();group.name=limb.name;group.matrixAutoUpdate=false;group.matrix.multiplyMatrices(new THREE.Matrix4().makeTranslation(-pivot.x,-pivot.y,-pivot.z),new THREE.Matrix4().multiplyMatrices(axis,new THREE.Matrix4().fromArray(matrices.modelToWorld)));
          group.userData={voxelCount:limb.voxelCount,hvaRows:hva.rows.map(f=>f[i]),limbBounds:limb.bounds,limbScale:limb.scale,limbTransform:limbTransform(limb,row)};
          for(const mesh of voxelGlbGeometry(limb,palette,spec.palette!.remap))group.add(mesh);
          parent.add(group);
        });
      }
      scene.updateMatrixWorld(true);
      const output=await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:false});
      if(!(output instanceof ArrayBuffer))throw Error("Exporter did not return binary GLB");
      const rel=`.cache/models/${mode}/${actor}.glb`,path=resolve(root,rel);mkdirSync(resolve(path,".."),{recursive:true});writeFileSync(path,Buffer.from(output));
      let triangles=0,hasPlayerRemap=false;scene.traverse(o=>{if(o instanceof THREE.Mesh){triangles+=(o.geometry.index?.count??0)/3;o.geometry.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>{hasPlayerRemap ||= typeof m.userData.playerRemapIndex==="number";m.dispose();});}});
      index.actors[key]={key,mode,actor,name:stock.info?.name??actor,mesh:rel,status:"existing-voxel-converted",bytes:output.byteLength,triangles,sourceHashes,source:stock.sources?.model??null,hasPlayerRemap,hasTurret:v.parts.some(p=>p.turretOffset!==null),approval:"unchanged",nativeAnimation:"HVA data preserved in node extras; playback unimplemented"};done++;
    }catch(error){index.actors[key]={key,mode,actor,status:"failed",error:String(error)};}
  }
  console.log(mode,done,"existing voxel actors exported into private GLBs");
}
mkdirSync(resolve(root,"models"),{recursive:true});const destination=resolve(root,"models/reuse.json"),temp=destination+`.${process.pid}.tmp`;writeFileSync(temp,JSON.stringify(index,null,2)+"\n");renameSync(temp,destination);
