import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { ModelActor, ModelLibrary, ModelOption } from "./models";
const read=(path:string)=>{try{return JSON.parse(readFileSync(path,"utf8"));}catch{return null;}};
export function readModelLibrary(root:string,mode:"ra2"|"classic",nativeThumbnails:Record<string,string|null>={}):ModelLibrary|null{
  const plan=read(join(root,"models/manifest.json"));if(!plan)return null;
  const reuse=read(join(root,"models/reuse.json"));
  const sprites=read(join(root,"models/sprite-reuse.json"));
  const file=(path:unknown)=>{
    if(typeof path!=="string"||path.includes("\0")||/^[\\/]|^[a-z]:/i.test(path))return null;
    const absolute=resolve(root,path),within=relative(root,absolute);
    if(!within||within.startsWith("..")||within.split(sep).includes("..")||!existsSync(absolute)||!statSync(absolute).isFile())return null;
    const stat=statSync(absolute);
    return {url:`/api/art-review/file?path=${encodeURIComponent(within.split(sep).join("/"))}&v=${stat.mtimeMs}`,bytes:stat.size};
  };
  const actors:ModelActor[]=[];
  for(const raw of Object.values(plan.actors) as {key:string;mode:string;actor:string;name:string;category:string;factions:string[];job:string|null;status:string;nativeRender?:string}[]){
    if(raw.mode!==mode)continue;
    const job=raw.job?plan.jobs[raw.job]:null,options:ModelOption[]=[];
    const converted=reuse?.actors?.[raw.key],current=converted&&file(converted.mesh);
    if(current)options.push({id:"current-voxel",label:"Current voxel → GLB",url:current.url,bytes:current.bytes,triangles:converted.triangles??null,source:converted.source?.label??"Source unverified",remap:Boolean(converted.hasPlayerRemap),turret:Boolean(converted.hasTurret),status:"Existing geometry · native HVA playback pending"});
    const spriteActor=sprites?.actors?.[raw.key],spriteJob=spriteActor?.job?sprites.jobs[spriteActor.job]:null;
    // File validity is not visual validity. Never promote an unchecked reconstruction.
    if(spriteJob?.candidate&&spriteJob.qualityGate?.status==="passed"){
      const meta=read(join(root,spriteJob.candidate,"meta.json")),privateMesh=meta&&file(`${spriteJob.candidate}/${meta.files?.webMesh??"web.glb"}`);
      if(privateMesh)options.push({id:"sprite-reconstruction",label:"Sprite → inferred GLB draft",url:privateMesh.url,bytes:privateMesh.bytes,triangles:meta.webGeometry?.triangles??meta.geometry?.triangles??null,source:spriteActor.source?.label??"Source unverified",remap:meta.playerColor?.mapped===true,turret:false,status:"Private local reconstruction · unseen sides, rig, scale & actions unverified"});
    }
    const id=raw.job??raw.actor;
    if(/^[a-z0-9_-]+$/.test(id)){
      const directory=join(root,"units",id,"candidates");
      let folders:string[]=[];try{folders=readdirSync(directory);}catch{/* No drafts. */}
      for(const folder of folders){
        const meta=read(join(directory,folder,"meta.json"));if(!meta?.files?.mesh)continue;
        const mesh=file(`units/${id}/candidates/${folder}/${meta.files.mesh}`);if(!mesh)continue;
        const web=file(`units/${id}/candidates/${folder}/${meta.files.webMesh??"web.glb"}`);
        options.unshift({id:folder,label:folder.startsWith("mesh-v1-")?"New design · GLB draft":`Saved source · ${folder}`,url:web?.url??mesh.url,bytes:web?.bytes??mesh.bytes,triangles:meta.webGeometry?.triangles??meta.geometry?.triangles??null,source:"Project-generated source",remap:meta.playerColor?.mapped===true,turret:meta.independentTurret===true,status:meta.rig==="unrigged"?`Static geometry · ${meta.playerColor?.mapped===true?"inferred player-color mask; rig":"rig, team color"} & native exports pending`:"Source mesh · review pending"});
      }
    }
    const nativeThumbnail=nativeThumbnails[raw.actor]??null;
    actors.push({...raw,status:job?.status??(current?"existing-voxel-converted":raw.status),thumbnail:(job?file(job.input)?.url:null)??nativeThumbnail,nativeThumbnail,nativeFormat:raw.nativeRender==="voxel"?"VXL / HVA":"SHP",reconstructionNotice:spriteJob?.candidate&&spriteJob.qualityGate?.status!=="passed"?(spriteJob.qualityGate?.reason??"Sprite reconstruction held back: visual quality has not been verified."):null,options,requiredWork:job?.requiredWork??["Original 3D design","role scale","player-color regions","animation and native exports","owner review"]});
  }
  const jobs=Object.values(plan.jobs) as {status:string;apiSpendUsd?:number}[];
  const privateJobs=Object.values(sprites?.jobs??{}) as {status:string;apiSpendUsd?:number}[];
  const nativeExports={vxl:0,hva:0,shp:0};
  for(const job of Object.values(plan.jobs) as {candidate:string}[]){
    if(typeof job.candidate!=="string")continue;
    const meta=read(join(root,job.candidate,"meta.json"));
    for(const format of ["vxl","hva","shp"] as const)if(meta?.files?.[format]&&file(`${job.candidate}/${meta.files[format]}`))nativeExports[format]++;
  }
  const heldBack=Object.values(sprites?.jobs??{}).filter((j)=>{const draft=j as {candidate?:string;qualityGate?:{status:string}};return draft.candidate&&draft.qualityGate?.status!=="passed";}).length;
  return {mode,actors,jobs:{total:jobs.length,drafts:jobs.filter(j=>j.status==="geometry-draft").length,generating:jobs.filter(j=>j.status==="generating").length,failed:jobs.filter(j=>/failed|source-changed/.test(j.status)).length},privateJobs:{total:privateJobs.length,drafts:privateJobs.filter(j=>j.status==="geometry-draft").length,generating:privateJobs.filter(j=>j.status==="generating").length,failed:privateJobs.filter(j=>/failed|source-changed/.test(j.status)).length,heldBack},coverage:{total:actors.length,withGlb:actors.filter(a=>a.options.length>0).length},nativeExports,apiSpendUsd:[...jobs,...privateJobs].reduce((sum,j)=>sum+(j.apiSpendUsd??0),0)};
}
