/**
 * SHP frame drawing and OpenRA sprite-sequence frame lookup (DefaultSpriteSequence.CalculateFrameIndices and
 * Util.IndexFacing). Pure and DOM-free.
 */
import type { Palette } from "./pal";
import type { Shp } from "./shp";
import type { SpriteSequence } from "./types";

/** Facing index for a WAngle facing: 0 = north, counter-clockwise (OpenRA Util.IndexFacing). */
// OpenRA.Mods.Cnc.Util: exclusive frame boundaries and the authored yaw for each frame.
export const classicFacingRanges = [20, 56, 88, 132, 156, 184, 212, 240, 268, 296, 324, 352, 384, 416, 452, 488, 532, 568, 604, 644, 668, 696, 724, 752, 780, 808, 836, 864, 896, 928, 964, 1000] as const;
export const classicFacingAngles = [0, 40, 74, 112, 146, 172, 200, 228, 256, 284, 312, 340, 370, 402, 436, 472, 512, 552, 588, 626, 658, 684, 712, 740, 768, 796, 824, 852, 882, 914, 948, 984] as const;

export function indexFacing(facing: number, facings: number, useClassicFacings = false) {
  if (useClassicFacings && facings === 32) {
    const index = classicFacingRanges.findIndex(boundary => (facing & 1023) < boundary);
    return index < 0 ? 0 : index;
  }
  const step = 1024 / facings;
  return Math.floor((((facing + step / 2) | 0) & 1023) / step);
}

/** BodyOrientation quantization is separate from a sequence's frame mapping. */
export function quantizeFacing(facing: number, facings: number, classicBodyOrientation = false) {
  if (!facings) return facing;
  const index = indexFacing(facing, facings, classicBodyOrientation);
  return classicBodyOrientation && facings === 32 ? classicFacingAngles[index] : index * 1024 / facings;
}

/** The SHP frame OpenRA shows for animation frame `frame` at `facing` (shadow = the ShadowStart copy). */
export function sequenceFrame(seq: SpriteSequence, frame: number, facing: number, shadow = false, shp?: Shp | null) {
  const length = Math.max(1, sequenceLength(seq, shp));
  const facingIndex = indexFacing(facing, seq.facings, seq.useClassicFacings);
  const inner = seq.reverseFacings ? (seq.facings - facingIndex) % seq.facings : facingIndex;
  const f = ((frame % length) + length) % length;
  const i = seq.transpose ? f * seq.facings + inner : inner * seq.stride + f;
  const base = seq.frames ? seq.frames[i] : seq.start + i;
  if (!shadow) return base;
  return seq.shadowStart >= 0 ? base + (seq.shadowStart - seq.start) : -1;
}

/** Frame count of one facing's animation. */
export const sequenceLength = (seq: SpriteSequence, shp?: Shp | null) => (seq.length === "*" ? (shp ? shp.frames.length - seq.start : 1) : seq.length);

/** Draws a full SHP frame (width x height) into RGBA with the palette; index 0 stays transparent. */
export function drawShpFrame(shp: Shp, index: number, palette: Palette, out?: Uint8ClampedArray): Uint8ClampedArray {
  const data = out ?? new Uint8ClampedArray(4 * shp.width * shp.height);
  const frame = shp.frames[index];
  if (!frame) return data;
  if (frame.rgba) {
    for (let i = 0; i < frame.pixels.length; i++) if (frame.rgba[4 * i + 3]) data.set(frame.rgba.subarray(4 * i, 4 * i + 4), 4 * i);
    return data;
  }
  for (let i = 0; i < frame.pixels.length; i++) {
    const c = frame.pixels[i];
    if (c === 0) continue;
    const a = palette[4 * c + 3];
    if (a === 0) continue;
    data[4 * i] = palette[4 * c];
    data[4 * i + 1] = palette[4 * c + 1];
    data[4 * i + 2] = palette[4 * c + 2];
    data[4 * i + 3] = a;
  }
  return data;
}

/** Alpha-composites `src` (w x h) onto `dst` (dw x dh) at integer (x, y). */
export function blit(dst: Uint8ClampedArray, dw: number, dh: number, src: Uint8ClampedArray, w: number, h: number, x: number, y: number) {
  for (let sy = 0; sy < h; sy++) {
    const ty = y + sy;
    if (ty < 0 || ty >= dh) continue;
    for (let sx = 0; sx < w; sx++) {
      const tx = x + sx;
      if (tx < 0 || tx >= dw) continue;
      const s = 4 * (sy * w + sx);
      const a = src[s + 3] / 255;
      if (a === 0) continue;
      const d = 4 * (ty * dw + tx);
      const da = dst[d + 3] / 255;
      const oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++) dst[d + c] = Math.round((src[s + c] * a + dst[d + c] * da * (1 - a)) / (oa || 1));
      dst[d + 3] = Math.round(oa * 255);
    }
  }
}

/**
 * Top-left position of a full SHP frame for an actor centred at (cx, cy): OpenRA centres the frame on the
 * actor position plus the sequence Offset (x, y; z only affects draw order).
 */
export function framePosition(shp: Shp, seq: SpriteSequence, cx: number, cy: number) {
  return { x: Math.round(cx + seq.offset[0] - shp.width / 2), y: Math.round(cy + seq.offset[1] - shp.height / 2) };
}
