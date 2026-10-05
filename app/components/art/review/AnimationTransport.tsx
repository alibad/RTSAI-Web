"use client";
import { Pause,Play,RotateCcw } from "lucide-react";
import type { AnimationInfo } from "./frames";
import { setLab,useLab } from "./lab-store";

/** Isolated time subscriber: scrubbing never re-renders the model stage component. */
export function AnimationTransport({info}:{info:AnimationInfo}){
  const time=useLab(s=>s.animationTime),playing=useLab(s=>s.playing),action=useLab(s=>s.animation);
  const oneShot=/(^die|^make$|deploy|takeoff|^land$|^liedown$|^standup$)/.test(action);
  const shown=oneShot?Math.min(time,info.durationMs):time%Math.max(1,info.durationMs);
  return <div className="lab-animation-transport" aria-label="Animation playback">
    <button className="lab-ghost" onClick={()=>setLab({animationTime:0,playing:true})} aria-label="Restart animation"><RotateCcw size={14}/></button>
    <button className="lab-ghost" aria-label={playing?"Pause animation":"Play animation"} onClick={()=>setLab({playing:!playing,...(!playing&&oneShot&&time>=info.durationMs?{animationTime:0}:{})})}>{playing?<Pause size={14}/>:<Play size={14}/>}</button>
    <input type="range" aria-label="Animation time" min={0} max={info.durationMs} step={Math.max(1,info.tickMs)} value={shown} onChange={e=>setLab({animationTime:Number(e.target.value),playing:false})}/>
    <small>{info.length} frames · {(shown/1000).toFixed(2)}s{oneShot?" · plays once":" · loop"}</small>
  </div>;
}
