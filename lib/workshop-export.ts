import { strToU8, zipSync } from "fflate";
import { actorFor, placementIssue, type Point, type Scene } from "./workshop";
import { rosters } from "./game-content";

export function nativePosition(scene: Scene, p: Point): Point {
  return scene.mode === "ra" ? { x: Math.round(p.x), y: Math.round(p.y) } : { x: Math.round(p.x) + scene.size / 2 + 2, y: Math.round(p.y) - scene.size / 2 + 2 };
}
export function nativeMapPosition(p: Point, mode: Scene["mode"]): Point {
  if(mode === "ra") return p;
  const v = p.x + p.y;
  return { x: (v - (v & 1)) / 2 - p.y, y: v };
}
export function compileWorkshopMap(scene: Scene) {
  for(const p of scene.pieces) { const issue=placementIssue(scene,p); if(issue) throw new Error(actorFor(p.actorKey).name + ": " + issue); }
  const iso = scene.mode === "ra2", width=iso?scene.size+4:scene.size, height=iso?scene.size*2+4:scene.size, area=width*height;
  const binary=new Uint8Array(17+area*5), view=new DataView(binary.buffer);
  view.setUint8(0,2); view.setUint16(1,width,true); view.setUint16(3,height,true); view.setUint32(5,17,true); view.setUint32(9,0,true); view.setUint32(13,17+area*3,true);
  // These are tile IDs, not extracted game images. Current tilesets validate them.
  const land=iso?0:255, water=iso?314:1, road=iso?216:178;
  for(let u=0;u<width;u++) for(let v=0;v<height;v++) { const index=u*height+v; view.setUint16(17+index*3,iso?water:land,true); }
  for(let y=0;y<scene.size;y++) for(let x=0;x<scene.size;x++) {
    const p=nativeMapPosition(nativePosition(scene,{x,y}),scene.mode), i=p.x*height+p.y, tile=scene.cells[y][x];
    view.setUint16(17+i*3,tile===1?water:tile===2?road:land,true);
    if(!iso && tile!==1 && tile!==2) view.setUint8(17+i*3+2,Math.abs((scene.seed+x*7+y*11)%16));
    if(tile===3) { view.setUint8(17+area*3+i*2,1); view.setUint8(17+area*3+i*2+1,9); }
  }
  const fallback=rosters.factions.find(f=>f.mode===scene.mode)!.id;
  const faction = (team:string) => scene.pieces.find(p=>p.team===team)?.faction??fallback;
  const title=scene.title.replace(/[\r\n:]/g," ").slice(0,80)||"Workshop map";
  const player=(id:string,color:string,side:string,enemy:string,spawn:number)=>"\tPlayerReference@"+id+":\n\t\tName: "+id+"\n\t\tPlayable: True\n\t\tFaction: "+side+"\n\t\tColor: "+color+"\n\t\tEnemies: "+enemy+", Creeps\n\t\tSpawn: "+spawn+"\n";
  const yaml="MapFormat: 12\n\nRequiresMod: "+(iso?"rtsai":"ra")+"\n\nTitle: "+title+"\n\nAuthor: RTS AI Workshop\n\nTileset: "+(iso?"TEMPERATE":"TEMPERAT")+"\n\nMapSize: "+width+","+height+"\n\nBounds: 1,1,"+(width-2)+","+(height-2)+"\n\nVisibility: Lobby\n\nCategories: Conquest\n\nPlayers:\n\tPlayerReference@Neutral:\n\t\tName: Neutral\n\t\tOwnsWorld: True\n\t\tNonCombatant: True\n\t\tFaction: "+fallback+"\n\tPlayerReference@Creeps:\n\t\tName: Creeps\n\t\tNonCombatant: True\n\t\tFaction: "+fallback+"\n\t\tEnemies: Multi0, Multi1\n"+player("Multi0","77C3DE",faction("blue"),"Multi1",1)+player("Multi1","E8997F",faction("red"),"Multi0",2)+"\nActors:\n"+
    scene.spawns.map((p,i)=>{const n=nativePosition(scene,p);return "\tStart"+i+": mpspawn\n\t\tOwner: Neutral\n\t\tLocation: "+n.x+","+n.y;}).join("\n")+"\n"+
    scene.pieces.filter(p=>p.health>0).map(p=>{const n=nativePosition(scene,p);return "\tPiece"+p.id+": "+actorFor(p.actorKey).id+"\n\t\tOwner: "+(p.team==="blue"?"Multi0":p.team==="red"?"Multi1":"Neutral")+"\n\t\tLocation: "+n.x+","+n.y;}).join("\n")+"\n";
  return {binary,yaml,width,height};
}
export function workshopArchive(scene: Scene, preview: Uint8Array) {
  const map=compileWorkshopMap(scene);
  return zipSync({"map.yaml":strToU8(map.yaml),"map.bin":map.binary,"map.png":preview,"workshop-scene.json":strToU8(JSON.stringify(scene)),"workshop-readme.txt":strToU8("RTS AI Workshop\n\nFlat experimental terrain and initial actor placements.\nBrowser battle results are approximate; OpenRA runs the native rules.\nDeploy, rank and manually toggled conditions are browser experiments and are not exported as native actor upgrades.\nRequires "+(scene.mode==="ra2"?"RTSAI-Mod and your own Red Alert 2 files.":"the Classic OpenRA AI development build.")+"\nNo original commercial images or models are included.\nSource rules: "+scene.ruleCommit+"\n")},{level:6});
}

