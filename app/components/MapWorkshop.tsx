"use client";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Building2, Download, Footprints, Hand, MousePointer2, Pause, Plane, Play, Search, Shield, Ship, Swords, Truck, Undo2, Redo2, Upload, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { rosters, rosterFactions, rosterActors, categoryLabels, modeLabel, type GameMode } from "../../lib/game-content";
import { activeWeapons, actorFor, canDeploy, conditionActive, conditionNames, createWorld, dimensions, generateScene, issueOrder, makePiece, maxHealth, paintScene, parseScene, placementIssue, prototypeRange, scenarioJson, stepWorld, type Piece, type Point, type Preset, type Scene, type Team, type Terrain } from "../../lib/workshop";
import { drawWorld, fitScale, footprintCenter, project, screenToCell, terrainCanvas, type Camera } from "../../lib/workshop-renderer";
import type { WorkshopUnitArt } from "../../lib/workshop-units";
import { workshopArchive } from "../../lib/workshop-export";
import { useAuth } from "./AuthProvider";
import { WorkshopEarth } from "./WorkshopEarth";
import type { EarthFeature } from "../../lib/oramap";
import { campaignPreviewStorage, campaignResultStorage, checkMission, parsePreview } from "../../lib/campaign";
import { OptionSelect, SearchSelect, type Option } from "./ui/fields";
import { factionOptions, teamOptions, type FlagMap } from "./pickers";

type Tool = "select" | "place" | "move" | "attack" | "pan" | "land" | "water" | "road" | "ore" | "erase";
type Phase = "edit" | "running" | "paused";
const brushes: Partial<Record<Tool, Terrain>> = { land: 0, water: 1, road: 2, ore: 3 };
const storageKey = "rtsai-workshop-scene-v1";
const icons = { infantry: Footprints, vehicle: Truck, aircraft: Plane, ship: Ship, defense: Shield, structure: Building2 };
const tools: { id: Tool; label: string }[] = [{id:"select",label:"Select"},{id:"move",label:"Move"},{id:"attack",label:"Attack"},{id:"pan",label:"Pan"},{id:"land",label:"Land"},{id:"water",label:"Water"},{id:"road",label:"Road"},{id:"ore",label:"Ore"},{id:"erase",label:"Erase"}];
const gridOptions: Option<Scene["size"]>[] = ([64, 96, 128] as const).map(n => ({ value: n, label: `${n} × ${n}` }));
const landscapeOptions: Option<Preset>[] = (["river", "coast", "islands", "plains", "earth"] as const).map(p => ({ value: p, label: p === "earth" ? "Earth / OpenStreetMap" : p[0].toUpperCase() + p.slice(1) }));
const categoryOptions: Option[] = [{ value: "all", label: "All actors" }, ...Object.entries(categoryLabels).map(([value, label]) => ({ value, label }))];
const rateOptions: Option<number>[] = [.5, 1, 2, 4].map(r => ({ value: r, label: `${r}×` }));
const rankOptions: Option<Piece["rank"]>[] = (["rookie", "veteran", "elite"] as const).map(r => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }));
const brushOptions: Option<number>[] = [{ value: 0, label: "Single cell" }, { value: 1, label: "3 × 3" }, { value: 2, label: "5 × 5" }];
function download(data: Blob, name: string) {
  const url=URL.createObjectURL(data), a=document.createElement("a"); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),3000);
}
export function starterScene(mode: GameMode, seed=42, size: Scene["size"]=64, preset: Preset="river") {
  const scene=generateScene(mode,seed,size,preset==="earth"?"river":preset);
  scene.title="Crossing laboratory";
  const middle=Math.floor(size/2);
  for(const team of ["blue","red"] as const) {
    const faction=rosterFactions(mode).find(f=>f.id===(team==="blue"?"china":"russia")) ?? rosterFactions(mode)[0];
    const actors=rosterActors(faction);
    const sign=team==="blue"?-1:1;
    for(const [category,dx,dy] of [["vehicle",5,0],["infantry",7,2],["defense",10,5],["structure",14,9]] as const) {
      const candidates=actors.filter(a=>a.category===category && (category==="structure" || a.behavior.weapons.some(w=>(w.damage??0)>0 && (w.range??0)>=(category==="infantry"?3:2) && w.targets.some(t=>["Ground","GroundActor","Vehicle","Infantry","Structure"].includes(t)) && conditionActive(w.condition,{rank:"rookie",deployed:false,powered:true,flags:[]}))));
      if(category==="vehicle")candidates.sort((a,b)=>Number(b.behavior.armor==="Heavy")-Number(a.behavior.armor==="Heavy")||Math.abs(maxHealth(a)-(mode==="ra2"?300:30000))-Math.abs(maxHealth(b)-(mode==="ra2"?300:30000)));
      const actor=candidates[0] ?? actors.find(a=>a.category===category);
      if(!actor) continue;
      let done=false;
      for(let r=0;r<12&&!done;r++) for(let y=-r;y<=r&&!done;y++) for(let x=-r;x<=r&&!done;x++) {
        const piece=makePiece(scene,actor.key,faction.id,team,{x:middle+sign*dx+x,y:middle+sign*dy+y});
        if(!placementIssue(scene,piece)){scene.pieces.push(piece);done=true;}
      }
    }
  }
  return scene;
}

