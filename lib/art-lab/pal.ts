/** A 256-colour palette as straight (non-premultiplied) RGBA bytes, 1024 bytes long. */
export type Palette = Uint8ClampedArray;

/**
 * Westwood .pal: 256 RGB triplets of 6-bit values. Mirrors OpenRA's ImmutablePalette(Stream):
 * shift left by two, replicate the high bits into the low bits, then clear the transparent indices
 * (index 0 for PaletteFromFile) and give shadow indices alpha 140.
 */
export function decodePal(bytes: Uint8Array, transparent: readonly number[] = [0], shadow: readonly number[] = []): Palette {
  const text = decodeTextPal(bytes);
  if (text) return finish(text, transparent, shadow);
  if (bytes.length < 768) throw new Error(`PAL is ${bytes.length} bytes; expected 768`);
  const out = new Uint8ClampedArray(1024);
  for (let i = 0; i < 256; i++) {
    for (let c = 0; c < 3; c++) {
      let v = (bytes[3 * i + c] << 2) & 0xff;
      v |= v >> 6;
      out[4 * i + c] = v;
    }
    out[4 * i + 3] = 255;
  }
  return finish(out, transparent, shadow);
}

function finish(out: Uint8ClampedArray, transparent: readonly number[], shadow: readonly number[]) {
  for (const i of transparent) out.fill(0, 4 * i, 4 * i + 4);
  for (const i of shadow) { out.fill(0, 4 * i, 4 * i + 3); out[4 * i + 3] = 140; }
  return out;
}

/**
 * Text palettes (PaletteFromGimpOrJascFile, e.g. OpenHV): JASC-PAL ("JASC-PAL", version, count, then "r g b [a]")
 * or GIMP ("GIMP Palette", header lines, then "r g b name"); 8-bit components. Null for a binary .pal.
 */
function decodeTextPal(bytes: Uint8Array): Uint8ClampedArray | null {
  const head = String.fromCharCode(...bytes.subarray(0, 12));
  const jasc = head.startsWith("JASC-PAL"), gimp = head.startsWith("GIMP Palette");
  if (!jasc && !gimp) return null;
  const lines = new TextDecoder().decode(bytes).split(/\r?\n/).slice(jasc ? 3 : 1);
  const out = new Uint8ClampedArray(1024);
  let i = 0;
  for (const line of lines) {
    if (i >= 256) break;
    const parts = line.trim().split(/\s+/);
    if (!/^\d+$/.test(parts[0] ?? "")) continue;
    const [r, g, b] = parts.slice(0, 3).map(Number), a = jasc && /^\d+$/.test(parts[3] ?? "") ? Number(parts[3]) : 255;
    out.set([r, g, b, a], 4 * i++);
  }
  return out;
}

/** True when every byte is a valid 6-bit component (0..63), as Westwood palettes require. */
export function isSixBitPal(bytes: Uint8Array) {
  return bytes.length === 768 && bytes.every(b => b < 64);
}
