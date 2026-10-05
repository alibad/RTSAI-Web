"use client";
/* Native cameos stay local; preserve their pixels. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, GripVertical } from "lucide-react";
import type { RosterPayload } from "../../../../lib/art-lab/originals";
import { sourceLabel } from "../../../../lib/art-lab/asset-source";
import { ENCOUNTER_DRAG } from "../../../../lib/art-lab/encounter";
import { flagSrc } from "./flags";
import type { ReviewUnit } from "./versions";

export function EncounterFaction({roster,value,onChange,label,disabled}:{roster:RosterPayload|null;value:string;onChange:(id:string)=>void;label:string;disabled:boolean}){
  const [open,setOpen]=useState(false),[query,setQuery]=useState("");
  const search=useRef<HTMLInputElement>(null),root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open)return;search.current?.focus();const close=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==="Escape"){setOpen(false);root.current?.querySelector<HTMLButtonElement>("button")?.focus();}};document.addEventListener("pointerdown",close);document.addEventListener("keydown",escape);return()=>{document.removeEventListener("pointerdown",close);document.removeEventListener("keydown",escape);};},[open]);
  const faction=roster?.factions.find(f=>f.id===value),flag=flagSrc(value);
  return <div ref={root} className="enc-faction"><button type="button" className="enc-faction-trigger" disabled={disabled} aria-label={label} aria-expanded={open} onClick={()=>setOpen(o=>!o)}>{flag&&<img src={flag} alt="" width={26} height={18}/>}<span>{faction?.name??"Choose faction"}</span></button>{open&&<div className="enc-faction-pop" role="dialog" aria-label="Choose faction"><input ref={search} aria-label={`Search ${label}`} placeholder="Find a faction…" value={query} onChange={e=>setQuery(e.target.value)}/><div role="listbox" aria-label={label}>{roster?.factions.filter(f=>f.name.toLowerCase().includes(query.toLowerCase())).map(f=><button type="button" role="option" aria-selected={f.id===value} key={f.id} onClick={()=>{onChange(f.id);setOpen(false);setQuery("");}}>{flagSrc(f.id)&&<img src={flagSrc(f.id)!} width={30} height={20} alt=""/>}{f.name}</button>)}</div></div>}</div>;
}

export function EncounterPalette({units,roster,faction,side,disabled,onAdd}:{units:ReviewUnit[];roster:RosterPayload|null;faction:string;side:0|1;disabled:boolean;onAdd:(id:string)=>void}){
  const [query,setQuery]=useState(""),[category,setCategory]=useState("all");
  const rosterIds=useMemo(()=>new Set(roster?.factions.find(f=>f.id===faction)?.units.map(u=>u.id)??[]),[roster,faction]);
  const available=useMemo(()=>units.filter(u=>rosterIds.has(u.id)&&roster?.stock[u.id]?.behavior.health),[units,roster,rosterIds]);
  const shown=available.filter(u=>(category==="all"||category==="buildings"&&["structure","defense"].includes(u.category)||u.category===category)&&`${u.name} ${u.role} ${u.id}`.toLowerCase().includes(query.toLowerCase()));
  const categories=[["all","All"],["infantry","Soldiers"],["vehicle","Vehicles"],["aircraft","Air"],["ship","Sea"],["buildings","Buildings"]];
  return <aside className="enc-palette" aria-label="Encounter unit palette"><header><span className="lab-label">UNIT PALETTE</span><h2>Build your encounter</h2><p>Drag onto the field, or click to add.</p></header><label className="enc-search"><Search size={16}/><input type="search" aria-label="Search encounter units" placeholder="Search units, roles…" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="enc-filters" aria-label="Unit categories">{categories.map(([id,name])=><button key={id} type="button" aria-pressed={category===id} onClick={()=>setCategory(id)}>{name}</button>)}</div><div className="enc-palette-list">{shown.map(u=><button key={u.id} className="enc-unit-card" type="button" draggable={!disabled} disabled={disabled} aria-label={`Add ${u.name} to ${side===0?"Red":"Blue"}`} onClick={()=>onAdd(u.id)} onDragStart={e=>{e.dataTransfer.setData(ENCOUNTER_DRAG,JSON.stringify({id:u.id,side,faction}));e.dataTransfer.effectAllowed="copy";}}>{u.spec.cameo?<img src={u.spec.cameo} width={60} height={48} alt="" draggable={false}/>:<span className="enc-unit-fallback">{u.category.slice(0,3)}</span>}<span><b>{u.name}</b><small>{u.role||u.category}</small><small className="enc-source-label">{sourceLabel(u)}</small></span><GripVertical size={14} className="enc-grip"/><Plus size={15}/></button>)}{!shown.length&&<p className="lab-hint">No units match. Try another role or category.</p>}</div><footer>{shown.length} actors · adding to <b className={`enc-team-${side}`}>{side===0?"Red":"Blue"}</b></footer></aside>;
}