export function MapWorkshop({initialMode="ra2",campaignPreview=false,flags={}}:{initialMode?:GameMode;campaignPreview?:boolean;flags?:FlagMap}) {
  const [campaignContext,setCampaignContext]=useState<ReturnType<typeof parsePreview>|null>(null);
  const [scene,setScene]=useState(()=>starterScene(initialMode));
  const doc=useRef(scene), world=useRef(createWorld(scene));
  const [hud,setHud]=useState(()=>createWorld(scene));
  const [phase,setPhase]=useState<Phase>("edit"), phaseRef=useRef<Phase>("edit");
  const [clock,setClock]=useState(0);
  const [selected,setSelected]=useState<number|null>(1), selectedRef=useRef(selected);
  const [tool,setTool]=useState<Tool>("select"), [actorKey,setActorKey]=useState("");
  const [faction,setFaction]=useState("china"), [team,setTeam]=useState<Team>("blue");
  const [query,setQuery]=useState(""), [category,setCategory]=useState("all");
  const [notice,setNotice]=useState("Drag an actor onto land. Select it, then right-click to move or attack. Run to start the experiment.");
  const [seed,setSeed]=useState(42), [size,setSize]=useState<Scene["size"]>(64), [preset,setPreset]=useState<Preset>("river"), [title,setTitle]=useState("Crossing laboratory");
  const [latitude,setLatitude]=useState(24.7136), [longitude,setLongitude]=useState(46.6753), [acquiring,setAcquiring]=useState(false);
  const [camera,setCamera]=useState<Camera>({panX:0,panY:0,zoom:2.3,iso:initialMode==="ra2"}), cameraRef=useRef(camera);
  const [ranges,setRanges]=useState(false), rangesRef=useRef(false);
  const [auto,setAuto]=useState(true), autoRef=useRef(true), [rate,setRate]=useState(1), rateRef=useRef(1);
  const [brush,setBrush]=useState(0), [coordinate,setCoordinate]=useState<Point>({x:32,y:32}), [placeX,setPlaceX]=useState(24), [placeY,setPlaceY]=useState(32);
  const undo=useRef<Scene[]>([]), redo=useRef<Scene[]>([]), [history,setHistory]=useState({undo:0,redo:0});
  const canvas=useRef<HTMLCanvasElement>(null), minimap=useRef<HTMLCanvasElement>(null), terrain=useRef<HTMLCanvasElement|null>(null);
  const dimensionsRef=useRef({width:800,height:640}), hover=useRef<Point|null>(null);
  const ghost=useRef<Piece|null>(null);
  const gesture=useRef<{kind:"pan"|"piece"|"paint";start:Point;origin:Point;id?:number;before?:Scene;last?:string;changed?:boolean}|null>(null);
  const loaded=useRef(false), mounted=useRef(true), abort=useRef<AbortController|null>(null), input=useRef<HTMLInputElement>(null);
  const {user,openAuth}=useAuth();
  // Unit art (lib/unit-art): rasterized in workers, drawn from one atlas. Its status line says where the art comes from.
  const art=useRef<WorkshopUnitArt|null>(null), [artStatus,setArtStatus]=useState<{local:boolean|null;missing:number}>({local:null,missing:0});
  // The battlefield redraws only when something changed (or while the battle runs): an idle page does no work.
  const dirty=useRef(true), kick=useRef<()=>void>(()=>{}), cameraCommit=useRef<ReturnType<typeof setTimeout>|null>(null);
  const invalidate=useCallback(()=>{dirty.current=true;kick.current();},[]);
  /** Camera moves (wheel, drag) apply at once; the React state behind the zoom readout follows at most every 120 ms. */
  const moveCamera=useCallback((value:Camera)=>{cameraRef.current=value;invalidate();if(!cameraCommit.current)cameraCommit.current=setTimeout(()=>{cameraCommit.current=null;setCamera(cameraRef.current);},120);},[invalidate]);
  useEffect(()=>{selectedRef.current=selected;},[selected]);
  useEffect(()=>{cameraRef.current=camera;invalidate();},[camera,invalidate]);
  useEffect(()=>{rangesRef.current=ranges;},[ranges]);
  useEffect(()=>{autoRef.current=auto;world.current.auto=auto;},[auto]);
  useEffect(()=>{rateRef.current=rate;},[rate]);
  useEffect(()=>{terrain.current=terrainCanvas(scene,camera.iso);invalidate();},[scene,camera.iso,invalidate]);
  // Any committed change (selection, orders, options) repaints once.
  useEffect(()=>{invalidate();});
  useEffect(()=>{
    // ?authored=1 shows only the project's published art even in the local app (for screenshots that may be shared).
    const authored=new URLSearchParams(window.location.search).get("authored")==="1";
    // Loaded after first paint, in its own chunk: workers, decoders and the atlas never delay the page.
    let alive=true,cleanup=()=>{};
    void Promise.all([import("../../lib/unit-art/service"),import("../../lib/workshop-units")]).then(([{UnitArtService},{WorkshopUnitArt}])=>{
    if(!alive)return;
    const service=new UnitArtService(scene.mode,authored?{probeLocal:false}:{}), layer=new WorkshopUnitArt(service,scene.mode);
    art.current=layer;
    const off=service.subscribe(()=>{invalidate();
      // Read by scripts/workshop-perf.mjs: frames drawn, frames queued and where the art comes from.
      const host=canvas.current?.parentElement;if(host){host.dataset.artFrames=String(service.atlas.size);host.dataset.artPending=String(service.pending);host.dataset.artSource=service.local===null?"":service.local?"local":"public";}
      const keys=[...new Set(world.current.pieces.map(p=>p.actorKey))];setArtStatus(s=>{const next={local:service.local,missing:keys.filter(k=>service.meta(k)===null).length};return s.local===next.local&&s.missing===next.missing?s:next;});});
    invalidate();
    cleanup=()=>{off();service.dispose();if(art.current===layer)art.current=null;};
    });
    return()=>{alive=false;cleanup();};
  },[scene.mode,invalidate]);
  function changePhase(next:Phase){phaseRef.current=next;setPhase(next);}
  function remember(previous:Scene){undo.current.push(previous);if(undo.current.length>30)undo.current.shift();redo.current=[];setHistory({undo:undo.current.length,redo:0});}
  function refresh(){setHud({...world.current,pieces:world.current.pieces.map(p=>({...p,flags:[...p.flags]})),log:[...world.current.log]});}
  function replace(next:Scene,withHistory=true){if(withHistory)remember(doc.current);doc.current=next;world.current=createWorld(next);world.current.auto=autoRef.current;setScene(next);refresh();changePhase("edit");setClock(0);}
  useEffect(()=>{
    mounted.current=true;
    const timer=setTimeout(()=>{
    try{
      const preview=campaignPreview?sessionStorage.getItem(campaignPreviewStorage):null;
      if(campaignPreview&&!preview)throw new Error("Reopen this mission from Campaign studio.");
      const context=preview?parsePreview(preview):null,saved=context?null:localStorage.getItem(storageKey);
      if(context||saved){const next=context?.scene??parseScene(saved!);setCampaignContext(context);doc.current=next;world.current=createWorld(next);setHud(createWorld(next));setScene(next);setSeed(next.seed);setSize(next.size);setPreset(next.preset);setTitle(next.title);setSelected(next.pieces[0]?.id??null);setCamera({panX:0,panY:0,zoom:2.3,iso:next.mode==="ra2"});setNotice(context?"Campaign playtest. Move the player actor to the destination; use the inspector Repair action for the damaged building. Your regular battlefield is preserved.":"Restored your locally saved scene.");}
    }catch{setNotice("The saved scene could not be restored. Your starter is ready.");}
    loaded.current=true;
    },0);
    return()=>{clearTimeout(timer);mounted.current=false;abort.current?.abort();};
  },[campaignPreview]);
  useEffect(()=>{
    if(!loaded.current||campaignPreview)return;
    const timer=setTimeout(()=>{try{localStorage.setItem(storageKey,scenarioJson(scene));}catch{setNotice("Browser storage is full. Use Save scene to keep your work.");}},500);
    return()=>clearTimeout(timer);
  },[scene,campaignPreview]);
  useEffect(()=>{
    const node=canvas.current;
    if(!node)return;
    const observer=new ResizeObserver(()=>{
      const rect=node.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2);
      dimensionsRef.current={width:rect.width,height:rect.height};node.width=Math.round(rect.width*dpr);node.height=Math.round(rect.height*dpr);
      dirty.current=true;kick.current();
    });observer.observe(node);
    let frame=0,last=performance.now(),accumulator=0,hud=last;
    const tick=(now:number)=>{
      frame=0;
      const running=phaseRef.current==="running",dt=Math.min(.2,(now-last)/1000);last=now;
      if(running){accumulator+=dt*rateRef.current;let steps=0;while(accumulator>=.04&&steps++<20){stepWorld(world.current,.04);accumulator-=.04;}}else accumulator=0;
      if(running||dirty.current){
        dirty.current=false;
        const {width,height}=dimensionsRef.current,ctx=node.getContext("2d"),map=terrain.current;
        if(ctx&&map){ctx.setTransform(node.width/width,0,0,node.height/height,0,0);const preview=ghost.current;const drawn=preview?{...world.current,pieces:[...world.current.pieces.filter(p=>p.id!==preview.id),{...createWorld({...doc.current,pieces:[preview]}).pieces[0]}]}:world.current;drawWorld(ctx,doc.current,drawn,map,cameraRef.current,width,height,preview?.id??selectedRef.current,rangesRef.current,hover.current,art.current);}
        const mini=minimap.current,mc=mini?.getContext("2d");
        if(mini&&mc&&map){mc.clearRect(0,0,mini.width,mini.height);mc.drawImage(map,0,0,mini.width,mini.height);for(const p of world.current.pieces){if(p.health<=0)continue;const q=project(footprintCenter(p),doc.current.size,cameraRef.current.iso);mc.fillStyle=p.team==="blue"?"#9ddcf1":p.team==="red"?"#ff9a7d":"#eee7cc";mc.fillRect(q.x/map.width*mini.width-2,q.y/map.height*mini.height-2,4,4);}}
      }
      if(running&&now-hud>200){setClock(world.current.time);setHud({...world.current,pieces:world.current.pieces.map(p=>({...p,flags:[...p.flags]})),log:[...world.current.log]});hud=now;}
      if(running||dirty.current)frame=requestAnimationFrame(tick);
    };
    kick.current=()=>{if(!frame){last=performance.now();frame=requestAnimationFrame(tick);}};
    kick.current();
    const wheel=(event:WheelEvent)=>{
      event.preventDefault();
      const old=cameraRef.current,next=Math.max(.7,Math.min(8,old.zoom*Math.exp(-event.deltaY*.0015))),r=next/old.zoom;
      const rect=node.getBoundingClientRect(),x=event.clientX-rect.left-rect.width/2,y=event.clientY-rect.top-rect.height/2;
      moveCamera({...old,zoom:next,panX:x-(x-old.panX)*r,panY:y-(y-old.panY)*r});
    };node.addEventListener("wheel",wheel,{passive:false});
    return()=>{cancelAnimationFrame(frame);frame=0;kick.current=()=>{};observer.disconnect();node.removeEventListener("wheel",wheel);if(cameraCommit.current)clearTimeout(cameraCommit.current);};
  },[moveCamera]);
  const countries=rosterFactions(scene.mode), country=countries.find(f=>f.id===faction)??countries[0];
  const palette=rosterActors(country).filter(a=>a.behavior.health!==null&&(category==="all"||a.category===category)&&a.name.toLowerCase().includes(query.toLowerCase()));
  const piece=hud.pieces.find(p=>p.id===selected), actor=piece?actorFor(piece.actorKey):null;
  const editable=phase==="edit";
  function at(client:Point){const rect=canvas.current!.getBoundingClientRect();return screenToCell({x:client.x-rect.left,y:client.y-rect.top},doc.current,cameraRef.current,rect.width,rect.height);}
  function pick(point:Point){
    const cursor=project(point,doc.current.size,cameraRef.current.iso);
    return [...world.current.pieces].sort((a,b)=>b.x+b.y-a.x-a.y).find(p=>{
      if(p.health<=0)return false;
      const a=actorFor(p.actorKey),[w,h]=dimensions(a),q=project(footprintCenter(p),doc.current.size,cameraRef.current.iso);
      if(a.category==="aircraft")return Math.hypot(cursor.x-q.x,cursor.y-q.y+25)<=23;
      if(a.category==="structure"||a.category==="defense"){const wide=Math.max(14,(w+h)*7),tall=a.category==="defense"?18:18+Math.min(16,w*3);return Math.abs(cursor.x-q.x)<wide&&cursor.y-q.y>-(w+h)*3.5-tall&&cursor.y-q.y<(w+h)*3.5;}
      return Math.hypot(cursor.x-q.x,cursor.y-q.y)<(a.category==="infantry"?13:24);
    });
  }
  function add(point:Point,key=actorKey){
    if(!editable){setNotice("Reset the battle to edit actor placements.");return;}
    if(!country.actors.includes(key)){setNotice("Choose an actor from this faction first.");return;}
    const p=makePiece(doc.current,key,country.id,team,point),issue=placementIssue(doc.current,p);
    if(issue){setNotice(issue);return;}
    replace({...doc.current,pieces:[...doc.current.pieces,p]});setSelected(p.id);setNotice(actorFor(key).name+" placed for "+team+".");
  }
  function remove(){if(!piece||!editable)return;replace({...doc.current,pieces:doc.current.pieces.filter(p=>p.id!==piece.id)});setSelected(null);}
  function interact(point:Point,action=tool){
    if(action==="place"){add(point);return;}
    const target=pick(point);
    if(action==="erase"){if(!editable)return;if(target){replace({...doc.current,pieces:doc.current.pieces.filter(p=>p.id!==target.id)});setSelected(null);}return;}
    if(action==="move"||action==="attack"){
      if(!piece){setNotice("Select an actor first.");return;}
      const ok=issueOrder(world.current,piece.id,action==="move"?{type:"move",point}:{type:"attack",targetId:target?.id});
      if(ok){if(phaseRef.current==="edit")changePhase("paused");setClock(world.current.time+.00001);setNotice(action==="move"?"Move ordered. Run or step the battle.":"Attack ordered. Run or step the battle.");}
      else setNotice(action==="move"?"This actor cannot reach that cell. Check terrain, deployment and building footprints.":"Choose an enemy this actor can damage with its active weapon.");
      return;
    }
    setSelected(target?.id??null);
  }
  function paintAt(point:Point){
    const g=gesture.current,key=Math.round(point.x)+","+Math.round(point.y),value=brushes[tool];
    if(!g||g.last===key||value===undefined)return;
    g.last=key;g.changed=true;const next=paintScene(doc.current,point,value,brush);doc.current=next;world.current=createWorld(next);world.current.auto=autoRef.current;setScene(next);
  }
  function pointerDown(e:ReactPointerEvent<HTMLCanvasElement>){
    if(e.button!==0)return;e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);
    const point=at({x:e.clientX,y:e.clientY});
    if(tool==="pan"||e.shiftKey){gesture.current={kind:"pan",start:{x:e.clientX,y:e.clientY},origin:{x:cameraRef.current.panX,y:cameraRef.current.panY}};return;}
    if(brushes[tool]!==undefined){if(!editable){setNotice("Reset the battle to paint terrain.");return;}gesture.current={kind:"paint",start:point,origin:point,before:doc.current};paintAt(point);return;}
    const hit=pick(point);
    if(tool==="select"&&editable&&hit){setSelected(hit.id);gesture.current={kind:"piece",id:hit.id,start:{x:e.clientX,y:e.clientY},origin:point};return;}
    interact(point);
  }
  function pointerMove(e:ReactPointerEvent<HTMLCanvasElement>){
    const point=at({x:e.clientX,y:e.clientY}),x=Math.round(point.x),y=Math.round(point.y),moved=Math.round(hover.current?.x??NaN)!==x||Math.round(hover.current?.y??NaN)!==y;hover.current=point;
    if(moved){setCoordinate(c=>c.x===x&&c.y===y?c:{x,y});invalidate();}
    const g=gesture.current;if(!g)return;
    if(g.kind==="pan"){moveCamera({...cameraRef.current,panX:g.origin.x+e.clientX-g.start.x,panY:g.origin.y+e.clientY-g.start.y});}
    else if(g.kind==="paint")paintAt(point);
    else {g.changed=Math.hypot(e.clientX-g.start.x,e.clientY-g.start.y)>5;const original=doc.current.pieces.find(p=>p.id===g.id);if(original&&g.changed){ghost.current={...original,x:Math.round(point.x),y:Math.round(point.y)};invalidate();}}
  }
  function pointerUp(e:ReactPointerEvent<HTMLCanvasElement>){
    const g=gesture.current;gesture.current=null;ghost.current=null;invalidate();
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    if(g?.kind==="paint"&&g.changed&&g.before)remember(g.before);
    if(g?.kind==="piece"&&g.changed){
      const p=doc.current.pieces.find(p=>p.id===g.id);if(!p)return;
      const point=at({x:e.clientX,y:e.clientY}),next={...p,x:Math.round(point.x),y:Math.round(point.y)},issue=placementIssue(doc.current,next);
      if(issue){setNotice(issue);return;}
      replace({...doc.current,pieces:doc.current.pieces.map(p=>p.id===next.id?next:p)});setNotice("Actor repositioned.");
    }
  }
  function patchPiece(patch:Partial<Piece>){
    if(!piece)return;
    if(editable)replace({...doc.current,pieces:doc.current.pieces.map(p=>p.id===piece.id?{...p,...patch}:p)});
    else {const live=world.current.pieces.find(p=>p.id===piece.id);if(live){Object.assign(live,patch);if(patch.deployed)live.path=[];}refresh();}
  }
  function restore(next:Scene){replace(next,false);setSeed(next.seed);setSize(next.size);setPreset(next.preset);setTitle(next.title);setActorKey("");setSelected(next.pieces[0]?.id??null);setCamera({panX:0,panY:0,zoom:1,iso:next.mode==="ra2"});}
  function historyMove(back:boolean){const from=back?undo:redo,to=back?redo:undo,next=from.current.pop();if(!next)return;to.current.push(doc.current);restore(next);setHistory({undo:undo.current.length,redo:redo.current.length});}
  function reset(){world.current=createWorld(doc.current);world.current.auto=autoRef.current;refresh();changePhase("edit");setClock(0);setNotice("Battle reset to your saved placements. Editing is available.");}
  function run(){if(!world.current.pieces.some(p=>p.health>0)){setNotice("Place actors before running.");return;}changePhase("running");}
  function singleStep(){if(phase==="running")return;stepWorld(world.current,.04);changePhase("paused");setClock(world.current.time);invalidate();}
  function generate(mode=scene.mode,example=false){
    abort.current?.abort();const next=example?starterScene(mode,seed,size,preset):generateScene(mode,seed,size,preset==="earth"?"river":preset);
    if(!example)next.title=title.trim().slice(0,80)||"Workshop map";
    replace(next);setSelected(next.pieces[0]?.id??null);setActorKey("");setFaction("china");setCamera({panX:0,panY:0,zoom:example?2.3:1,iso:mode==="ra2"});setNotice(example?"Starter loaded. Run the battle or drag an actor to change the setup.":"New map generated. Drag actors from the palette to build your scene.");
  }
  async function earth(){
    if(!user){openAuth("Sign in to import OpenStreetMap terrain. Procedural maps work without an account.");return;}
    if(!Number.isFinite(latitude)||Math.abs(latitude)>85||!Number.isFinite(longitude)||Math.abs(longitude)>180){setNotice("Enter valid Earth coordinates.");return;}
    abort.current?.abort();const controller=new AbortController();abort.current=controller;setAcquiring(true);
    try{const token=await user.getIdToken();const response=await fetch("/api/earth-features",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify({latitude,longitude,radiusM:3500}),signal:controller.signal});if(!response.ok)throw new Error("Earth import unavailable ("+response.status+").");const data=await response.json();if(!Array.isArray(data.features)||!data.features.length)throw new Error("No Earth features returned. Try another location.");const next=generateScene(doc.current.mode,seed,size,"earth",data.features as EarthFeature[],latitude,longitude);next.title=title.trim().slice(0,80)||"Earth workshop";if(!mounted.current||controller.signal.aborted)return;replace(next);setSelected(null);setCamera({panX:0,panY:0,zoom:1,iso:next.mode==="ra2"});setNotice("Earth terrain imported. Source geometry is simplified onto this grid.");}
    catch(error){if(mounted.current&&!controller.signal.aborted)setNotice(error instanceof Error?error.message:"Earth import failed.");}
    finally{if(mounted.current&&abort.current===controller)setAcquiring(false);}
  }
  async function importScene(file:File){try{if(file.size>2_000_000)throw new Error("Scene file is too large.");const next=parseScene(await file.text());remember(doc.current);restore(next);setNotice("Scene loaded and validated against the current actor catalog.");}catch(error){setNotice(error instanceof Error?error.message:"Invalid scene.");}}
  function exportMap(){try{const image=terrainCanvas(doc.current,doc.current.mode==="ra2");const bytes=Uint8Array.from(atob(image.toDataURL("image/png").split(",")[1]),c=>c.charCodeAt(0));download(new Blob([workshopArchive(doc.current,bytes) as BlobPart],{type:"application/zip"}),"rtsai-"+scene.mode+"-"+scene.seed+".oramap");setNotice("OpenRA map exported with initial placements. Rank, deployment and condition experiments stay in the JSON scene.");}catch(error){setNotice(error instanceof Error?error.message:"Map export failed.");}}
  function focus(id:number){const p=world.current.pieces.find(p=>p.id===id);if(!p)return;setSelected(id);const camera=cameraRef.current,q=project(footprintCenter(p),scene.size,camera.iso),map=terrain.current;if(!map)return;const d=dimensionsRef.current,s=fitScale(scene,d.width,d.height,camera.iso)*camera.zoom;setCamera({...camera,panX:(map.width/2-q.x)*s,panY:(map.height/2-q.y)*s});}
  function zoom(factor:number){const camera=cameraRef.current;setCamera({...camera,zoom:Math.max(.7,Math.min(8,camera.zoom*factor))});}
  const weapons=piece?activeWeapons(piece):[];
  const missionResult=campaignContext?checkMission(campaignContext.mission,hud):null;
  function returnToCampaign(attach:boolean){if(!campaignContext)return;try{const result=checkMission(campaignContext.mission,world.current);sessionStorage.setItem(campaignResultStorage,JSON.stringify({version:1,campaignId:campaignContext.campaign.id,source:JSON.stringify(campaignContext.campaign),missionId:campaignContext.mission.id,status:result.status,seconds:world.current.time,checks:result.checks,evidence:"browser-prototype",ruleCommit:doc.current.ruleCommit,...(attach?{scene:parseScene(scenarioJson(doc.current))}:{})}));window.location.assign(`/workshop/campaigns?mode=${scene.mode}`);}catch(e){setNotice((e as Error).message);}}
  return <section className="workshop" aria-label="Map workshop">
    {campaignContext&&missionResult&&<div className="campaign-objectives"><div className="campaign-objectives-heading"><div><h2>{campaignContext.mission.title}<strong>{missionResult.status.toUpperCase()}</strong></h2></div><div className="workshop-row"><button onClick={()=>returnToCampaign(false)}>Return to campaign</button><button onClick={()=>returnToCampaign(true)}>Attach map & return</button></div></div><ul>{missionResult.checks.map(check=><li key={check.id} data-pass={check.pass}>{check.pass?"✓ ":"○ "}{check.title}<small>{check.detail}</small></li>)}</ul><p>Measured browser objectives · approximate playtest. Repair is an inspector action; native campaign scripts and economy are outside this prototype.</p></div>}
    <div className="workshop-topbar">
      <div className="workshop-modes" aria-label="Game mode">{(["ra2","ra"] as const).map(mode=><button key={mode} disabled={campaignPreview} aria-pressed={scene.mode===mode} onClick={()=>{if(scene.mode!==mode)generate(mode,true);}}>{mode==="ra2"?modeLabel(mode):`${modeLabel(mode)} add-on`}</button>)}</div>
      <span className="workshop-local">LOCAL WORKSPACE <b>{scene.pieces.length} actors</b></span>
      <div className="workshop-files"><button onClick={()=>download(new Blob([scenarioJson(doc.current)],{type:"application/json"}),"rtsai-scene.json")}><Download size={14}/>Save scene</button><button onClick={()=>input.current?.click()}><Upload size={14}/>Load scene</button><button className="workshop-export" onClick={exportMap}><Download size={14}/>OpenRA map</button><input ref={input} hidden type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];if(file)void importScene(file);e.target.value="";}} /></div>
    </div>
    <div className="workshop-grid">
      <aside className="workshop-palette">
        <details className="workshop-generator"><summary>Terrain generator <span>{size} × {size}</span></summary>
          <label>Map title<input value={title} maxLength={80} onChange={e=>setTitle(e.target.value)}/></label>
          <div className="workshop-row"><label>Seed<input type="number" value={seed} min={0} max={2147483647} onChange={e=>setSeed(Math.max(0,Math.min(2147483647,Math.trunc(Number(e.target.value)))))}/></label><label>Grid<OptionSelect value={size} onValueChange={setSize} options={gridOptions}/></label></div>
          <label>Landscape<OptionSelect value={preset} onValueChange={setPreset} options={landscapeOptions}/></label>
          {preset==="earth"&&<><WorkshopEarth latitude={latitude} longitude={longitude} onPin={(lat,lon)=>{setLatitude(lat);setLongitude(lon);}}/><div className="workshop-row"><label>Latitude<input type="number" step=".0001" value={latitude} onChange={e=>setLatitude(Number(e.target.value))}/></label><label>Longitude<input type="number" step=".0001" value={longitude} onChange={e=>setLongitude(Number(e.target.value))}/></label></div><button className="workshop-primary" disabled={acquiring} onClick={()=>void earth()}>{acquiring?"Importing terrain…":"Import Earth terrain"}</button><p className="workshop-hint">Earth imports use your account. Procedural maps work locally without signing in.</p></>}
          <div className="workshop-row"><button onClick={()=>generate()}>Generate empty</button><button onClick={()=>generate(scene.mode,true)}>Load starter</button></div>
          <p className="workshop-hint">Generating replaces this scene. Undo restores it.</p>
        </details>
        <div className="workshop-panel-title"><h2>Actor palette</h2><span>{palette.length}</span></div>
        <label>Faction<SearchSelect value={country.id} onValueChange={id=>{setFaction(id);setActorKey("");setTool("select");}} options={factionOptions(scene.mode,flags)} placeholder="Search factions…"/></label>
        <div className="workshop-search"><Search size={14}/><input aria-label="Search actors" placeholder="Search units, buildings…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
        <div className="workshop-row"><label>Category<OptionSelect value={category} onValueChange={setCategory} options={categoryOptions}/></label><label>Place for<OptionSelect value={team} onValueChange={setTeam} options={teamOptions}/></label></div>
        <div className="workshop-actor-list">{palette.map(a=>{const Icon=icons[a.category as keyof typeof icons]??Truck;return <button draggable key={a.key} aria-pressed={actorKey===a.key} onDragEnd={()=>{ghost.current=null;hover.current=null;}} onDragStart={e=>{e.dataTransfer.setData("application/x-rtsai-actor",a.key);e.dataTransfer.effectAllowed="copy";setActorKey(a.key);setTool("place");}} onClick={()=>{setActorKey(a.key);setTool("place");setNotice(a.name+" selected. Click a map cell to place it for "+team+".");}}><Icon size={18}/><span><b>{a.name}</b><small>{categoryLabels[a.category]} {a.cost!==null&&<>· {"$"}{a.cost.toLocaleString()}</>}</small></span><span className="workshop-add">+</span></button>;})}{!palette.length&&<p className="workshop-hint">No actors match this search.</p>}</div>
        <details className="workshop-coordinate"><summary>Place by coordinates</summary><div className="workshop-row"><label>Cell X<input type="number" min={1} max={scene.size-2} value={placeX} onChange={e=>setPlaceX(Number(e.target.value))}/></label><label>Cell Y<input type="number" min={1} max={scene.size-2} value={placeY} onChange={e=>setPlaceY(Number(e.target.value))}/></label></div><button disabled={!actorKey} onClick={()=>add({x:placeX,y:placeY})}>Place selected actor</button></details>
        <p className="workshop-hint">Drag onto the map, or choose an actor and click. Buildings use their configured footprint.</p>
      </aside>
      <div className="workshop-stage">
        <div className="workshop-stage-heading"><div><span className="eyebrow">LIVE BATTLEFIELD</span><h2>{scene.title}</h2></div><span className={"workshop-phase "+phase}>{phase==="edit"?"EDITING":phase==="running"?"RUNNING":"PAUSED"} · {clock.toFixed(1)}s</span></div>
        <div className="workshop-tools" aria-label="Map tools">{tools.map(t=><button key={t.id} aria-pressed={tool===t.id} onClick={()=>setTool(t.id)}>{t.id==="select"&&<MousePointer2 size={14}/ >}{t.id==="pan"&&<Hand size={14}/ >}{t.id==="attack"&&<Swords size={14}/ >}{t.label}</button>)}<button aria-label="Undo edit" disabled={!history.undo} onClick={()=>historyMove(true)}><Undo2 size={15}/></button><button aria-label="Redo edit" disabled={!history.redo} onClick={()=>historyMove(false)}><Redo2 size={15}/></button></div>
        <div className={"workshop-map is-"+tool}>
          {/* Canvas implements its own keyboard navigation, selection and orders. */}
          {/* eslint-disable-next-line jsx-a11y/no-interactive-element-to-noninteractive-role */}
          <canvas ref={canvas} tabIndex={0} role="application" aria-label="Interactive battlefield. Drag actors to place or reposition. Shift-drag to pan. Arrow keys choose a cell, Enter applies the selected tool." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={e=>{if(gesture.current?.kind==="paint")pointerUp(e);else {gesture.current=null;ghost.current=null;}}} onPointerLeave={()=>{if(!gesture.current){hover.current=null;invalidate();}}}
            onDragOver={e=>{e.preventDefault();hover.current=at({x:e.clientX,y:e.clientY});if(editable && actorKey)ghost.current=makePiece(doc.current,actorKey,country.id,team,hover.current);invalidate();}} onDragLeave={()=>{ghost.current=null;hover.current=null;invalidate();}} onDrop={e=>{e.preventDefault();ghost.current=null;const key=e.dataTransfer.getData("application/x-rtsai-actor");if(rosters.actors.some(a=>a.key===key))add(at({x:e.clientX,y:e.clientY}),key);}}
            onContextMenu={e=>{e.preventDefault();const point=at({x:e.clientX,y:e.clientY}),hit=pick(point);interact(point,hit&&hit.team!==piece?.team?"attack":"move");}}
            onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();historyMove(!e.shiftKey);}if(e.key==="Delete")remove();if(e.key==="Escape"){setTool("select");setActorKey("");}if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){e.preventDefault();const p={x:Math.max(1,Math.min(scene.size-2,coordinate.x+(e.key==="ArrowRight"?1:e.key==="ArrowLeft"?-1:0))),y:Math.max(1,Math.min(scene.size-2,coordinate.y+(e.key==="ArrowDown"?1:e.key==="ArrowUp"?-1:0)))};setCoordinate(p);hover.current=p;}if(e.key==="Enter"){e.preventDefault();const value=brushes[tool];if(value!==undefined&&editable)replace(paintScene(doc.current,coordinate,value,brush));else interact(coordinate);}}}/>
          <div className="workshop-map-status"><span>{camera.iso?"ISOMETRIC":"TACTICAL"} · {Math.round(camera.zoom*100)}%</span><span>CELL {coordinate.x}, {coordinate.y}</span></div>
          <div className="workshop-camera"><button aria-label="Zoom in" onClick={()=>zoom(1.3)}><ZoomIn size={17}/></button><button aria-label="Zoom out" onClick={()=>zoom(1/1.3)}><ZoomOut size={17}/></button><button aria-label="Fit map" onClick={()=>setCamera({...camera,panX:0,panY:0,zoom:1})}><Maximize2 size={17}/></button><button onClick={()=>setCamera({...camera,panX:0,panY:0,iso:!camera.iso})}>{camera.iso?"Top-down":"Isometric"}</button></div>
          <button className="workshop-minimap" aria-label="Recenter battlefield using the minimap" onClick={e=>{const rect=e.currentTarget.getBoundingClientRect(),map=terrain.current;if(!map)return;const d=dimensionsRef.current,s=fitScale(scene,d.width,d.height,camera.iso)*camera.zoom;setCamera({...camera,panX:(map.width/2-(e.clientX-rect.left)/rect.width*map.width)*s,panY:(map.height/2-(e.clientY-rect.top)/rect.height*map.height)*s});}}><canvas ref={minimap} width={160} height={90}/><span>OVERVIEW</span></button>
        </div>
        <div className="workshop-playback"><button className="workshop-primary" onClick={()=>phase==="running"?changePhase("paused"):run()}>{phase==="running"?<Pause size={15}/>:<Play size={15}/ >}{phase==="running"?"Pause":"Run battle"}</button><button onClick={singleStep} disabled={phase==="running"}>Step</button><button onClick={reset}>Reset battle</button><OptionSelect aria-label="Simulation speed" value={rate} onValueChange={setRate} options={rateOptions}/><label><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)}/>Auto engage</label><label><input type="checkbox" checked={ranges} onChange={e=>setRanges(e.target.checked)}/>Ranges</label></div>
        <p className="workshop-notice" role="status">{notice}</p>
        <div className="workshop-entities" aria-label="Placed actors">{hud.pieces.map(p=><button key={p.id} className={p.health<=0?"destroyed":""} aria-pressed={selected===p.id} onClick={()=>focus(p.id)}><i className={"team-"+p.team}/><span>{actorFor(p.actorKey).name}<small>#{p.id} · {p.health<=0?p.phase:p.order.type}</small></span></button>)}</div>
        <p className="workshop-model-note">Browser prototype · illustrated terrain · {!(scene.mode==="ra2"?camera.iso:!camera.iso)?"tactical symbols in this view":artStatus.local?"unit art as your local game plays it (preview mod, private originals)":scene.mode==="ra2"?"published unit art"+(artStatus.missing?"; original Classic add-on units shown as markers":""):"Classic unit art is local-only; units shown as markers"} · configured unit stats · simplified combat<br/>{scene.source} · rules {scene.ruleCommit.slice(0,8)}</p>
      </div>
      <aside className="workshop-inspector">
        <div className="workshop-panel-title"><h2>Inspect & experiment</h2></div>
        {piece&&actor?<><span className={"workshop-team team-"+piece.team}>{piece.team} · #{piece.id}</span><h3>{actor.name}</h3><p className="workshop-description">{actor.behavior.description}</p>
          <dl className="workshop-stats"><div><dt>Health</dt><dd>{Math.ceil(piece.health).toLocaleString()} / {maxHealth(actor).toLocaleString()}</dd></div><div><dt>Armor</dt><dd>{actor.behavior.armor??"None"}</dd></div><div><dt>Range</dt><dd>{prototypeRange(piece)} cells</dd></div><div><dt>Footprint</dt><dd>{dimensions(actor).join(" × ")}</dd></div><div><dt>State</dt><dd>{piece.health<=0?piece.phase:piece.phase==="ready"?piece.order.type:piece.phase}</dd></div>{piece.ammo!==null&&<div><dt>Ammo</dt><dd>{piece.ammo}</dd></div>}</dl>
          <div className="workshop-row"><button onClick={()=>setTool("move")}><MousePointer2 size={14}/>Move</button><button onClick={()=>setTool("attack")}><Swords size={14}/>Attack</button><button onClick={()=>{issueOrder(world.current,piece.id,{type:"hold"});setClock(world.current.time+.00001);}}>Hold</button></div>
          {canDeploy(actor)&&<button className="workshop-deploy" aria-pressed={piece.deployed} onClick={()=>patchPiece({deployed:!piece.deployed})}>{piece.deployed?"Undeploy":"Deploy infantry"}</button>}
          <div className="workshop-row"><label>Rank<OptionSelect value={piece.rank} onValueChange={rank=>patchPiece({rank})} options={rankOptions}/></label><label>Team<OptionSelect value={piece.team} onValueChange={team=>patchPiece({team})} options={teamOptions}/></label></div>
          <label className="workshop-check"><input type="checkbox" checked={piece.powered} onChange={e=>patchPiece({powered:e.target.checked})}/>Powered / enabled</label>
          <div className="workshop-row"><button disabled={piece.health<=0} onClick={()=>patchPiece({health:maxHealth(actor)})}>Repair</button><button disabled={!editable} onClick={()=>{for(let r=1;r<9;r++){const p=makePiece(doc.current,piece.actorKey,piece.faction,piece.team,{x:piece.x+r,y:piece.y});if(!placementIssue(doc.current,p)){replace({...doc.current,pieces:[...doc.current.pieces,p]});setSelected(p.id);return;}}setNotice("No free space nearby for a duplicate.");}}>Duplicate</button><button disabled={!editable} onClick={remove}>Remove</button></div>
          <details open><summary>Active weapons <span>{weapons.length}</span></summary>{weapons.length?weapons.map((w,i)=><div className="workshop-weapon" key={w.id+i}><b>{w.id}</b><span>{w.range??0} cells · {(w.reload??25)/25}s reload</span><small>{w.damage===null?"Special damage not modeled":String(w.damage)+" damage × "+(w.burst??1)} · {w.targets.join(", ")}</small></div>):<p className="workshop-hint">No active weapon in this state.</p>}</details>
          {conditionNames(actor).length>0&&<details><summary>Weapon conditions</summary>{conditionNames(actor).map(flag=><label key={flag} className="workshop-check"><input type="checkbox" checked={piece.flags.includes(flag)} onChange={e=>patchPiece({flags:e.target.checked?[...piece.flags,flag]:piece.flags.filter(f=>f!==flag)})}/>{flag}</label>)}</details>}
          {piece.ammo!==null&&<p className="workshop-hint">Aircraft return to their placement cell to rearm. Destroyed aircraft fall before becoming wrecks.</p>}
          <details><summary>Native actions & limits</summary><p className="workshop-hint">Movement, direct damage, armor, weapon conditions and deployment are approximated here. Auras, passengers, transformations, production, economy and full projectile physics require native engine testing.</p>{actor.behavior.actions.filter(a=>!a.id.includes("Multiplier")).map((a,i)=><div className="workshop-native-action" key={a.id+i}><b>{a.label}</b><small>{a.detail}</small></div>)}</details>
        </>:<div className="workshop-empty-inspector"><MousePointer2 size={25}/><h3>Every piece has a role.</h3><p>Select a unit or building to inspect its health, weapons and conditions.</p><p>Right-click to give orders.<br/>Shift-drag to pan the map.</p></div>}
        <div className="workshop-battle-readout"><h3>Battle readout</h3><dl className="workshop-stats"><div><dt>Alive</dt><dd>{hud.pieces.filter(p=>p.health>0).length}</dd></div><div><dt>Shots</dt><dd>{hud.shots}</dd></div><div><dt>Damage</dt><dd>{Math.round(hud.damage).toLocaleString()}</dd></div><div><dt>Destroyed</dt><dd>{hud.destroyed}</dd></div></dl><ol>{hud.log.slice(0,6).map((message,i)=><li key={i+message}>{message}</li>)}</ol></div>
        <label>Terrain brush<OptionSelect value={brush} onValueChange={setBrush} options={brushOptions}/></label>
      </aside>
    </div>
  </section>;
}
