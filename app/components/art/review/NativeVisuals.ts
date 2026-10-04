import { loadPlayerPalette, loadShp } from "../../../../lib/art-lab/client";
import type { DuelVisual } from "../../../../lib/art-lab/duel-server";
import type { Palette } from "../../../../lib/art-lab/pal";
import type { Shp } from "../../../../lib/art-lab/shp";
import type { PaletteSpec } from "../../../../lib/art-lab/spec";
import type { SpriteSequence } from "../../../../lib/art-lab/types";
import { composeLayers } from "../../../../lib/art-lab/sprite-compose";
import { toFrame, type Frame } from "./frames";

/** Native SHP effects from the private local API. Missing art stays visibly classified as a fallback. */
export class NativeVisuals {
  private sources=new Map<string,{shp:Shp;seq:SpriteSequence;pal:Palette}|null>();
  private pictures=new Map<string,Frame>();
  private alive=true;
  constructor(private mode:"ra2"|"classic",private changed:()=>void){}
  dispose(){this.alive=false;this.sources.clear();this.pictures.clear();}
  get(v:Pick<DuelVisual,"image"|"sequence"|"palette"|"frame"|"facing">){
    if(!v.image||!v.sequence)return null;
    const key=`${v.image}:${v.sequence}:${v.palette}`,angle=Math.round(v.facing/32)*32,picture=`${key}:${v.frame}:${angle}`;
    const cached=this.pictures.get(picture);if(cached)return cached;
    if(!this.sources.has(key)){
      this.sources.set(key,null);
      const query=new URLSearchParams({mode:this.mode,image:v.image,sequence:v.sequence,palette:v.palette});
      void fetch(`/api/art-review/visual?${query}`).then(async r=>{
        if(!r.ok)return;
        const art=await r.json() as {sequence:SpriteSequence;palette:PaletteSpec};
        const [shp,pal]=await Promise.all([loadShp(art.sequence.file!),loadPlayerPalette(art.palette,null)]);
        if(this.alive){this.sources.set(key,{shp,seq:art.sequence,pal});this.changed();}
      }).catch(()=>undefined);
      return null;
    }
    const src=this.sources.get(key);if(!src)return null;
    const image=composeLayers([{shp:src.shp,seq:src.seq,facing:angle,frame:v.frame}],src.pal,src.shp,src.seq,false);
    const frame=toFrame(image,null);this.pictures.set(picture,frame);
    if(this.pictures.size>512)this.pictures.delete(this.pictures.keys().next().value!);
    return frame;
  }
}
