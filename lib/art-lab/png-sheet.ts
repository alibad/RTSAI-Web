/**
 * OpenRA PNG sprite sheets, following OpenRA.Mods.Common/SpriteLoaders/PngSheetLoader.cs and OpenRA.Game/FileFormats/Png.cs.
 * Frames come from `Frame[i]` metadata ("x,y,w,h;ox,oy") or are slices of `FrameSize` / `FrameAmount` (else one frame).
 * Indexed PNGs keep their palette indices (drawn with the sequence's palette, like SHP); RGB(A) PNGs are true colour.
 */
import { unzlibSync } from "fflate";
import type { Shp, ShpFrame } from "./shp";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
export const isPng = (bytes: Uint8Array) => bytes.length > 8 && SIGNATURE.every((b, i) => bytes[i] === b);

function paeth(a: number, b: number, c: number) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePngSheet(bytes: Uint8Array): Shp {
  if (!isPng(bytes)) throw new Error("Not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, depth = 8, colorType = 0, interlace = 0;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  const meta = new Map<string, string>();
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at), type = String.fromCharCode(...bytes.subarray(at + 4, at + 8)), data = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") { width = view.getUint32(at + 8); height = view.getUint32(at + 12); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "tEXt") { const zero = data.indexOf(0); if (zero > 0) meta.set(String.fromCharCode(...data.subarray(0, zero)), String.fromCharCode(...data.subarray(zero + 1))); }
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (!width || !height || interlace) throw new Error("Unsupported PNG");
  const channels = colorType === 3 || colorType === 0 ? 1 : colorType === 4 ? 2 : colorType === 2 ? 3 : 4;
  const bits = channels * depth, stride = Math.ceil((width * bits) / 8), bpp = Math.max(1, bits >> 3);
  const packed = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  idat.reduce((at, c) => { packed.set(c, at); return at + c.length; }, 0);
  const raw = unzlibSync(packed);
  // Unfilter each scanline (filter byte then `stride` bytes).
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), out = rows.subarray(y * stride, (y + 1) * stride), prev = y ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0, b = prev ? prev[i] : 0, c = prev && i >= bpp ? prev[i - bpp] : 0;
      out[i] = (src[i] + (filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : filter === 4 ? paeth(a, b, c) : 0)) & 255;
    }
  }
  // Sample n of row y (bit depths below 8 are packed MSB first; 16-bit keeps the high byte).
  const sample = (y: number, n: number) => {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    if (depth === 8) return row[n];
    if (depth === 16) return row[2 * n];
    const per = 8 / depth, byte = row[Math.floor(n / per)], shift = 8 - depth * ((n % per) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const indexed = colorType === 3;
  const index = indexed ? new Uint8Array(width * height) : null, rgba = indexed ? null : new Uint8ClampedArray(width * height * 4);
  const key = !indexed && trns && trns.length >= (colorType === 2 ? 6 : 2) ? Array.from({ length: colorType === 2 ? 3 : 1 }, (_, i) => (trns![2 * i] << 8 | trns![2 * i + 1]) >> (depth === 16 ? 8 : 0)) : null;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x;
    if (index) { index[p] = sample(y, x); continue; }
    const s = (k: number) => sample(y, x * channels + k);
    const [r, g, b] = channels >= 3 ? [s(0), s(1), s(2)] : [s(0), s(0), s(0)];
    const scale = (v: number) => (depth < 8 ? Math.round((v * 255) / ((1 << depth) - 1)) : v);
    const alpha = channels === 4 ? s(3) : channels === 2 ? s(1) : key && (channels === 1 ? s(0) === key[0] : r === key[0] && g === key[1] && b === key[2]) ? 0 : 255;
    rgba!.set([scale(r), scale(g), scale(b), alpha], 4 * p);
  }
  // Frame regions: Frame[i] metadata, else FrameSize / FrameAmount slices.
  const regions: [number, number, number, number][] = [];
  const nums = (s: string) => s.split(",").map(v => Number(v.trim()));
  if ([...meta.keys()].some(k => k.startsWith("Frame["))) {
    for (let i = 0; meta.has(`Frame[${i}]`); i++) { const [x, y, w, h] = nums(meta.get(`Frame[${i}]`)!.split(";")[0]); regions.push([x, y, w, h]); }
  } else {
    let [fw, fh] = [width, height], amount = 1;
    if (meta.has("FrameSize")) { [fw, fh] = nums(meta.get("FrameSize")!); amount = meta.has("FrameAmount") ? Number(meta.get("FrameAmount")) : Math.floor(width / fw) * Math.floor(height / fh); }
    else if (meta.has("FrameAmount")) { amount = Number(meta.get("FrameAmount")); fw = Math.floor(width / amount); }
    const perRow = Math.max(1, Math.floor(width / fw));
    for (let i = 0; i < amount; i++) regions.push([(i % perRow) * fw, Math.floor(i / perRow) * fh, fw, fh]);
  }
  const W = Math.max(1, ...regions.map(r => r[2])), H = Math.max(1, ...regions.map(r => r[3]));
  const frames: ShpFrame[] = regions.map(([rx, ry, w, h]) => {
    // Smaller regions sit centred in the common frame, as the engine centres sprites.
    const x0 = (W - w) >> 1, y0 = (H - h) >> 1;
    const pixels = new Uint8Array(W * H), color = rgba ? new Uint8ClampedArray(W * H * 4) : undefined;
    for (let y = 0; y < h && ry + y < height; y++) for (let x = 0; x < w && rx + x < width; x++) {
      const from = (ry + y) * width + rx + x, to = (y0 + y) * W + x0 + x;
      if (index) pixels[to] = index[from];
      else { const a = rgba![4 * from + 3]; if (!a) continue; color!.set(rgba!.subarray(4 * from, 4 * from + 4), 4 * to); pixels[to] = 255; }
    }
    return { x: x0, y: y0, width: w, height: h, compression: -1, radarColor: [0, 0, 0, 0], dataOffset: 0, pixels, ...(color ? { rgba: color } : {}) };
  });
  return { width: W, height: H, frames };
}
