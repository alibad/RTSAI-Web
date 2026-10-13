/**
 * Tiberian Sun / Red Alert 2 SHP, following OpenRA.Mods.Common/SpriteLoaders/ShpTSLoader.cs.
 * Header: 0, width, height, frame count; then 24-byte frame headers (x, y, w, h, compression, 3 unused,
 * radar colour, 4 reserved, data offset). Compression 0/1: raw rows of `w` bytes; 2: rows prefixed by a
 * u16 length; 3: rows prefixed by a u16 length and RLE-zero encoded (0, n = n transparent pixels).
 */
import { decodeShpTd } from "./shp-td";
import { decodePngSheet, isPng } from "./png-sheet";

export type ShpFrame = {
  /** Position and size of the cropped data inside the full frame. */
  x: number;
  y: number;
  width: number;
  height: number;
  compression: number;
  radarColor: [number, number, number, number];
  dataOffset: number;
  /** Full-frame palette indices (frame width * height); 0 = transparent. */
  pixels: Uint8Array;
  /** True-colour frames (RGB(A) PNG sheets): full-frame RGBA, drawn as is; `pixels` then only marks opaque pixels. */
  rgba?: Uint8ClampedArray;
};

export type Shp = { width: number; height: number; frames: ShpFrame[] };

export const shpCompressionNames: Record<number, string> = { 0: "raw (0)", 1: "raw rows (1)", 2: "length-prefixed rows (2)", 3: "RLE-zero rows (3)" };

export function isShpTs(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || view.getUint16(0, true) !== 0) return false;
  const count = view.getUint16(6, true);
  if (8 + 24 * count > bytes.length) return false;
  let f = 0;
  let type = 0;
  let w = 0, h = 0;
  let p = 8;
  do {
    w = view.getUint16(p + 4, true);
    h = view.getUint16(p + 6, true);
    type = view.getUint8(p + 8);
    if ((w === 0 || h === 0) && type === 0) return false;
    p += 24;
  } while (w === 0 && h === 0 && ++f < count);
  return f === count || type < 4;
}

export function decodeShp(input: ArrayBuffer | Uint8Array): Shp {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  // OpenRA mods also draw sprites from PNG sheets (PngSheet sprite format).
  if (isPng(bytes)) return decodePngSheet(bytes);
  if (!isShpTs(bytes)) return decodeShpTd(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint16(2, true);
  const height = view.getUint16(4, true);
  const count = view.getUint16(6, true);
  const frames: ShpFrame[] = [];
  for (let i = 0; i < count; i++) {
    const h = 8 + 24 * i;
    const x = view.getUint16(h, true);
    const y = view.getUint16(h + 2, true);
    const w = view.getUint16(h + 4, true);
    const fh = view.getUint16(h + 6, true);
    const compression = view.getUint8(h + 8);
    const radarColor: [number, number, number, number] = [bytes[h + 12], bytes[h + 13], bytes[h + 14], bytes[h + 15]];
    const dataOffset = view.getUint32(h + 20, true);
    const pixels = new Uint8Array(width * height);
    if (dataOffset !== 0 && w > 0 && fh > 0) {
      let p = dataOffset;
      for (let row = 0; row < fh; row++) {
        const dest = (y + row) * width + x;
        if (compression === 3) {
          const length = view.getUint16(p, true) - 2;
          p += 2;
          const end = p + length;
          let d = 0;
          while (p < end) {
            const cmd = bytes[p++];
            if (cmd === 0) d += bytes[p++];
            else { if (d < w) pixels[dest + d] = cmd; d++; }
          }
        } else {
          const length = compression === 2 ? view.getUint16(p, true) - 2 : w;
          if (compression === 2) p += 2;
          for (let k = 0; k < Math.min(length, w); k++) pixels[dest + k] = bytes[p + k];
          p += length;
        }
      }
    }
    frames.push({ x, y, width: w, height: fh, compression, radarColor, dataOffset, pixels });
  }
  return { width, height, frames };
}
