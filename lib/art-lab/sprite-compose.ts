/**
 * Sprite frame composition (pure, DOM-free): which sequences a sprite animation draws (its "rig"), and how
 * body, turret, overlay and their ShadowStart frames are layered around a fixed actor centre, exactly as the
 * shared viewer has always drawn them. Callers cache the results; nothing here keeps state.
 */
import type { Palette } from "./pal";
import type { RasterImage } from "./raster";
import type { Shp } from "./shp";
import { pickAnimation, spriteOverlays, turretSequence, type SpriteAnimation } from "./sprite-anim";
import { blit, drawShpFrame, framePosition, quantizeFacing, sequenceFrame, sequenceLength } from "./sprite-render";
import type { SpriteArt, SpriteSequence, Vec3 } from "./types";
import { localToWorld, rotateYaw, screenVector } from "./voxel-math";

export type SpriteLayer = { shp: Shp; seq: SpriteSequence; facing: number; frame: number; dx?: number; dy?: number };

/** The sequences one animation draws: its body, and (except while building up) the turret and idle overlay. */
export type SpriteRig = {
  animation: SpriteAnimation;
  body: SpriteSequence;
  turret: SpriteSequence | null;
  overlay: SpriteSequence | null;
  overlays: { seq: SpriteSequence; offset: Vec3; animated: boolean }[];
  initialFacing: number;
  turretOffset: Vec3 | undefined;
  quantizedFacings: number;
  classicFacingBodyOrientation: boolean;
};

export type RigShps = { body: Shp; turret: Shp | null; overlay: Shp | null; overlays?: (Shp | null)[] };

export function spriteRig(sprite: SpriteArt | null, animationId: string): SpriteRig | null {
  const animation = pickAnimation(sprite, animationId);
  if (!animation?.body) return null;
  const make = animation.id === "make";
  const damaged = animation.id.startsWith("damaged-");
  const damagedLayer = (base: SpriteSequence | null) => damaged && base ? sprite?.sequences.find(s => s.name === `damaged-${base.name}` && s.file) ?? base : base;
  const overlays = make ? [] : spriteOverlays(sprite).filter(o => o.mode !== "activity" || animation.id === o.seq.name || animation.id === `damaged-${o.seq.name}`).map(o => ({
    seq: damagedLayer(o.seq)!, offset: o.offset,
    animated: o.mode === "loop" || animation.id === o.seq.name || animation.id === `damaged-${o.seq.name}`,
  }));
  return {
    animation, body: animation.body,
    turret: make ? null : damagedLayer(turretSequence(sprite)),
    overlay: overlays[0]?.seq ?? null, overlays,
    initialFacing: sprite?.turret?.initialFacing ?? 0,
    turretOffset: sprite?.turret?.offset,
    quantizedFacings: sprite?.quantizedFacings ?? animation.body.facings,
    classicFacingBodyOrientation: sprite?.classicFacingBodyOrientation ?? false,
  };
}

/** SHP files a rig reads (deduplicated). */
export const rigFiles = (rig: SpriteRig) => [...new Set([rig.body.file, rig.turret?.file, ...rig.overlays.map(o => o.seq.file)].filter((f): f is string => Boolean(f)))];

export const rigLength = (rig: SpriteRig, shps: RigShps) => sequenceLength(rig.body, shps.body);

/** Preview time is shared; every layer retains its own authored Tick and frame count. */
export function sequenceTimeFrame(seq:SpriteSequence,shp:Shp,timeMs:number,loop=true){
  const length=Math.max(1,sequenceLength(seq,shp)),period=seq.reverses&&length>1?2*length-2:length;
  const tick=Math.max(0,Math.floor(timeMs/Math.max(1,seq.tick)));
  const phase=loop?tick%period:Math.min(tick,period-1);
  return seq.reverses&&phase>=length?period-phase:phase;
}
export function sequenceDurationMs(seq:SpriteSequence,shp:Shp){
  const length=Math.max(1,sequenceLength(seq,shp));
  return (seq.reverses&&length>1?2*length-2:length)*Math.max(1,seq.tick);
}
export const rigTickMs=(rig:SpriteRig,shps:RigShps)=>Math.max(1,Math.min(rig.body.tick,...rig.overlays.filter((o,i)=>o.animated&&sequenceLength(o.seq,shps.overlays?.[i]??shps.overlay)>1).map(o=>o.seq.tick),...(rig.turret&&shps.turret&&sequenceLength(rig.turret,shps.turret)>1?[rig.turret.tick]:[])));

/** True when the picture changes over time (a multi-frame body or an animated overlay). */
export function rigAnimates(rig: SpriteRig, shps: RigShps) {
  if (rigLength(rig, shps) > 1) return true;
  if (rig.turret&&shps.turret&&sequenceLength(rig.turret,shps.turret)>1)return true;
  return rig.overlays.some((o, i) => o.animated && (shps.overlays?.[i] ?? (i === 0 ? shps.overlay : null)) && sequenceLength(o.seq, (shps.overlays?.[i] ?? shps.overlay)!) > 1);
}

/** The body frame shown at animation tick `tick` (ping-pong for reversing sequences). */
export function rigFrame(rig: SpriteRig, length: number, tick: number) {
  if (rig.body.reverses && length > 1) {
    const p = tick % (2 * length - 2);
    return p >= length ? 2 * length - 2 - p : p;
  }
  return tick % Math.max(1, length);
}

