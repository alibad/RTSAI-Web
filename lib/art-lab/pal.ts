/** A 256-colour palette as straight (non-premultiplied) RGBA bytes, 1024 bytes long. */
export type Palette = Uint8ClampedArray;

/**
 * Westwood .pal: 256 RGB triplets of 6-bit values. Mirrors OpenRA's ImmutablePalette(Stream):
 * shift left by two, replicate the high bits into the low bits, then clear the transparent indices
 * (index 0 for PaletteFromFile) and give shadow indices alpha 140.
 */
export function decodePal(bytes: Uint8Array, transparent: readonly number[] = [0], shadow: readonly number[] = []): Palette {
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
  for (const i of transparent) out.fill(0, 4 * i, 4 * i + 4);
  for (const i of shadow) { out.fill(0, 4 * i, 4 * i + 3); out[4 * i + 3] = 140; }
  return out;
}

/** True when every byte is a valid 6-bit component (0..63), as Westwood palettes require. */
export function isSixBitPal(bytes: Uint8Array) {
  return bytes.length === 768 && bytes.every(b => b < 64);
}
