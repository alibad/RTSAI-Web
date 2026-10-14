"use client";

import type { Backdrop } from "../PixelCanvas";

/** A 1x ground picture whose actor centre is (anchorX, anchorY). */
export type Ground = { canvas: HTMLCanvasElement; width: number; height: number; anchorX: number; anchorY: number };

/** Ground kinds: the viewer's backdrops, plus water, which ships always sit on (they never appear on land). */
export type GroundKind = Backdrop | "water";
const base: Record<GroundKind, [number, number, number]> = {
  sand: [196, 160, 96], grass: [104, 116, 58], dark: [34, 38, 33], checker: [70, 75, 67], none: [60, 64, 58], water: [46, 86, 110],
};
/** The ground an actor is shown on: naval units on water, everything else on the chosen backdrop. */
export const groundFor = (category: string | undefined, chosen: Backdrop): GroundKind => (category === "ship" ? "water" : chosen);

/** Deterministic per-pixel grain, so the ground reads as terrain and never flickers. */
const grain = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 255) / 255 - 0.5;
};

function paint(kind: GroundKind, tint: readonly number[], width: number, height: number, cx: number, cy: number, alphaAt: (x: number, y: number) => number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.createImageData(width, height);
  const [r, g, b] = base[kind];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = alphaAt(x, y);
    if (a <= 0) continue;
    // RA2 cells are 60x30 diamonds; u and v cross a whole number on every cell border.
    const u = (x + 0.5 - cx) / 60 + (y + 0.5 - cy) / 30 + 0.5;
    const v = (y + 0.5 - cy) / 30 - (x + 0.5 - cx) / 60 + 0.5;
    const edge = (u - Math.floor(u)) * 30 < 1 || (v - Math.floor(v)) * 30 < 1;
    let k = 1 + grain(x, y) * 0.07;
    if (edge) k *= 0.9;
    if (kind === "checker") k = ((x >> 2) + (y >> 2)) % 2 ? 0.8 : 1.05;
    const i = 4 * (y * width + x);
    img.data[i] = r * k * tint[0];
    img.data[i + 1] = g * k * tint[1];
    img.data[i + 2] = b * k * tint[2];
    img.data[i + 3] = Math.round(255 * Math.min(1, a));
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Ground width (1x pixels) for a unit with this turning radius: about three and a half unit widths, 1-3 cells. */
export const groundWidth = (radius: number | null) => Math.max(72, Math.min(180, 2 * Math.round(((radius ?? 50) * 3.4) / 2)));

const tiles = new Map<string, Ground>();
/** A soft-edged diamond of terrain `width` 1x pixels wide, centred on the actor: the ground only under the unit. */
export function groundTile(kind: GroundKind, tint: readonly number[], width = 180): Ground {
  const key = `${kind}|${tint.join(",")}|${width}`;
  let t = tiles.get(key);
  if (!t) {
    const height = width / 2, cx = width / 2, cy = height / 2;
    const canvas = paint(kind, tint, width, height, cx, cy, (x, y) => {
      const d = Math.abs(x + 0.5 - cx) / cx + Math.abs(y + 0.5 - cy) / cy;
      return d >= 1 ? 0 : d < 0.55 ? 1 : 1 - (d - 0.55) / 0.45;
    });
    t = { canvas, width, height, anchorX: cx, anchorY: cy };
    tiles.set(key, t);
  }
  return t;
}

const strips = new Map<string, Ground>();
/** A rectangular strip of terrain (the lineup's shared ground), 1x size w x h. */
export function groundStrip(kind: GroundKind, tint: readonly number[], width: number, height: number): Ground {
  const key = `${kind}|${tint.join(",")}|${width}x${height}`;
  let s = strips.get(key);
  if (!s) {
    if (strips.size > 24) strips.clear();
    s = { canvas: paint(kind, tint, width, height, 30, 15, () => 1), width, height, anchorX: 0, anchorY: 0 };
    strips.set(key, s);
  }
  return s;
}

const paths = new Map<string, Ground>();
/**
 * Terrain along a line: a soft-edged band from the actor (the anchor) to a point (dx, dy) 1x pixels away, `half`
 * pixels either side, its RA2 cell grid drawn in so distances read in cells (the viewer's Attack demo).
 */
export function groundPath(kind: GroundKind, tint: readonly number[], dx: number, dy: number, half: number): Ground {
  const key = `${kind}|${tint.join(",")}|${Math.round(dx)},${Math.round(dy)}|${half}`;
  let g = paths.get(key);
  if (!g) {
    if (paths.size > 12) paths.clear();
    const pad = half * 1.7;
    const left = Math.floor(Math.min(0, dx) - pad), top = Math.floor(Math.min(0, dy) - pad / 2);
    const width = Math.ceil(Math.max(0, dx) + pad) - left, height = Math.ceil(Math.max(0, dy) + pad / 2) - top;
    const ax = -left, ay = -top, len2 = dx * dx + 4 * dy * dy || 1;
    // Distance from the segment in ground space (a screen pixel down is two across), so the band lies flat.
    const canvas = paint(kind, tint, width, height, ax, ay, (x, y) => {
      const px = x + 0.5 - ax, py = y + 0.5 - ay;
      const k = Math.max(0, Math.min(1, (px * dx + 4 * py * dy) / len2));
      const d = Math.hypot(px - k * dx, 2 * (py - k * dy)) / half;
      return d >= 1.7 ? 0 : d < 0.9 ? 1 : 1 - (d - 0.9) / 0.8;
    });
    g = { canvas, width, height, anchorX: ax, anchorY: ay };
    paths.set(key, g);
  }
  return g;
}
