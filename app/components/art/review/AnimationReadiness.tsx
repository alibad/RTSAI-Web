"use client";
import { useEffect,useState } from "react";
type Audit={measuredAt:string|null;current:{actions:{label:string;status:string;missingFrames?:number[]}[];newDesign:{animationClips:number;rig:string}|null}|null;motionStudy:{frames:number;actions:Record<string,unknown>}|null};
/** Resource validity is measured separately from motion quality or gameplay approval. */
export function AnimationReadiness({actor,mode}:{actor:string;mode:"ra2"|"classic"}){
  const [audit,setAudit]=useState<{key:string;data:Audit}|null>(null),key=`${mode}:${actor}`;
  useEffect(()=>{let alive=true;fetch(`/api/art-review/animations?mode=${mode}&actor=${encodeURIComponent(actor)}`).then(r=>r.ok?r.json():null).then(data=>{if(alive&&data)setAudit({key,data});}).catch(()=>undefined);return()=>{alive=false;};},[key,actor,mode]);
  const data=audit?.key===key?audit.data:null;if(!data?.current)return null;
  const repeated=data.current.actions.filter(a=>a.status==="repeated-pose"),invalid=data.current.actions.filter(a=>a.status==="invalid-frame-range"||a.status==="source-unavailable");
  return <details className="studio-animation-readiness"><summary>Animation checks{repeated.length||invalid.length?` · ${repeated.length+invalid.length} resource gaps`:" · resources checked"}</summary>
    <p className="lab-hint">Measured · {data.current.actions.length} current sprite actions checked{data.measuredAt?` on ${new Date(data.measuredAt).toLocaleDateString()}`:""}. Frame diversity does not approve motion quality.</p>
    {repeated.length>0&&<p className="lab-hint">Repeated pose: {repeated.map(a=>a.label).join(", ")}.</p>}
    {invalid.length>0&&<p className="lab-hint">Missing frames or source: {invalid.map(a=>a.label).join(", ")}.</p>}
    {data.motionStudy&&<p className="lab-hint">Unapproved SHP motion study · {Object.keys(data.motionStudy.actions).length} actions · {data.motionStudy.frames} frames. Choose the motion study in the artwork strip to inspect it.</p>}
    {data.current.newDesign&&<p className="lab-hint">New GLB · {data.current.newDesign.animationClips} animation clips · {data.current.newDesign.rig}. Needs animation authoring and native gameplay verification.</p>}
  </details>;
}
