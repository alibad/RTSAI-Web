"use client";
/* Project-generated thumbnails stay local. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { Box, Search, X, RotateCcw, Download } from "lucide-react";
import type { ModelLibrary } from "../../../../lib/art-lab/models";
import type { FrameStore } from "./frames";
import type { MeshView } from "../mesh-view";
import type { VoxelEngine } from "../voxel-engine";

export function MeshStudio({mode,actor,frames,onClose}:{mode:"ra2"|"classic";actor:string|null;frames:FrameStore;onClose:()=>void}){
  const [library,setLibrary]=useState<ModelLibrary|null>(null),[error,setError]=useState(""),[query,setQuery]=useState("");
  const [selected,setSelected]=useState(actor),[version,setVersion]=useState<string|null>(null),[loadedUrl,setLoadedUrl]=useState<string|null>(null),[wire,setWire]=useState(false),[team,setTeam]=useState("#d54939"),[turret,setTurret]=useState(0);
  const dialog=useRef<HTMLDialogElement>(null),host=useRef<HTMLDivElement>(null),scene=useRef<MeshView|null>(null),engine=useRef<VoxelEngine|null>(null);
  useEffect(()=>{const node=dialog.current,previous=document.activeElement;frames.pauseRendering();node?.showModal();return()=>{node?.close();engine.current?.detach();scene.current?.dispose();frames.resumeRendering();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus();};},[frames]);
  useEffect(()=>{const abort=new AbortController();const refresh=()=>fetch(`/api/art-review/models?mode=${mode}`,{signal:abort.signal,cache:"no-store"}).then(async r=>{const result=await r.json();if(!r.ok)throw Error(result.error??"Models unavailable");setLibrary(result);}).catch(e=>{if(!abort.signal.aborted)setError(String(e));});void refresh();const timer=setInterval(()=>void refresh(),10000);return()=>{abort.abort();clearInterval(timer);};},[mode]);
  const unit=library?.actors.find(a=>a.actor===selected)??library?.actors[0],option=unit?.options.find(o=>o.id===version)??unit?.options[0];
  const url=option?.url;
  const loaded=Boolean(url&&loadedUrl===url);
  useEffect(()=>{
    let alive=true,preparing=false;let view:MeshView|null=null;
    const start=setTimeout(()=>{setLoadedUrl(null);setError("");},0);
    if(url&&host.current)void (async()=>{
      const meshModule=await import("../mesh-view");view=new meshModule.MeshView();await view.load(url);if(!alive){view.dispose();return;}
      const shared=await frames.sharedEngine();if(!alive){view.dispose();return;}
      preparing=true;try{await shared.prepareMesh(view);}finally{preparing=false;}
      if(!alive||!host.current){view.dispose();return;}
      scene.current=view;engine.current=shared;shared.showMesh(view,host.current);setLoadedUrl(url);
    })().catch(e=>{view?.dispose();if(alive)setError(String(e));});
    return()=>{alive=false;clearTimeout(start);engine.current?.detach();if(!preparing)view?.dispose();scene.current=null;};
  },[url,frames]);
  useEffect(()=>{if(!loaded)return;scene.current?.color(team);scene.current?.wireframe(wire);scene.current?.turret(turret);engine.current?.draw();},[team,wire,turret,loaded]);
  useEffect(()=>{const resize=new ResizeObserver(()=>engine.current?.resize());if(host.current)resize.observe(host.current);return()=>resize.disconnect();},[]);
  const shown=library?.actors.filter(a=>`${a.name} ${a.actor} ${a.category} ${a.factions.join(" ")}`.toLowerCase().includes(query.toLowerCase()))??[];
  return <dialog ref={dialog} className="mesh-studio" aria-labelledby="mesh-title" onCancel={onClose}><header><div><span className="lab-label"><Box size={14}/> 3D SOURCE MODELS</span><h2 id="mesh-title">Build once. Explore every angle.</h2></div><div className="mesh-job-summary">{library&&<><b>{library.coverage.withGlb}/{library.coverage.total} actors with GLB</b><span>{library.jobs.drafts}/{library.jobs.total} new drafts · {library.privateJobs.drafts}/{library.privateJobs.total} sprite drafts</span><span>{library.jobs.generating+library.privateJobs.generating} generating · ${library.apiSpendUsd.toFixed(2)} paid API spend</span></>}<button className="lab-ghost" aria-label="Close 3D models" onClick={onClose}><X size={19}/></button></div></header><div className="mesh-studio-body"><aside><label className="enc-search"><Search size={15}/><input type="search" aria-label="Search 3D models" placeholder="Unit, role or faction…" value={query} onChange={e=>setQuery(e.target.value)}/></label><small>{shown.length} actors · {mode==="ra2"?"Red Alert 2":"Classic"}</small><div className="mesh-actor-list">{shown.map(a=><button key={a.key} aria-pressed={a.key===unit?.key} onClick={()=>{setSelected(a.actor);setVersion(null);setTurret(0);}}>{a.thumbnail?<img src={a.thumbnail} width={54} height={44} loading="lazy" alt=""/>:<Box size={23}/>}<span><b>{a.name}</b><small>{a.options.length?`${a.options.length} GLB source${a.options.length>1?"s":""}`:a.status==="generating"?"Generating geometry…":"3D design pending"}</small></span></button>)}</div></aside><main><div className="mesh-actor-head"><div><h2>{unit?.name??"Loading model library…"}</h2><span>{unit?.category} · {unit?.factions.join(" / ")}</span></div>{option&&<a className="lab-ghost" href={option.url} download={`${unit?.actor}.glb`}><Download size={14}/>GLB</a>}</div><div className="mesh-versions">{unit?.options.map(o=><button key={o.id} aria-pressed={o.id===option?.id} onClick={()=>{setVersion(o.id);setTurret(0);}}>{o.label}</button>)}</div><div ref={host} className="mesh-viewport" aria-label="Interactive GLB model">{!option&&<div className="mesh-empty"><Box size={40}/><h3>{unit?.status==="generating"?"The new geometry is building locally.":"This actor still needs a 3D design."}</h3><p>A sprite contains a drawn view. It does not contain a hidden 3D mesh.</p></div>}{option&&!loaded&&!error&&<p className="mesh-loading">Loading GLB…</p>}{error&&<p className="mesh-loading" role="alert">{error}</p>}</div>{option&&<><div className="mesh-controls"><span>Drag to orbit · scroll to zoom</span><button className="lab-ghost" onClick={()=>engine.current?.resetMesh()}><RotateCcw size={14}/>Reset view</button><button className="lab-ghost" aria-pressed={wire} onClick={()=>setWire(w=>!w)}>Wireframe</button>{option.remap&&<label>Player color<input type="color" aria-label="GLB player color" value={team} onChange={e=>setTeam(e.target.value)}/></label>}</div>{option.turret&&<label className="mesh-turret">Turret aim<input type="range" aria-label="GLB turret aim" min={-180} max={180} value={turret} onChange={e=>setTurret(Number(e.target.value))}/></label>}<div className="mesh-evidence"><b>{option.source}</b><span>{(option.bytes/1048576).toFixed(1)} MB{option.triangles!==null?` · ${option.triangles.toLocaleString()} triangles`:""}</span><p>{option.status}. View fits the model; this does not validate battlefield scale or gameplay.</p></div></>}<details className="mesh-work"><summary>What this actor still needs</summary><p>{unit?.requiredWork.join(" · ")}</p></details></main></div></dialog>;
}
