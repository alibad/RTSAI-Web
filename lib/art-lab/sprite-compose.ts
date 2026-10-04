/**
 * Sprite frame composition (pure, DOM-free): which sequences a sprite animation draws (its "rig"), and how
 * body, turret, overlay and their ShadowStart frames are layered around a fixed actor centre, exactly as the
 * shared viewer has always drawn them. Callers cache the results; nothing here keeps state.
 */
import type { Palette } from "./pal";
import type { RasterImage } from "./raster";
import type { Shp } from "./shp";
import { overlaySequence, pickAnimation, turretSequence, type SpriteAnimation } from "./sprite-anim";
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
  initialFacing: number;
  turretOffset: Vec3 | undefined;
  quantizedFacings: number;
  classicFacingBodyOrientation: boolean;
};

export type RigShps = { body: Shp; turret: Shp | null; overlay: Shp | null };

export function spriteRig(sprite: SpriteArt | null, animationId: string): SpriteRig | null {
  const animation = pickAnimation(sprite, animationId);
  if (!animation?.body) return null;
  const make = animation.id === "make";
  const damaged = animation.id.startsWith("damaged-");
  const damagedLayer = (base: SpriteSequence | null) => damaged && base ? sprite?.sequences.find(s => s.name === `damaged-${base.name}` && s.file) ?? base : base;
  return {
    animation, body: animation.body,
    turret: make ? null : damagedLayer(turretSequence(sprite)),
    overlay: make ? null : damagedLayer(overlaySequence(sprite)),
    initialFacing: sprite?.turret?.initialFacing ?? 0,
    turretOffset: sprite?.turret?.offset,
    quantizedFacings: sprite?.quantizedFacings ?? animation.body.facings,
    classicFacingBodyOrientation: sprite?.classicFacingBodyOrientation ?? false,
  };
}

/** SHP files a rig reads (deduplicated). */
export const rigFiles = (rig: SpriteRig) => [...new Set([rig.body.file, rig.turret?.file, rig.overlay?.file].filter((f): f is string => Boolean(f)))];

export const rigLength = (rig: SpriteRig, shps: RigShps) => sequenceLength(rig.body, shps.body);

/** True when the picture changes over time (a multi-frame body or an animated overlay). */
export function rigAnimates(rig: SpriteRig, shps: RigShps) {
  if (rigLength(rig, shps) > 1) return true;
  return Boolean(rig.overlay && shps.overlay && sequenceLength(rig.overlay, shps.overlay) > 1);
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
export function rigLayers(rig: SpriteRig, shps: RigShps, bodyFacing: number, bodyFrame: number, turretFacing: number, tick: number): SpriteLayer[] {
  const facings = rig.body.facings;
  const vehicle = facings > 1 && Boolean(rig.turret);
  const quantize = (f: number) => quantizeFacing(f, rig.quantizedFacings, rig.classicFacingBodyOrientation);
  const layers: SpriteLayer[] = [{ shp: shps.body, seq: rig.body, facing: bodyFacing, frame: bodyFrame }];
  if (rig.turret && shps.turret) {
    const angle = vehicle ? (quantize(bodyFacing) + turretFacing) & 1023 : (rig.initialFacing + turretFacing) & 1023;
    layers.push({ shp: shps.turret, seq: rig.turret, facing: angle, frame: 0, ...turretScreenOffset(rig.turretOffset, vehicle ? quantize(bodyFacing) : 0) });
  }
  if (rig.overlay && shps.overlay) layers.push({ shp: shps.overlay, seq: rig.overlay, facing: 0, frame: tick });
  return layers;
}

/**
 * Draws sprite layers around a fixed actor centre so frames never jitter: every layer's ShadowStart frame
 * first (the shadow palette index draws black at alpha 140), then body, turret and overlays in order.
 */
export function composeLayers(layers: SpriteLayer[], palette: Palette, base: Shp, baseSeq: SpriteSequence, shadows: boolean): RasterImage {
  const margin = 8 + Math.max(0, ...layers.map(l => Math.max(Math.abs(l.dx ?? 0), Math.abs(l.dy ?? 0))));
  const width = base.width + 2 * margin, height = base.height + 2 * margin;
  const anchorX = Math.round(base.width / 2 + margin - baseSeq.offset[0]);
  const anchorY = Math.round(base.height / 2 + margin - baseSeq.offset[1]);
  const data = new Uint8ClampedArray(4 * width * height);
  const draw = (layer: SpriteLayer, index: number) => {
    if (index < 0 || index >= layer.shp.frames.length) return;
    const at = framePosition(layer.shp, layer.seq, anchorX + (layer.dx ?? 0), anchorY + (layer.dy ?? 0));
    blit(data, width, height, drawShpFrame(layer.shp, index, palette), layer.shp.width, layer.shp.height, at.x, at.y);
  };
  if (shadows) for (const layer of layers) if (layer.seq.shadowStart >= 0) draw(layer, sequenceFrame(layer.seq, layer.frame, layer.facing, true));
  for (const layer of layers) draw(layer, sequenceFrame(layer.seq, layer.frame, layer.facing));
  return { width, height, data, anchorX, anchorY };
}

export type SpritePose = { facing: number; turretFacing: number; tick: number; shadow: boolean };

/** One finished picture of a rig: the body frame for `tick`, turret and overlay, with shadows. */
export function composeRig(rig: SpriteRig, shps: RigShps, palette: Palette, pose: SpritePose): RasterImage {
  const frame = rigFrame(rig, rigLength(rig, shps), pose.tick);
  return composeLayers(rigLayers(rig, shps, pose.facing, frame, pose.turretFacing, pose.tick), palette, shps.body, rig.body, pose.shadow);
}