/** Turreted.Position for a sprite actor: the offset rotated by the quantized body facing, in screen pixels. */
export function turretScreenOffset(offset: Vec3 | undefined, bodyFacing: number) {
  if (!offset || (offset[0] === 0 && offset[1] === 0 && offset[2] === 0)) return { dx: 0, dy: 0 };
  const v = screenVector(localToWorld(rotateYaw(offset, bodyFacing), false, 85));
  return { dx: Math.round(v[0]), dy: Math.round(v[1]) };
}

/**
 * Layers for one picture. A vehicle's turret turns with its body (Turreted: world = body + local); a defence's
 * body never turns, so its turret angle is absolute from InitialFacing.
 */
export function rigLayers(rig: SpriteRig, shps: RigShps, bodyFacing: number, bodyFrame: number, turretFacing: number, tick: number, timeMs?:number,loop=true): SpriteLayer[] {
  const facings = rig.body.facings;
  const vehicle = facings > 1 && Boolean(rig.turret);
  const quantize = (f: number) => quantizeFacing(f, rig.quantizedFacings, rig.classicFacingBodyOrientation);
  const layers: SpriteLayer[] = [{ shp: shps.body, seq: rig.body, facing: bodyFacing, frame: bodyFrame }];
  if (rig.turret && shps.turret) {
    const angle = vehicle ? (quantize(bodyFacing) + turretFacing) & 1023 : (rig.initialFacing + turretFacing) & 1023;
    layers.push({ shp: shps.turret, seq: rig.turret, facing: angle, frame: timeMs===undefined?tick:sequenceTimeFrame(rig.turret,shps.turret,timeMs,loop), ...turretScreenOffset(rig.turretOffset, vehicle ? quantize(bodyFacing) : 0) });
  }
  for (const [i, o] of rig.overlays.entries()) {
    const shp = shps.overlays?.[i] ?? (i === 0 ? shps.overlay : null);
    if (shp) layers.push({ shp, seq: o.seq, facing: bodyFacing, frame: o.animated ? timeMs===undefined?tick:sequenceTimeFrame(o.seq,shp,timeMs,loop) : 0, ...turretScreenOffset(o.offset, vehicle ? quantize(bodyFacing) : 0) });
  }
  return layers.sort((a, b) => (a.seq.zOffset + a.seq.offset[2]) - (b.seq.zOffset + b.seq.offset[2]));
}

/**
 * Draws sprite layers around a fixed actor centre so frames never jitter: every layer's ShadowStart frame
 * first (the shadow palette index draws black at alpha 140), then body, turret and overlays in order.
 */
export function composeLayers(layers: SpriteLayer[], palette: Palette, base: Shp, baseSeq: SpriteSequence, shadows: boolean): RasterImage {
  // Include every full frame and offset, not just the body: roofs and machinery can be larger than the base.
  const at = layers.map(l => ({ ...framePosition(l.shp, l.seq, l.dx ?? 0, l.dy ?? 0), width: l.shp.width, height: l.shp.height }));
  const left = Math.min(-base.width / 2 + baseSeq.offset[0], ...at.map(p => p.x)) - 8;
  const top = Math.min(-base.height / 2 + baseSeq.offset[1], ...at.map(p => p.y)) - 8;
  const right = Math.max(base.width / 2 + baseSeq.offset[0], ...at.map(p => p.x + p.width)) + 8;
  const bottom = Math.max(base.height / 2 + baseSeq.offset[1], ...at.map(p => p.y + p.height)) + 8;
  const anchorX = Math.ceil(-left), anchorY = Math.ceil(-top);
  const width = Math.ceil(right + anchorX), height = Math.ceil(bottom + anchorY);
  const data = new Uint8ClampedArray(4 * width * height);
  const draw = (layer: SpriteLayer, index: number) => {
    if (index < 0 || index >= layer.shp.frames.length) return;
    const at = framePosition(layer.shp, layer.seq, anchorX + (layer.dx ?? 0), anchorY + (layer.dy ?? 0));
    blit(data, width, height, drawShpFrame(layer.shp, index, palette), layer.shp.width, layer.shp.height, at.x, at.y);
  };
  if (shadows) for (const layer of layers) if (layer.seq.shadowStart >= 0) draw(layer, sequenceFrame(layer.seq, layer.frame, layer.facing, true,layer.shp));
  for (const layer of layers) draw(layer, sequenceFrame(layer.seq, layer.frame, layer.facing,false,layer.shp));
  return { width, height, data, anchorX, anchorY };
}

export type SpritePose = { facing: number; turretFacing: number; tick: number; shadow: boolean;timeMs?:number;loop?:boolean };

export function rigPoseLayers(rig:SpriteRig,shps:RigShps,pose:SpritePose){
  const frame=pose.timeMs===undefined?rigFrame(rig,rigLength(rig,shps),pose.tick):sequenceTimeFrame(rig.body,shps.body,pose.timeMs,pose.loop??true);
  return rigLayers(rig,shps,pose.facing,frame,pose.turretFacing,pose.tick,pose.timeMs,pose.loop??true);
}

/** One finished picture of a rig: the body frame for `tick`, turret and overlay, with shadows. */
export function composeRig(rig: SpriteRig, shps: RigShps, palette: Palette, pose: SpritePose): RasterImage {
  return composeLayers(rigPoseLayers(rig,shps,pose), palette, shps.body, rig.body, pose.shadow);
}
