/** CPU-only audit; original pixels are read locally and never written to the report. */
import { createHash } from "node:crypto";
import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeShp } from "../lib/art-lab/shp";
import { sequenceEvidence } from "../lib/art-lab/animation-evidence";
import { spriteAnimations,spriteOverlays } from "../lib/art-lab/sprite-anim";
import { voxelAnimationParts } from "../lib/art-lab/voxel-animation";
import type { RosterPayload } from "../lib/art-lab/originals";
const root=resolve("../RTSAI-Art"),base="http://127.0.0.1:3461",cache=new Map<string,Promise<Uint8Array>>();
const bytes=(url:string)=>{
  if(!url.startsWith("/api/art-review/"))throw Error("Only local asset routes are allowed");
  let value=cache.get(url);if(!value){value=fetch(base+url).then(async r=>{if(!r.ok)throw Error(`Local asset unavailable: ${r.status}`);return new Uint8Array(await r.arrayBuffer());});cache.set(url,value);}return value;
};
const plan=JSON.parse(readFileSync(resolve(root,"models/manifest.json"),"utf8"));
const meshEvidence=new Map<string,{animationClips:number;skins:number;animatedNodes:number}>();
function measureMesh(candidate:string){
  let value=meshEvidence.get(candidate);if(value)return value;
  const meta=JSON.parse(readFileSync(resolve(root,candidate,"meta.json"),"utf8"));
  const file=readFileSync(resolve(root,candidate,meta.files.mesh));
  if(file.toString("ascii",0,4)!=="glTF"||file.readUInt32LE(4)!==2||file.readUInt32LE(8)!==file.length||file.readUInt32LE(16)!==0x4e4f534a)throw Error("Invalid authored GLB");
  const gltf=JSON.parse(file.toString("utf8",20,20+file.readUInt32LE(12)));
  value={animationClips:gltf.animations?.length??0,skins:gltf.skins?.length??0,animatedNodes:new Set((gltf.animations??[]).flatMap((a:{channels:{target:{node:number}}[]})=>a.channels.map(c=>c.target.node))).size};
  meshEvidence.set(candidate,value);return value;
}
const actors:Record<string,unknown>={},summary:Record<string,unknown>={};
for(const mode of ["ra2","classic"] as const){
  const roster=await(await fetch(`${base}/api/art-review/roster?mode=${mode}`)).json() as RosterPayload;
  let repeated=0,invalid=0,missingBodies=0;
  for(const [id,stock] of Object.entries(roster.stock)){
    const key=`${mode}:${id}`,actions=[],overlays=[];
    for(const action of spriteAnimations(stock.sprite)){
      if(!action.body?.file)continue;
      try{
        const data=await bytes(action.body.file),evidence=sequenceEvidence(action.body,decodeShp(data));
        actions.push({id:action.id,label:action.label,...evidence,sourceSha256:createHash("sha256").update(data).digest("hex")});
        if(evidence.status==="repeated-pose")repeated++;if(evidence.missingFrames.length)invalid++;
      }catch(error){actions.push({id:action.id,label:action.label,status:"source-unavailable",error:String(error)});invalid++;}
    }
    for(const layer of spriteOverlays(stock.sprite)){
      try{const evidence=sequenceEvidence(layer.seq,decodeShp(await bytes(layer.seq.file!)));overlays.push({mode:layer.mode,trait:layer.trait,...evidence});if(evidence.missingFrames.length)invalid++;}
      catch(error){overlays.push({sequence:layer.seq.name,status:"source-unavailable",error:String(error)});invalid++;}
    }
    const required=stock.info?.category==="infantry"?["stand","move","attack","idle","die"]:stock.spec.voxel?["native-part-motion","movement","fire","damage","destruction"]:["idle","construction","damage","destruction",...(stock.behavior?.weapons.length?["fire"]:[])];
    if(!stock.spec.voxel&&!actions.length)missingBodies++;
    const job=plan.jobs[plan.actors[key]?.job],mesh=job?measureMesh(job.candidate):null;
    actors[key]={key,actor:id,mode,name:stock.info?.name??id,factions:plan.actors[key]?.factions??[],category:stock.info?.category??stock.spec.category,source:stock.sources?.model,actions,overlays,hvaParts:voxelAnimationParts(stock.spec).map(p=>({id:p.id,frames:p.frames,tickMs:p.tickRate!*40})),requiredWork:required,newDesign:job?{candidate:job.candidate,...mesh,rig:mesh!.skins?"has-skin-unverified":"unrigged",status:mesh!.animationClips?"animation-quality-review-required":"animation-authoring-required"}:null,gameEffects:"Native weapon/projectile/effect rules must be verified in Encounter; a body sequence is not a combat simulation"};
  }
  summary[mode]={actors:Object.keys(roster.stock).length,repeatedPoseActions:repeated,invalidActions:invalid,missingSpriteBodies:missingBodies};
}
const report={schemaVersion:1,measuredAt:new Date().toISOString(),policy:"Metadata only. Pixel and resource checks are measured; motion quality remains unreviewed. No original pixels in this report.",summary,actors};
mkdirSync(resolve(root,"animations"),{recursive:true});writeFileSync(resolve(root,"animations/catalog.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(summary));
