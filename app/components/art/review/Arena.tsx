"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Swords, Plus, Trash2, Pencil } from "lucide-react";
import type { DuelPlacement, DuelRequest, DuelResult, DuelSample } from "../../../../lib/art-lab/duel-server";
import type { RosterPayload } from "../../../../lib/art-lab/originals";
import type { FrameStore } from "./frames";
import { stageItem, type ReviewUnit } from "./versions";
import { useLab } from "./lab-store";
import { angleDelta, eventActor, facingToward, replayBounds, replaySample, sampleIndex } from "../../../../lib/art-lab/replay";
import type { Frame } from "./frames";
import { EncounterFaction, EncounterPalette } from "./EncounterPalette";
import { NativeVisuals } from "./NativeVisuals";
import { OptionSelect } from "../../ui/fields";

import { ENCOUNTER_DRAG, placementActor, projectEncounter as projectWorld, screenCell, setupSample, visualAt } from "../../../../lib/art-lab/encounter";
export function Arena({ mode, units, selected, roster, frames, onSelect }: { mode: "ra2" | "classic"; units: ReviewUnit[]; selected: ReviewUnit; roster: RosterPayload | null; frames: FrameStore; onSelect: (id: string) => void }) {
  const eligible = useMemo(() => units.filter(u => roster?.stock[u.id]?.behavior.health).sort((a, b) => a.name.localeCompare(b.name)), [units, roster]);
  const owner = (id: string, requested?: string) => roster?.factions.find(f => f.id===requested && f.units.some(u=>u.id===id))?.id ?? roster?.factions.find(f=>f.units.some(u=>u.id===id))?.id ?? "";
  const first=eligible.find(u=>u.id===selected.id) ?? eligible[0];
  const opponent=eligible.find(u=>u.id===(mode==="ra2"?"htnk":"3tnk")) ?? eligible.at(-1);
  const [placements,setPlacements]=useState<DuelPlacement[]>(()=>[first,opponent].flatMap((u,side)=>u?[{key:`actor-${side}`,id:u.id,side:side as 0|1,u:side===0?58:70,v:64,deploy:false,faction:owner(u.id,side===1?"russia":u.factionId),order:"engage"}]:[]));
  const [activeTeam,setActiveTeam]=useState<0|1>(0),[focus,setFocus]=useState("actor-0"),[targeting,setTargeting]=useState(false);
  const [factions,setFactions]=useState([owner(first?.id??selected.id,selected.factionId),owner(opponent?.id??"","russia")]);
  const [level,setLevel]=useState(0);
  const focused=placements.find(p=>p.key===focus);
  const a=placements.find(p=>p.side===0)?.id??"", b=placements.find(p=>p.side===1)?.id??"";
  const [result, setResult] = useState<DuelResult | null>(null), [history, setHistory] = useState<DuelResult[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [playing, setPlaying] = useState(false), [index, setIndex] = useState(0), [speed, setSpeed] = useState(1), [ranges, setRanges] = useState(true);
  const [camera, setCamera] = useState("follow");
  const canvas = useRef<HTMLCanvasElement>(null), aborted = useRef(false), drawState = useRef({ result, index, a, b, ranges, camera, placements, focus });
  const redraw=useRef(()=>{}), transform=useRef({scale:1,center:[0,0],width:1,height:1}), hits=useRef<{key:string;x:number;y:number}[]>([]), drag=useRef<string|null>(null);
  // The callback is invoked after asynchronous asset loading, never during render.
  // eslint-disable-next-line react-hooks/refs
  const nativeVisuals=useMemo(()=>new NativeVisuals(mode,()=>redraw.current()),[mode]);
  useEffect(()=>()=>nativeVisuals.dispose(),[nativeVisuals]);
  const playhead = useRef(0), lastFrames = useRef(new Map<string, Frame>());
  useEffect(() => { drawState.current = { result, index, a, b, ranges, camera, placements, focus }; });
  useEffect(() => { aborted.current = false; return () => { aborted.current = true; }; }, []);
  const restore = useCallback((r: DuelResult) => {
    const restored=r.request.placements ?? ([0,1] as const).flatMap(side=>Array.from({length:r.request[side===0?"a":"b"].count},(_,i)=>({key:`actor-${side}-${i}`,id:r.request[side===0?"a":"b"].id,side,u:64+(side===0?-Math.floor(r.request.gap/2):Math.ceil(r.request.gap/2)),v:64+i*4,deploy:r.request[side===0?"a":"b"].deploy,faction:r.request[side===0?"a":"b"].faction,order:"engage" as const})));
    setPlacements(restored);setFocus(restored[0]?.key??"");setFactions([r.request.a.faction??"",r.request.b.faction??""]);setLevel(r.request.level);onSelect(r.request.a.id);
    playhead.current = 0; lastFrames.current.clear(); setResult(r); setIndex(0); setPlaying(false);
  }, [onSelect]);
  useEffect(() => {
    let stored: string[] = [];
    try { const value = JSON.parse(localStorage.getItem(`rtsai-studio-notebook:${mode}`) ?? "[]"); if (Array.isArray(value)) stored = value.filter(id => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)); } catch { /* Browser storage is optional. */ }
    void Promise.all(stored.slice(0, 6).map(id => fetch(`/api/art-review/duel/${id}`).then(r => r.ok ? r.json() : null).catch(() => null))).then(jobs => {
      if (aborted.current) return;
      const results = jobs.filter(j => j?.status === "complete" && j.result?.request.mode === mode).map(j => j.result as DuelResult);
      setHistory(results);
    });
  }, [mode]);
  const actorMap = useMemo(() => new Map(units.map(u => [u.id, u])), [units]);
  const bounds = useMemo(() => result ? replayBounds(result.samples, (x,y,z) => projectWorld(mode,x,y,z)) : null, [result, mode]);
  const observedEvents = useMemo(() => [...(result?.events ?? []).map(e => ({ ...e, target: eventActor(result!.samples,e.tick,e.side,e.index), source: eventActor(result!.samples,e.tick,e.attackerSide,e.attackerIndex) })), ...(result?.effects ?? []).map(e=>({...e,index:0,attackerSide:-1,attackerIndex:-1,damage:0,source:null,target:{...e,index:0,facing:0,health:0,maxHealth:1}}))].sort((a,b)=>a.tick-b.tick), [result]);
  const nativeAt=useMemo(()=>visualAt(result?.visuals??[],0),[result]);
  const draw = useCallback(() => {
    const el = canvas.current, ctx = el?.getContext("2d"); if (!el || !ctx) return;
    const width = el.clientWidth, height = el.clientHeight, dpr = Math.min(window.devicePixelRatio, 2);
    if (width < 1 || height < 1) return;
    if (el.width !== width * dpr || el.height !== height * dpr) { el.width = width * dpr; el.height = height * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const state = drawState.current, r = state.result;
    const naval=([0,1] as const).map(side=>roster?.stock[state.placements.find(p=>p.side===side)?.id??""]?.info?.domain==="naval");
    const water = r?.request.waterSide ?? (naval[0]&&naval[1]?"both":naval[0]?"a":naval[1]?"b":"none");
    if (water && water !== "none") { ctx.fillStyle = "#142834"; ctx.fillRect(water === "b" ? width / 2 : 0, 0, water === "both" ? width : width / 2, height); }
    const project = (x: number, y: number, z = 0) => projectWorld(mode,x,y,z);
    const sample: DuelSample = (r && replaySample(r.samples,playhead.current)) || setupSample(mode,state.placements);
    const follow = !!r && state.camera === "follow";
    const deaths = observedEvents.filter(e=>e.kind==="destroyed" && e.tick<=sample.tick && e.target).map(e=>e.target!);
    let { minX, maxX, minY, maxY } = !r ? replayBounds([setupSample(mode,[{key:"min",id:"",side:0,u:54,v:54,deploy:false},{key:"max",id:"",side:1,u:74,v:74,deploy:false}])],project) : follow ? replayBounds([{...sample,actors:[...sample.actors,...deaths]}],project) : bounds ?? replayBounds([sample],project);
    if(r&&follow)for(const p of sample.actors){const id=placementActor(r.request.placements,p.side,p.index,[r.request.a.id,r.request.b.id]),f=lastFrames.current.get(`${id}:${p.side}:${p.index}`);if(f){const [x,y]=project(p.x,p.y,p.z);minX=Math.min(minX,x+f.left);maxX=Math.max(maxX,x+f.right);minY=Math.min(minY,y+f.top-10);maxY=Math.max(maxY,y+f.bottom+16);}}
    const scale = Math.max(.1, Math.min(2.5, (width - 150) / Math.max(follow ? 140 : 220, maxX - minX), (height - 100) / Math.max(follow ? 80 : 160, maxY - minY)));
    const center = [(minX + maxX) / 2, (minY + maxY) / 2];
    transform.current={scale,center,width,height};hits.current=[];
    const screen = (p: number[]) => [width / 2 + (p[0] - center[0]) * scale, height / 2 + (p[1] - center[1]) * scale];
    ctx.strokeStyle = "rgba(170,200,150,.06)"; ctx.lineWidth = 1;
    for (let x = -height; x < width + height; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + height, height); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - height, height); ctx.stroke(); }
    const ids = r ? [r.request.a.id, r.request.b.id] : [state.a, state.b];
    const placed=r?.request.placements??state.placements;
    for(const plan of !r?placed:[]){if(plan.destination){const from=setupSample(mode,[plan]).actors[0],to=setupSample(mode,[{...plan,...plan.destination}]).actors[0];const [x,y]=screen(project(from.x,from.y)),[tx,ty]=screen(project(to.x,to.y));ctx.strokeStyle=plan.side===0?"#e04444":"#4477ee";ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(tx,ty);ctx.stroke();ctx.setLineDash([]);ctx.strokeRect(tx-5,ty-5,10,10);}}

    for (const p of [...sample.actors].sort((a, b) => a.x + a.y - b.x - b.y)) {
      const plan=placed.filter(q=>q.side===p.side)[p.index-1];
      const unit = actorMap.get(placementActor(placed,p.side,p.index,ids)), item = unit && stageItem(unit, null); if (!unit || !item) continue;
      const [x, y] = screen(project(p.x, p.y, p.z)), ground = screen(project(p.x, p.y));
      if(!r&&plan){hits.current.push({key:plan.key,x,y});if(plan.key===state.focus){ctx.strokeStyle="#f1d58b";ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(ground[0],ground[1]+3,25*scale,12*scale,0,0,Math.PI*2);ctx.stroke();ctx.lineWidth=1;}}
      const color = p.side === 0 ? "E04444" : "4477EE";
      if (state.ranges) {
        const range = roster?.stock[unit.id]?.behavior.weapons[0]?.range ?? 0;
        ctx.strokeStyle = `${p.side === 0 ? "#E04444" : "#4477EE"}40`; ctx.fillStyle = `${p.side === 0 ? "#E04444" : "#4477EE"}07`;
        ctx.beginPath(); ctx.ellipse(ground[0], ground[1], range * (mode === "ra2" ? 42.43 : 24) * scale, range * (mode === "ra2" ? 21.21 : 24) * scale, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      const previous = r?.samples[Math.max(0, state.index - 1)]?.actors.find(q => q.side === p.side && q.index === p.index);
      const damaged = previous && p.health < previous.health;
      const firing = r?.shots ? r.shots.some(s=>s.actor===p.actor&&s.tick<=sample.tick&&s.tick>sample.tick-5) : r?.events?.some(e => e.kind === "damage" && e.tick <= sample.tick && e.tick > sample.tick - 5 && e.attackerSide === p.side && e.attackerIndex === p.index);
      const moving = previous && (previous.x !== p.x || previous.y !== p.y);
      // Recorded turret yaw takes precedence; old notebook entries retain an inferred fallback.
      let lastHit: (typeof observedEvents)[number] | undefined;
      for (let i=observedEvents.length-1;i>=0;i--) { const e=observedEvents[i]; if(e.kind === "damage" && e.tick <= sample.tick && e.attackerSide === p.side && e.attackerIndex === p.index){lastHit=e;break;} }
      const enemies = sample.actors.filter(q => q.side !== p.side);
      const target = enemies.find(q => q.side === lastHit?.side && q.index === lastHit?.index) ?? enemies.sort((a,b) => Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
      const aim = p.turretFacing !== undefined && p.turretFacing>=0 ? p.turretFacing : target ? facingToward(target.x-p.x,target.y-p.y) : p.facing;
      const turretBase = item.spec.voxel || Math.abs(item.sprite?.sequences.find(s => s.name === "idle")?.facings ?? 1) > 1 ? p.facing : item.sprite?.turret?.initialFacing ?? 0;
      const animation = plan?.deploy && item.sprite?.sequences.some(s => s.name === "deployed") ? firing ? "shoot-deployed" : "deployed" : firing ? "attack" : moving ? "move" : p.health / p.maxHealth < .5 && item.sprite?.sequences.some(s => s.name === "damaged-idle") ? "damaged-idle" : "stand";
      const info = frames.animationInfo(item,animation);
      const key = `${unit.id}:${p.side}:${p.index}`;
      const next = frames.get(item, { facing: Math.round(p.facing / 32) * 32 % 1024, turret: Math.round(angleDelta(turretBase,aim) / 32) * 32, tick: Math.floor(sample.tick * 40 / (info?.tickMs ?? 120)), timeMs:sample.tick*40, animation, color, shadow: p.z === 0, tint: [1, 1, 1] });
      if (next) lastFrames.current.set(key,next);
      const frame = next ?? lastFrames.current.get(key);
      if (p.z > 0) { ctx.fillStyle = "#0005"; ctx.beginPath(); ctx.ellipse(ground[0],ground[1],16*scale,7*scale,0,0,Math.PI*2); ctx.fill(); }
      if (frame) { ctx.imageSmoothingEnabled = false; ctx.drawImage(frame.canvas, x - frame.anchorX * scale, y - frame.anchorY * scale, frame.width * scale, frame.height * scale); }
      else { ctx.fillStyle = "#e8b08c"; ctx.font = "10px Arial"; ctx.fillText(frames.failed(item) ?? "Loading art…", x, y - 20); ctx.fillStyle = `#${color}`; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); }
      const barY=y+(frame?.top??-30)*scale-9, labelY=y+(frame?.bottom??20)*scale+14;
      const bar = Math.max(32, 40 * scale); ctx.fillStyle = "#141814"; ctx.fillRect(x - bar / 2, barY, bar, 4); ctx.fillStyle = `#${color}`; ctx.fillRect(x - bar / 2, barY, bar * p.health / p.maxHealth, 4);
      ctx.fillStyle = "#f0eee6"; ctx.font = "11px Arial"; ctx.textAlign = "center"; ctx.fillText(`${unit.name}${p.index > 1 ? ` ${p.index}` : ""}`, x, labelY);
      if (damaged) { ctx.strokeStyle = "#f7d899"; ctx.beginPath(); ctx.arc(x, y - 10, 15, 0, Math.PI * 2); ctx.stroke(); }
    }
    for (const wreck of sample.wrecks ?? []) {
      const unit = actorMap.get(ids[wreck.side]), item = unit && stageItem(unit, null); if (!item) continue;
      const [x, y] = screen(project(wreck.x, wreck.y, wreck.z));
      const key = `wreck:${unit!.id}:${wreck.side}`;
      const next = frames.get(item, { facing: Math.round(wreck.facing / 32) * 32 % 1024, turret: 0, tick: 0, animation: "stand", color: wreck.side === 0 ? "E04444" : "4477EE", shadow: wreck.z === 0, tint: [.45, .45, .45] });
      if (next) lastFrames.current.set(key,next);
      const frame = next ?? lastFrames.current.get(key);
      if (frame) { ctx.imageSmoothingEnabled = false; ctx.drawImage(frame.canvas, x - frame.anchorX * scale, y - frame.anchorY * scale, frame.width * scale, frame.height * scale); }
      ctx.fillStyle = "#f7d899"; ctx.font = "12px Arial"; ctx.textAlign = "center"; ctx.fillText(wreck.z > 0 ? `Falling wreck · ${(wreck.z / 1024).toFixed(2)}c` : "Wreck", x, y + 30 * scale);
      if (wreck.z > 0) { ctx.fillStyle = "#5558"; for (let i=0;i<4;i++) { ctx.beginPath(); ctx.arc(x-9*i*scale,y-10*i*scale, (5+i*2)*scale,0,Math.PI*2); ctx.fill(); } }
    }
    // Sprite frames and trajectories are recorded by the engine. A plain point indicates missing projectile artwork.
    for(const visual of r?nativeAt(sample.tick):[]){const [x,y]=screen(project(visual.x,visual.y,visual.z)),frame=nativeVisuals.get(visual);if(frame){ctx.imageSmoothingEnabled=false;ctx.drawImage(frame.canvas,x-frame.anchorX*scale,y-frame.anchorY*scale,frame.width*scale,frame.height*scale);}else if(visual.kind==="projectile"&&visual.tx!=null&&visual.ty!=null){const [tx,ty]=screen(project(visual.tx,visual.ty,visual.tz??0));ctx.strokeStyle="#b5e4ff";ctx.lineWidth=2*scale;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(tx,ty);ctx.stroke();ctx.lineWidth=1;}else if(visual.kind==="projectile"){ctx.fillStyle="#ffe6a6";ctx.beginPath();ctx.arc(x,y,2.5*scale,0,Math.PI*2);ctx.fill();}}
    for(const shot of r?.shots??[]){const age=sample.tick-shot.tick;if(age<0||age>3)continue;const [x,y]=screen(project(shot.x,shot.y,shot.z));ctx.fillStyle=`rgba(255,239,181,${1-age/3})`;ctx.beginPath();ctx.arc(x,y,4*scale,0,Math.PI*2);ctx.fill();}
    // Legacy entries have damage-timed illustrative effects. Native recordings never use this fallback.

    for (const e of observedEvents) {
      const age = sample.tick-e.tick; if (age < 0 || age > (e.kind === "destroyed" || e.kind === "crash" ? 65 : 8) || !e.target) continue;
      const [x,y] = screen(project(e.target.x,e.target.y,e.target.z));
      if (e.kind === "damage") {
        if(r?.visuals)continue;
        if (e.source && age < 4) { const [sx,sy] = screen(project(e.source.x,e.source.y,e.source.z)); ctx.strokeStyle = `rgba(255,219,139,${1-age/4})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx,sy-9*scale); ctx.lineTo(x,y-9*scale); ctx.stroke(); ctx.fillStyle="#fff3be"; ctx.beginPath(); ctx.arc(sx,sy-9*scale,5*scale,0,Math.PI*2); ctx.fill(); }
        ctx.fillStyle=`rgba(255,165,62,${1-age/8})`; ctx.beginPath(); ctx.arc(x,y-9*scale,(5+age*2)*scale,0,Math.PI*2); ctx.fill();
      } else if (e.kind === "destroyed" || e.kind === "crash") {
        const unit = actorMap.get(placementActor(placed,e.side,e.index,ids)), item = unit && stageItem(unit,null);
        if (unit?.category === "infantry" && item && age < 30) {
          const info=frames.animationInfo(item,"die"), sequence=item.sprite?.sequences.find(s=>s.usedBy.some(t=>t.startsWith("WithDeathAnimation")));
          if(sequence){const f=frames.get(item,{facing:e.target.facing,turret:0,tick:Math.min((info?.length??1)-1,Math.floor(age*40/(info?.tickMs??120))),animation:"die",color:e.side===0?"E04444":"4477EE",shadow:true,tint:[1,1,1]}); if(f)ctx.drawImage(f.canvas,x-f.anchorX*scale,y-f.anchorY*scale,f.width*scale,f.height*scale);}
          continue;
        }
        if(r?.visuals)continue;
        if (age < 18) { const radius=(8+age*2)*scale, g=ctx.createRadialGradient(x,y-10*scale,0,x,y-10*scale,radius); g.addColorStop(0,"#fff7ce"); g.addColorStop(.3,"#ffc75b"); g.addColorStop(.65,"#ec552bbb"); g.addColorStop(1,"#ed522000"); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y-10*scale,radius,0,Math.PI*2); ctx.fill(); }
        for (let i=0;i<8;i++) { const phase=i*2.399, drift=age*(.2+i*.03); ctx.fillStyle=`rgba(74,70,60,${Math.max(0,.65-age/95)})`; ctx.beginPath(); ctx.arc(x+Math.sin(phase)*drift*scale,y-(10+age*.5+Math.cos(phase)*drift)*scale,(5+age*.22)*scale,0,Math.PI*2); ctx.fill(); if(age<22){ ctx.fillStyle="#efae58"; ctx.fillRect(x+Math.cos(phase)*age*2*scale,y-10*scale+Math.sin(phase)*age*scale,3*scale,2*scale); } }
      }
    }
  }, [mode, actorMap, frames, roster, bounds, observedEvents, nativeAt, nativeVisuals]);
  useEffect(()=>{redraw.current=draw;},[draw]);
  useEffect(() => { draw(); const off = frames.subscribe(draw), offLab = useLab.subscribe(draw); const observer = new ResizeObserver(draw); if (canvas.current) observer.observe(canvas.current); return () => { off(); offLab(); observer.disconnect(); }; }, [draw, frames]);
  useEffect(() => { if (!playing) playhead.current = result?.samples[index]?.tick ?? 0; draw(); }, [result, index, a, b, ranges, camera, placements, focus, draw, playing]);
  useEffect(() => {
    if (!playing || !result) return;
    let handle = 0, previous = performance.now();
    const step = (now: number) => { const elapsed = Math.min(100,now-previous); previous=now;
      if (!document.hidden) { playhead.current=Math.min(result.samples.at(-1)!.tick,playhead.current+elapsed/1000*result.ticksPerSecond*speed); draw(); const i=sampleIndex(result.samples,playhead.current); if(i!==drawState.current.index) setIndex(i); if(playhead.current>=result.samples.at(-1)!.tick){setPlaying(false);return;} }
      handle=requestAnimationFrame(step);
    };
    handle=requestAnimationFrame(step); return () => cancelAnimationFrame(handle);
  }, [playing, result, speed, draw]);
  const run = async () => {
    setBusy(true); setError(""); setPlaying(false);
    try {
      const request: DuelRequest = { mode, a:{id:a,count:placements.filter(p=>p.side===0).length,deploy:false},b:{id:b,count:placements.filter(p=>p.side===1).length,deploy:false},gap:12,level,placements };
      const response = await fetch("/api/art-review/duel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const first = await response.json(); if (!response.ok) throw new Error(first.error);
      while (!aborted.current) {
        await new Promise(r => setTimeout(r, 1000));
        const poll = await fetch(`/api/art-review/duel/${first.id}`); const job = await poll.json();
        if (!poll.ok || job.status === "failed") throw new Error(job.error);
        if (job.status === "complete") { try { const key = `rtsai-studio-notebook:${mode}`; const ids = JSON.parse(localStorage.getItem(key) ?? "[]"); localStorage.setItem(key, JSON.stringify([first.id, ...ids].slice(0, 6))); } catch { /* Storage unavailable: current match still works. */ }
          playhead.current=0; lastFrames.current.clear(); setResult(job.result); setHistory(h => [job.result, ...h].slice(0, 6)); setIndex(0); setPlaying(true); break; }
      }
    } catch (e) { if (!aborted.current) setError(e instanceof Error ? e.message : "Match failed"); }
    finally { if (!aborted.current) setBusy(false); }
  };
  const edit=()=>{setResult(null);setPlaying(false);playhead.current=0;setIndex(0);setTargeting(false);};
  const update=(key:string,patch:Partial<DuelPlacement>)=>{edit();setPlacements(ps=>ps.map(p=>p.key===key?{...p,...patch}:p));};
  const add=(id:string,cell?:{u:number;v:number},side:0|1=activeTeam,faction=factions[side])=>{
    if(busy)return;
    if(!roster?.factions.find(f=>f.id===faction)?.units.some(u=>u.id===id)){setError("Choose a unit from this team's faction.");return;}
    const n=placements.filter(p=>p.side===side).length;if(n>=6){setError("Each team supports up to six actors.");return;}
    const key=`p-${crypto.randomUUID()}`;edit();setError("");setPlacements(ps=>[...ps,{key,id,side,u:cell?.u??(side===0?58:70),v:cell?.v??(60+n*3),deploy:false,faction,order:"engage"}]);setFocus(key);setActiveTeam(side);
  };
  const cellAt=(clientX:number,clientY:number)=>{const rect=canvas.current!.getBoundingClientRect(),t=transform.current;return screenCell(mode,(clientX-rect.left-t.width/2)/t.scale+t.center[0],(clientY-rect.top-t.height/2)/t.scale+t.center[1]);};
  const changeFaction=(side:0|1,id:string)=>{edit();setFactions(fs=>fs.map((f,i)=>i===side?id:f));setPlacements(ps=>ps.filter(p=>p.side!==side||roster?.factions.find(f=>f.id===id)?.units.some(u=>u.id===p.id)).map(p=>p.side===side?{...p,faction:id}:p));};
  const focusUnit=focused&&actorMap.get(focused.id),behavior=focused&&roster?.stock[focused.id]?.behavior;
  const teamCount=(side:number)=>placements.filter(p=>p.side===side).length;
  const jump=(tick:number)=>{if(!result)return;setPlaying(false);setIndex(sampleIndex(result.samples,tick));};
  return <div className="arena enc-layout">
    <div className="enc-library"><div className="enc-team-switch">{([0,1] as const).map(side=><button type="button" key={side} className={`enc-team-${side}`} aria-pressed={activeTeam===side} onClick={()=>setActiveTeam(side)}>{side===0?"Red":"Blue"} team <b>{teamCount(side)}/6</b></button>)}</div><EncounterFaction roster={roster} value={factions[activeTeam]} label="Palette faction" disabled={busy} onChange={id=>changeFaction(activeTeam,id)}/><EncounterPalette units={eligible} roster={roster} faction={factions[activeTeam]} side={activeTeam} disabled={busy} onAdd={id=>add(id)}/></div>
    <div className="enc-workspace"><header className="enc-toolbar"><div><h2>Encounter</h2><p>{result?"Recorded by OpenRA · replay the fight":"Place actors. Choose orders. Run the engine."}</p></div><div className="enc-toolbar-actions">{result&&<button className="lab-ghost" onClick={edit} disabled={busy}><Pencil size={15}/> Edit setup</button>}<label>Rank<OptionSelect<number> aria-label="Veterancy" size="sm" value={level} disabled={busy||!!result} onValueChange={setLevel} options={[{value:0,label:"Rookie"},{value:1,label:"Veteran"},{value:2,label:"Elite"}]}/></label><button className="lab-primary" disabled={busy||!teamCount(0)||!teamCount(1)} onClick={()=>void run()}><Swords size={17}/>{busy?"Running engine…":"Run encounter"}</button></div></header>
    <div className="enc-teams">{([0,1] as const).map(side=><div key={side} className={`enc-team-summary enc-team-${side}`}><button type="button" aria-pressed={activeTeam===side} onClick={()=>setActiveTeam(side)}>{side===0?"Red":"Blue"} · {teamCount(side)} actors</button><EncounterFaction roster={roster} value={factions[side]} label={`${side===0?"Red":"Blue"} faction`} disabled={busy} onChange={id=>changeFaction(side,id)}/></div>)}</div>
    {error&&<p className="arena-error" role="alert">{error}</p>}
    <div className={`arena-field enc-field ${targeting?"is-targeting":""}`} onDragOver={e=>{if(!busy){e.preventDefault();e.dataTransfer.dropEffect="copy";}}} onDrop={e=>{e.preventDefault();try{const p=JSON.parse(e.dataTransfer.getData(ENCOUNTER_DRAG));if([0,1].includes(p.side)&&typeof p.id==="string")add(p.id,cellAt(e.clientX,e.clientY),p.side,p.faction);}catch{setError("Drag a unit card onto the field.");}}}>
      <canvas ref={canvas} aria-label={result?"Combat replay":"Encounter placement field"} tabIndex={0} onPointerDown={e=>{if(busy||result)return;const rect=e.currentTarget.getBoundingClientRect();if(targeting&&focused){update(focused.key,{order:"move",destination:cellAt(e.clientX,e.clientY)});return;}const hit=hits.current.find(p=>Math.hypot(p.x-(e.clientX-rect.left),p.y-(e.clientY-rect.top))<36);if(hit){setFocus(hit.key);drag.current=hit.key;e.currentTarget.setPointerCapture(e.pointerId);}}} onPointerMove={e=>{if(drag.current&&!busy&&!result)update(drag.current,cellAt(e.clientX,e.clientY));}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onKeyDown={e=>{if(busy||result||!focused)return;if(e.key==="Delete"||e.key==="Backspace"){e.preventDefault();setPlacements(ps=>ps.filter(p=>p.key!==focused.key));}const delta:Record<string,number[]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(delta[e.key]){e.preventDefault();update(focused.key,{u:Math.max(36,Math.min(92,focused.u+delta[e.key][0])),v:Math.max(40,Math.min(92,focused.v+delta[e.key][1]))});}}}/>
      <span className="enc-field-status">{result?"Measured · OpenRA":"Setup · not simulated"}</span><span className="arena-caption">{result?(result.shots?"Measured: shots, paths & turret yaw · Interpolated motion · Flash / missing art illustrative":"Measured combat · Legacy firing effects inferred"):targeting?"Click the field to set a move destination":"Drag cards here · drag actors to move · arrow keys to nudge"}</span>
    </div>
    <div className="enc-selection" aria-label="Placed actors">{placements.map(p=><button key={p.key} className={`enc-placed enc-team-${p.side}`} aria-pressed={focus===p.key} onClick={()=>{setFocus(p.key);setActiveTeam(p.side);}}>{actorMap.get(p.id)?.name??p.id}<small>{p.u}, {p.v} · {p.order??"engage"}</small></button>)}</div>
    {focused&&<div className="enc-orders"><div><b>{focusUnit?.name??focused.id}</b><small>{behavior?.health??"—"} health · {behavior?.weapons[0]?.range??0} cell range</small></div><div className="enc-order-buttons"><button aria-pressed={focused.order==="engage"} disabled={busy||!!result} onClick={()=>update(focused.key,{order:"engage",destination:undefined})}>Engage</button><button aria-pressed={focused.order==="hold"} disabled={busy||!!result} onClick={()=>update(focused.key,{order:"hold",destination:undefined})}>Hold / defend</button>{!!behavior?.speed&&<button aria-pressed={targeting||focused.order==="move"} disabled={busy||!!result} onClick={()=>setTargeting(t=>!t)}>Move to…</button>}{behavior?.actions.some(a=>a.id==="GrantConditionOnDeploy")&&<label><input type="checkbox" checked={focused.deploy} disabled={busy||!!result} onChange={e=>update(focused.key,{deploy:e.target.checked})}/> Deployed</label>}<button aria-label="Duplicate selected actor" disabled={busy||!!result} onClick={()=>add(focused.id,{u:focused.u,v:Math.min(92,focused.v+3)},focused.side,focused.faction)}><Plus size={16}/></button><button aria-label="Remove selected actor" disabled={busy||!!result} onClick={()=>{setPlacements(ps=>ps.filter(p=>p.key!==focus));setFocus(placements.find(p=>p.key!==focus)?.key??"");}}><Trash2 size={16}/></button></div></div>}
    {result&&<><div className="arena-timeline"><button className="lab-icon-btn" aria-label="Restart replay" onClick={()=>{playhead.current=0;setIndex(0);setPlaying(true);}}><RotateCcw size={16}/></button><button className="lab-icon-btn" aria-label={playing?"Pause replay":"Play replay"} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={17}/>:<Play size={17}/>}</button><input aria-label="Replay position" type="range" min={0} max={Math.max(1,result.samples.length-1)} value={index} onChange={e=>{setPlaying(false);setIndex(Number(e.target.value));}}/><b>{((result.samples[index]?.tick??0)/result.ticksPerSecond).toFixed(1)}s</b><OptionSelect<number> aria-label="Replay speed" size="sm" value={speed} onValueChange={setSpeed} options={[.5,1,2,4].map(n=>({value:n,label:`${n}×`}))}/><label><input type="checkbox" checked={ranges} onChange={e=>setRanges(e.target.checked)}/> Range</label><OptionSelect aria-label="Replay camera" size="sm" value={camera} onValueChange={setCamera} options={[{value:"follow",label:"Follow fight"},{value:"overview",label:"Overview"}]}/></div><section className="arena-events"><h3>Recorded combat <small>{result.shots?.length??"—"} shots · {result.events?.filter(e=>e.kind==="damage").length??0} hits</small></h3><div><button onClick={()=>jump(result.shots?.[0]?.tick??0)}>First shot</button><button onClick={()=>jump(result.events?.find(e=>e.kind==="damage")?.tick??0)}>First impact</button>{result.events?.filter(e=>e.kind==="destroyed").map((e,i)=><button key={i} onClick={()=>jump(e.tick)}>{(e.tick/result.ticksPerSecond).toFixed(1)}s · {e.side===0?"Red":"Blue"} destroyed</button>)}</div><details><summary>Measurement details</summary><p className="lab-hint">{result.limitations} Wreck appearance and muzzle flashes are illustrative. This viewer is a recorded experiment, not a running interactive game.</p></details></section></>}
    {history.length>0&&<details className="enc-notebook"><summary>Encounter notebook · {history.length} runs</summary><div>{history.map((r,i)=><button key={i} className="lab-ghost" onClick={()=>restore(r)}>{actorMap.get(r.request.a.id)?.name} +{r.request.a.count-1} vs {actorMap.get(r.request.b.id)?.name} +{r.request.b.count-1} · {(r.samples.at(-1)!.tick/r.ticksPerSecond).toFixed(1)}s</button>)}</div></details>}
    <p className="arena-note">Local engine experiment · one faction per team · up to six actors per side. Hold permits automatic defense. Naval encounters use a coastline; aircraft have no service base.</p></div>
  </div>;
}
