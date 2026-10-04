/** CPU-only composition into ignored LOCAL caches. Original pixels never enter public/build output. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { decodeShp } from "../lib/art-lab/shp";
import { decodePal } from "../lib/art-lab/pal";
import { remapPalette } from "../lib/art-lab/remap";
import { composeRig, spriteRig, rigFiles } from "../lib/art-lab/sprite-compose";
import { encodePng } from "../lib/art-lab/originals";
import type { RosterPayload } from "../lib/art-lab/originals";
const root=resolve("../RTSAI-Art"),base="http://127.0.0.1:3461";
const plan=JSON.parse(readFileSync(resolve(root,"models/manifest.json"),"utf8"));
const oldPath=resolve(root,"models/sprite-reuse.json"),old=existsSync(oldPath)?JSON.parse(readFileSync(oldPath,"utf8")):null;
const sha=(data:Uint8Array)=>createHash("sha256").update(data).digest("hex");
const cache=new Map<string,Promise<Uint8Array>>();
const bytes=(url:string)=>{if(!url.startsWith("/api/art-review/"))throw Error("Local asset routes only");let hit=cache.get(url);if(!hit){hit=fetch(base+url).then(async r=>{if(!r.ok)throw Error(`Source unavailable (${r.status})`);return new Uint8Array(await r.arrayBuffer());});cache.set(url,hit);}return hit;};
const output:{schemaVersion:number;policy:string;actors:Record<string,unknown>;jobs:Record<string,unknown>}={schemaVersion:1,policy:"Sprite-inferred reconstruction drafts; all input pixels and geometry local in ignored caches. No original 3D geometry is claimed.",actors:{},jobs:{}};
for(const mode of ["ra2","classic"] as const){
  const roster=await(await fetch(`${base}/api/art-review/roster?mode=${mode}`)).json() as RosterPayload;
  for(const [actor,stock] of Object.entries(roster.stock)){
    const key=`${mode}:${actor}`,spec=stock.spec;
    if(!plan.actors[key]||plan.actors[key].job||spec.voxel)continue;
    try{
      const rig=spriteRig(stock.sprite,"stand");if(!rig||!spec.palette)throw Error("No complete sprite rig/palette");
      if(rig.body.name==="icon"||rig.body.usedBy.some(u=>u.startsWith("Buildable icon")))throw Error("Build-menu icons cannot be reconstructed as actor bodies");
      const files=await Promise.all(rigFiles(rig).map(async url=>({url,data:await bytes(url)})));
      const shps=new Map(files.map(f=>[f.url,decodeShp(f.data)]));
      const paletteData=await bytes(spec.palette.url),palette=remapPalette(decodePal(paletteData,spec.palette.transparent,spec.palette.shadow),spec.palette.remap,[224,0,0]);
      // Match building roofs/doors and machinery through the same composition as the Studio.
      const image=composeRig(rig,{body:shps.get(rig.body.file!)!,turret:rig.turret?shps.get(rig.turret.file!)??null:null,overlay:null,overlays:rig.overlays.map(o=>shps.get(o.seq.file!)??null)},palette,{facing:640,turretFacing:0,tick:0,shadow:false});
      let left=image.width,top=image.height,right=-1,bottom=-1;
      for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)if(image.data[(y*image.width+x)*4+3]>0){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
      if(right<left||bottom<top)throw Error("Empty visible source");
      const width=right-left+1,height=bottom-top+1,margin=Math.max(4,Math.ceil(Math.max(width,height)*.08)),w=width+2*margin,h=height+2*margin,rgba=new Uint8Array(w*h*4);
      for(let y=0;y<height;y++)rgba.set(image.data.subarray(((top+y)*image.width+left)*4,((top+y)*image.width+right+1)*4),((y+margin)*w+margin)*4);
      const png=encodePng(w,h,rgba),digest=sha(png),id=digest.slice(0,24),rel=`.cache/models/sprite-inputs/${id}/input.png`,dir=resolve(root,rel,"..");mkdirSync(dir,{recursive:true});writeFileSync(resolve(root,rel),png);
      const sourceHashes=Object.fromEntries(files.map(f=>[f.url,sha(f.data)]));sourceHashes[spec.palette.url]=sha(paletteData);
      const previous=old?.jobs?.[id]?.inputSha256===digest?old.jobs[id]:{};
      output.jobs[id]={...previous,id,input:rel,inputSha256:digest,status:previous.status??"queued",privateLocal:true,category:spec.category,source:stock.sources?.model??null,sourceHashes,sourcePixels:{width,height},sourceActor:key,sourceBodySequence:rig.body.name,sourceBodyFile:rig.body.file};
      output.actors[key]={key,mode,actor,job:id,name:stock.info?.name??actor,source:stock.sources?.model??null,status:previous.status??"queued"};
    }catch(error){output.actors[key]={key,mode,actor,status:"source-unavailable",error:String(error)};}
  }
}
mkdirSync(resolve(root,"models"),{recursive:true});const destination=resolve(root,"models/sprite-reuse.json"),temp=destination+`.${process.pid}.tmp`;writeFileSync(temp,JSON.stringify(output,null,2)+"\n");renameSync(temp,destination);
console.log(JSON.stringify({actors:Object.keys(output.actors).length,uniqueSpriteInputs:Object.keys(output.jobs).length,unavailable:Object.values(output.actors).filter((a:unknown)=>(a as {status:string}).status==="source-unavailable").length,pixels:"ignored local cache only"}));
