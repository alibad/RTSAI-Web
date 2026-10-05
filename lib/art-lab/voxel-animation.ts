import type { RenderSpec } from "./spec";
import { spinKind, spinLabel, type SpinKind } from "./action-labels";
import { partVisibleByDefault } from "./spec";

/** Only traits with an authored TickRate play HVA automatically in the native game. */
export function voxelAnimationParts(spec:RenderSpec){
  return spec.voxel?.parts.filter(p=>partVisibleByDefault(p)&&p.frames>1&&p.tickRate!==null&&p.tickRate>0)??[];
}
export function voxelAnimationFrames(spec:RenderSpec,timeMs:number){
  return Object.fromEntries(voxelAnimationParts(spec).map(p=>[p.id,Math.floor(Math.max(0,timeMs)/(p.tickRate!*40))%p.frames]));
}
/** The plain-word name of a voxel model's cycle: Rotor spin, Propeller or Radar spin. */
export function voxelCycleLabel(spec: RenderSpec) {
  return spinLabel(voxelAnimationParts(spec).map(p => (p.spin as SpinKind | undefined) ?? spinKind(p.label) ?? (p.trait.startsWith("WithVoxelHelicopterBody") ? "rotor" : null)));
}
