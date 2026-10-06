/**
 * A sprite atlas for pre-rasterized unit frames, and an instanced draw path over it.
 *
 * Frames (RGBA at 1x, with an anchor at the actor's centre) are shelf-packed into 1024 x 1024 pages with a 1 px gap.
 * A battlefield then draws a list of instances: today with Canvas 2D (`drawInstances`, nearest-neighbour), and a
 * WebGL renderer (such as the in-browser engine) can upload `pages` as textures and draw `packInstances` output as
 * one instanced quad batch per page.
 */
import type { FrameImage } from "./types";

export type AtlasFrame = {
  page: number;
  /** Rectangle in the page, in pixels. */
  x: number; y: number; w: number; h: number;
  /** Anchor (the actor's centre) inside the rectangle. */
  ax: number; ay: number;
  /** Opaque bounds relative to the anchor (health bars and labels sit above `top`). */
  left: number; top: number; right: number; bottom: number;
};

const PAGE = 1024;
const GAP = 1;

type Shelf = { y: number; height: number; x: number };
type Page = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; shelves: Shelf[]; bottom: number; size: number };

export class SpriteAtlas {
  readonly pages: HTMLCanvasElement[] = [];
  private book: Page[] = [];
  private frames = new Map<string, AtlasFrame>();
  /** Increments on every added frame. */
  version = 0;

  get size() { return this.frames.size; }
  get(key: string) { return this.frames.get(key); }
  has(key: string) { return this.frames.has(key); }

  add(key: string, image: FrameImage): AtlasFrame {
    const existing = this.frames.get(key);
    if (existing) return existing;
    const w = Math.max(1, image.width), h = Math.max(1, image.height);
    const { page, x, y } = this.place(w + GAP, h + GAP);
    const target = this.book[page];
    if (image.width && image.height) target.ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data.buffer as ArrayBuffer, image.data.byteOffset, image.data.length), image.width, image.height), x, y);
    const bounds = opaqueBounds(image);
    const frame: AtlasFrame = { page, x, y, w, h, ax: image.anchorX, ay: image.anchorY, ...bounds };
    this.frames.set(key, frame);
    this.version++;
    return frame;
  }

  private newPage(size: number) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    this.book.push({ canvas, ctx, shelves: [], bottom: 0, size });
    this.pages.push(canvas);
    return this.book.length - 1;
  }

  /** Shelf packing: the first shelf tall enough with room, else a new shelf, else a new page. */
  private place(w: number, h: number) {
    if (w > PAGE || h > PAGE) { const page = this.newPage(Math.max(w, h)); this.book[page].bottom = h; return { page, x: 0, y: 0 }; }
    for (let i = 0; i < this.book.length; i++) {
      const p = this.book[i];
      if (p.size !== PAGE) continue;
      for (const shelf of p.shelves) if (shelf.height >= h && shelf.height <= h * 1.6 && shelf.x + w <= PAGE) { const at = { page: i, x: shelf.x, y: shelf.y }; shelf.x += w; return at; }
      if (p.bottom + h <= PAGE) { p.shelves.push({ y: p.bottom, height: h, x: w }); const at = { page: i, x: 0, y: p.bottom }; p.bottom += h; return at; }
    }
    const page = this.newPage(PAGE);
    this.book[page].shelves.push({ y: 0, height: h, x: w });
    this.book[page].bottom = h;
    return { page, x: 0, y: 0 };
  }

  /** Releases every page (the battlefield closed). */
  clear() {
    for (const p of this.book) { p.canvas.width = p.canvas.height = 0; }
    this.book = [];
    this.pages.length = 0;
    this.frames.clear();
    this.version++;
  }
}

function opaqueBounds(image: FrameImage) {
  const { width, height, data } = image;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[4 * (y * width + x) + 3] < 200) continue; // ignore the translucent shadow
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return { left: 0, top: 0, right: 0, bottom: 0 };
  return { left: x0 - image.anchorX, top: y0 - image.anchorY, right: x1 + 1 - image.anchorX, bottom: y1 + 1 - image.anchorY };
}

/** One sprite to draw: its frame, the anchor position and scale in the target's coordinates, and opacity. */
export type Instance = { frame: AtlasFrame; x: number; y: number; scale: number; alpha: number };

/** Canvas 2D draw path: nearest-neighbour, one drawImage per instance, in the given (depth-sorted) order. */
export function drawInstances(ctx: CanvasRenderingContext2D, atlas: SpriteAtlas, instances: readonly Instance[]) {
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  for (const { frame: f, x, y, scale, alpha } of instances) {
    const page = atlas.pages[f.page];
    if (!page || alpha <= 0) continue;
    ctx.globalAlpha = alpha;
    ctx.drawImage(page, f.x, f.y, f.w, f.h, x - f.ax * scale, y - f.ay * scale, f.w * scale, f.h * scale);
  }
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = smoothing;
}

/** Floats per instance in `packInstances`: dest x0, y0, x1, y1; texture u0, v0, u1, v1 (0..1 of the page); page; alpha. */
export const INSTANCE_FLOATS = 10;

/**
 * The same instances as a flat buffer for a WebGL instanced draw: bind page textures (NEAREST filtering), draw a unit
 * quad per instance with these attributes. `out` is reused when large enough.
 */
export function packInstances(atlas: SpriteAtlas, instances: readonly Instance[], out?: Float32Array): Float32Array {
  const buffer = out && out.length >= instances.length * INSTANCE_FLOATS ? out : new Float32Array(instances.length * INSTANCE_FLOATS);
  instances.forEach(({ frame: f, x, y, scale, alpha }, i) => {
    const size = atlas.pages[f.page]?.width || 1, o = i * INSTANCE_FLOATS;
    const x0 = x - f.ax * scale, y0 = y - f.ay * scale;
    buffer[o] = x0; buffer[o + 1] = y0; buffer[o + 2] = x0 + f.w * scale; buffer[o + 3] = y0 + f.h * scale;
    buffer[o + 4] = f.x / size; buffer[o + 5] = f.y / size; buffer[o + 6] = (f.x + f.w) / size; buffer[o + 7] = (f.y + f.h) / size;
    buffer[o + 8] = f.page; buffer[o + 9] = alpha;
  });
  return buffer;
}
