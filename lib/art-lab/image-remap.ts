import { parseHexColor, remapPalette } from "./remap";

/** Authored identification regions for ONE image. Never infer ownership from faction hue. */
export type ImagePlayerColor = {
  image: string;
  width: number;
  height: number;
  regions: [number, number][][];
  marker: "signal-red" | "explicit";
};

export function validImagePlayerColor(value: ImagePlayerColor | undefined): value is ImagePlayerColor {
  return Boolean(value && value.width > 0 && value.height > 0 && Number.isFinite(value.width + value.height)
    && (value.marker === "signal-red" || value.marker === "explicit")
    && Array.isArray(value.regions) && value.regions.length > 0 && value.regions.length <= 128
    && value.regions.every(p => Array.isArray(p) && p.length >= 3 && p.length <= 128
      && p.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
        && point[0] >= 0 && point[1] >= 0 && point[0] <= value.width && point[1] <= value.height)));
}

/** Only used INSIDE authored regions, where the source explicitly uses red as a remap marker. */
export function isPlayerColorMarker(r: number, g: number, b: number) {
  return r > 35 && r > g * 1.45 && r > b * 1.45;
}

/** Same linear-light value mapping as OpenRA's palette remap; preserves all unmasked bytes. */
export function remapImagePixels(source: Uint8ClampedArray, mask: Uint8ClampedArray, color: string): Uint8ClampedArray {
  if (source.length % 4 || mask.length !== source.length / 4) throw new Error("Image and remap mask dimensions differ");
  const base = new Uint8ClampedArray(256 * 4);
  for (let v = 0; v < 256; v++) base.set([v, v, v, 255], v * 4);
  const lut = remapPalette(base, Array.from({ length: 256 }, (_, i) => i), parseHexColor(color));
  const output = new Uint8ClampedArray(source);
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || !source[p * 4 + 3]) continue;
    const i = p * 4, v = Math.max(source[i], source[i + 1], source[i + 2]) * 4, a = mask[p] / 255;
    for (let c = 0; c < 3; c++) output[i + c] = Math.round(source[i + c] * (1 - a) + lut[v + c] * a);
  }
  return output;
}
