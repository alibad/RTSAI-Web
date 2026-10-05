import type { Palette } from "./pal";

/**
 * OpenRA's PlayerColorRemap (OpenRA.Game/Graphics/PlayerColorRemap.cs): for each remap index, keep the
 * original colour's HSV value (in linear light), and take hue and saturation from the player colour,
 * scaling the value by the player colour's own value.
 */
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return [0, 0, max];
  let hue: number;
  if (r === max) hue = (g - b) / (6 * delta);
  else if (g === max) hue = (b - r) / (6 * delta) + 1 / 3;
  else hue = (r - g) / (6 * delta) + 2 / 3;
  let h = hue - Math.trunc(hue);
  if (h < 0) h++;
  return [h, delta / max, max];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mod1 = (v: number) => v - Math.trunc(v); // C# float % 1 keeps the sign; inputs here are >= 0.

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const px = Math.abs(h * 6 - 3);
  const py = Math.abs(mod1(h + 2 / 3) * 6 - 3);
  const pz = Math.abs(mod1(h + 1 / 3) * 6 - 3);
  return [v * lerp(1, clamp01(px - 1), s), v * lerp(1, clamp01(py - 1), s), v * lerp(1, clamp01(pz - 1), s)];
}

export function parseHexColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Bad colour ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Returns a new palette with `indices` remapped to `playerColor` (sRGB 0..255). */
export function remapPalette(base: Palette, indices: readonly number[], playerColor: [number, number, number]): Palette {
  const out = new Uint8ClampedArray(base);
  const [hue, saturation, value] = rgbToHsv(...(playerColor.map(c => srgbToLinear(c / 255)) as [number, number, number]));
  for (const i of indices) {
    const a = base[4 * i + 3];
    if (a === 0) continue;
    // Palettes here are straight alpha; OpenRA's premultiplied maths reduces to the same for opaque entries.
    const r = srgbToLinear(base[4 * i] / 255);
    const g = srgbToLinear(base[4 * i + 1] / 255);
    const b = srgbToLinear(base[4 * i + 2] / 255);
    const v = Math.max(r, g, b);
    const [nr, ng, nb] = hsvToRgb(hue, saturation, v * value);
    out[4 * i] = Math.round(linearToSrgb(nr) * 255);
    out[4 * i + 1] = Math.round(linearToSrgb(ng) * 255);
    out[4 * i + 2] = Math.round(linearToSrgb(nb) * 255);
  }
  return out;
}

/** The mod's lobby preset colours (rules/world.yaml ColorPickerManager), a subset offered as house colours. */
export const houseColors = [
  { id: "red", name: "Red", hex: "F21818" },
  { id: "blue", name: "Blue", hex: "1821F2" },
  { id: "green", name: "Green", hex: "18F26F" },
  { id: "gold", name: "Gold", hex: "F2BC18" },
  { id: "sky", name: "Sky", hex: "18BEF2" },
  { id: "purple", name: "Purple", hex: "BA18F2" },
] as const;
export type HouseColorId = (typeof houseColors)[number]["id"];
