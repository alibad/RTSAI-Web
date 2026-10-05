/** Classic Red Alert SHP. Port of OpenRA's ShpTDLoader, LCWCompression and XORDeltaCompression.
 * Copyright The OpenRA Developers and Contributors, GPL-3.0-or-later. See LICENSE.
 * Keeps full frames, which is equivalent to the engine's trimmed frames at their original anchor.
 */
import type { Shp } from "./shp";

export function decodeShpTd(bytes: Uint8Array): Shp {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 30) throw new Error("Not a Classic SHP");
  const count = view.getUint16(0, true), width = view.getUint16(6, true), height = view.getUint16(8, true);
  if (!count || 14 + (count + 2) * 8 > bytes.length || view.getUint32(14 + count * 8, true) !== bytes.length || width * height > 4_194_304) throw new Error("Invalid Classic SHP header");
  const headers = Array.from({ length: count }, (_, i) => { const p = 14 + i * 8; return { offset: view.getUint32(p, true) & 0xffffff, type: bytes[p + 3], ref: view.getUint16(p + 4, true) }; });
  const decoded = new Map<number, Uint8Array>(), active = new Set<number>();
  const decode = (i: number): Uint8Array => {
    const hit = decoded.get(i); if (hit) return hit;
    const h = headers[i]; if (!h || active.has(i)) throw new Error("Invalid Classic SHP reference");
    active.add(i);
    const base = h.type === 0x20 ? i - 1 : headers.findIndex(q => q.offset === h.ref);
    const out = h.type === 0x80 ? new Uint8Array(width * height) : decode(base).slice();
    let p = h.offset, d = 0;
    const byte = () => { if (p >= bytes.length) throw new Error("Truncated SHP"); return bytes[p++]; };
    const word = () => byte() | byte() << 8;
    const check = (n: number) => { if (d + n > out.length) throw new Error("SHP frame overflow"); };
    for (let commands = 0; commands < bytes.length; commands++) {
      const cmd = byte();
      if (h.type === 0x80) {
        if (cmd === 0x80) break;
        if (cmd < 0x80) {
          const n = ((cmd & 0x70) >> 4) + 3, back = ((cmd & 15) << 8) + byte(); check(n);
          if (!back || back > d) throw new Error("Invalid LCW back reference");
          for (let k = 0; k < n; k++) { out[d] = out[d - back]; d++; }
        } else if (cmd < 0xc0) { const n = cmd & 63; check(n); for (let k = 0; k < n; k++) out[d++] = byte(); }
        else if (cmd === 0xfe) { const n = word(), color = byte(); check(n); out.fill(color, d, d + n); d += n; }
        else { const n = cmd === 0xff ? word() : (cmd & 63) + 3; let from = word(); check(n); if (from >= d) throw new Error("Invalid LCW reference"); for (let k = 0; k < n; k++) out[d++] = out[from++]; }
      } else if (h.type === 0x20 || h.type === 0x40) {
        if (cmd === 0) { const n = byte(), color = byte(); check(n); for (let k = 0; k < n; k++) out[d++] ^= color; }
        else if (cmd < 0x80) { check(cmd); for (let k = 0; k < cmd; k++) out[d++] ^= byte(); }
        else if (cmd > 0x80) { check(cmd & 127); d += cmd & 127; }
        else { const w = word(); if (!w) break; const n = w & (w < 0x8000 ? 0x7fff : 0x3fff); check(n); if (w < 0x8000) d += n; else if (w < 0xc000) for (let k = 0; k < n; k++) out[d++] ^= byte(); else { const color = byte(); for (let k = 0; k < n; k++) out[d++] ^= color; } }
      } else throw new Error("Unknown Classic SHP format");
    }
    decoded.set(i, out); active.delete(i); return out;
  };
  return { width, height, frames: headers.map((h, i) => ({ x: 0, y: 0, width, height, compression: h.type, radarColor: [0, 0, 0, 0], dataOffset: h.offset, pixels: decode(i) })) };
}
