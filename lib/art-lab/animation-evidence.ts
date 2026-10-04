import type { Shp } from "./shp";
import type { SpriteSequence } from "./types";
import { sequenceFrame,sequenceLength } from "./sprite-render";

/** Pixel equality can prove a repeated pose; it cannot approve movement quality. */
export function sequenceEvidence(seq:SpriteSequence,shp:Shp){
  const length=sequenceLength(seq,shp),facings=Math.max(1,seq.facings),unique:number[]=[],missing:number[]=[];
  for(let facing=0;facing<facings;facing++){
    const hashes=new Set<string>();
    for(let t=0;t<length;t++){
      const i=sequenceFrame(seq,t,facing*1024/facings,false,shp),frame=shp.frames[i];
      if(!frame){missing.push(i);continue;}
      let hash=2166136261;for(const b of frame.pixels)hash=Math.imul(hash^b,16777619);
      hashes.add(`${frame.x},${frame.y},${frame.width},${frame.height}:${hash>>>0}`);
    }
    unique.push(hashes.size);
  }
  return {sequence:seq.name,framesPerFacing:length,facings,tickMs:seq.tick,uniqueFramesByFacing:unique,missingFrames:[...new Set(missing)],status:missing.length?"invalid-frame-range":length>1&&Math.max(...unique)<=1?"repeated-pose":length>1?"animated-frames":"static-pose",visualQuality:"unreviewed"};
}
