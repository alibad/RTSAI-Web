import type { DuelPlacement, DuelSample, DuelVisual } from "./duel-server";

export const ENCOUNTER_DRAG = "application/x-rtsai-actor";
export const projectEncounter = (mode: "ra2" | "classic", x: number, y: number, z = 0) => mode === "ra2" ? [(x-y)*30/1024,(x+y)*15/1024-z*30/1024] : [x*24/1024,y*24/1024-z*24/1024];
export function placementWorld(mode: "ra2" | "classic", u: number, v: number) {
  const y = mode === "classic" ? v : Math.floor(v/2)-u;
  const x = mode === "classic" ? u : v-y;
  return [x*1024+512,y*1024+512];
}
export function screenCell(mode: "ra2" | "classic", x: number, y: number) {
  const u=mode === "ra2" ? (x-30)/60 : x/24-.5;
  const v=mode === "ra2" ? (y-15)/15 : y/24-.5;
  return {u:Math.max(36,Math.min(92,Math.round(u))),v:Math.max(40,Math.min(92,Math.round(v)))};
}
export function setupSample(mode: "ra2" | "classic", placements: DuelPlacement[]): DuelSample {
  const counts=[0,0];
  return {tick:0,actors:placements.map(p=>{const [x,y]=placementWorld(mode,p.u,p.v);return {side:p.side,index:++counts[p.side],x,y,z:0,facing:p.side===0?768:256,health:1,maxHealth:1};})};
}
export function placementActor(placements: DuelPlacement[] | undefined, side: number, index: number, fallback: string[]) {
  return placements?.filter(p=>p.side===side)[index-1]?.id ?? fallback[side];
}
/** Interpolate observed trajectories, never extend a projectile beyond its last recorded tick. */
export function visualAt(records: DuelVisual[], tick: number) {
  const groups=new Map<number,DuelVisual[]>();
  for(const r of records){const g=groups.get(r.id)??[];g.push(r);groups.set(r.id,g);}
  return (time:number=tick)=>[...groups.values()].flatMap(g=>{
    if(time<g[0].tick||time>g.at(-1)!.tick+1)return [];
    let i=0;while(i+1<g.length&&g[i+1].tick<=time)i++;
    const a=g[i],b=g[Math.min(i+1,g.length-1)],t=Math.max(0,Math.min(1,(time-a.tick)/Math.max(1,b.tick-a.tick)));
    return [{...a,x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t}];
  });
}
