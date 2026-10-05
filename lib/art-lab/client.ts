/** Browser-side loading, decoding and caching of the published art files, plus in-game thumbnail drawing. */
import { decodeHva, type Hva } from "./hva";
import { decodePal, type Palette } from "./pal";
import { decodeShp, type Shp } from "./shp";
import { decodeVxl, type Vxl } from "./vxl";
import { parseHexColor, remapPalette } from "./remap";
import { RA2_NORMALS, TS_NORMALS } from "./normals.generated";
import { poseParts, rasterizeUnit, type RasterImage } from "./raster";
import { blit } from "./sprite-render";
import { composeLayers, turretScreenOffset, type SpriteLayer } from "./sprite-compose";
import ShpWorker from "./shp-worker?worker";
import { partVisibleByDefault, type PaletteSpec, type RenderSpec } from "./spec";

const bytesCache = new Map<string, Promise<Uint8Array>>();
export function loadBytes(url: string): Promise<Uint8Array> {
  let p = bytesCache.get(url);
  if (!p) {
    p = fetch(url).then(async r => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    });
    p.catch(() => bytesCache.delete(url));
    bytesCache.set(url, p);
  }
  return p;
}

const decoded = new Map<string, Promise<unknown>>();
function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  let p = decoded.get(key) as Promise<T> | undefined;
  if (!p) { p = make(); p.catch(() => decoded.delete(key)); decoded.set(key, p); }
  return p;
}
export const loadVxl = (url: string) => cached<Vxl>(`vxl:${url}`, async () => decodeVxl(await loadBytes(url)));
export const loadHva = (url: string) => cached<Hva>(`hva:${url}`, async () => decodeHva(await loadBytes(url)));
let shpWorker: Worker | undefined, decodeId = 0;
const pendingShp = new Map<number, { resolve: (shp: Shp) => void; reject: (e: Error) => void }>();
export const loadShp = (url: string) => cached<Shp>(`shp:${url}`, async () => {
  const bytes = await loadBytes(url);
  if (typeof Worker === "undefined") return decodeShp(bytes);
  if (!shpWorker) {
    shpWorker = new ShpWorker();
    shpWorker.onmessage = e => { const job = pendingShp.get(e.data.id); pendingShp.delete(e.data.id); if (e.data.error) job?.reject(new Error(e.data.error)); else job?.resolve(e.data.shp); };
    shpWorker.onerror = () => { for (const job of pendingShp.values()) job.reject(new Error("Sprite decoder failed")); pendingShp.clear(); shpWorker?.terminate(); shpWorker = undefined; };
  }
  return new Promise<Shp>((resolve, reject) => { const id = ++decodeId; pendingShp.set(id, { resolve, reject }); const copy = bytes.slice(); shpWorker!.postMessage({ id, bytes: copy }, [copy.buffer]); });
});

/** Base palette (no remap) as OpenRA loads it. */
export const loadBasePalette = (spec: PaletteSpec) => cached<Palette>(`pal:${spec.url}:${spec.transparent}:${spec.shadow}`, async () => decodePal(await loadBytes(spec.url), spec.transparent, spec.shadow));

/** Player palette for a house colour (hex without #), or the base palette when hex is null. */
export async function loadPlayerPalette(spec: PaletteSpec, hex: string | null): Promise<Palette> {
  const base = await loadBasePalette(spec);
  return hex && spec.remap.length ? remapPalette(base, spec.remap, parseHexColor(hex)) : base;
}

export const normalsTable = (type: "RedAlert2" | "TiberianSun") => (type === "RedAlert2" ? RA2_NORMALS : TS_NORMALS);

export type InGameOptions = {
  facing: number;
  turretFacing?: number;
  color: string | null;
  frame?: number;
  /** Show conditional parts too (e.g. the empty launcher), keyed by part id. */
  enabledParts?: Record<string, boolean>;
  airborne?: boolean;
  shadow?: boolean;
  /** Fixed output frame for aligning several units. */
  frameBox?: { width: number; height: number; anchorX: number; anchorY: number };
};

export type InGameImage = RasterImage & { notes: string[] };

/** The battlefield look of one unit at 1x, drawn on the CPU (voxels) or from SHP frames (sprites). */
export async function renderInGame(spec: RenderSpec, options: InGameOptions): Promise<InGameImage> {
  if (!spec.palette) throw new Error(`${spec.id}: no published palette`);
  const palette = await loadPlayerPalette(spec.palette, options.color);
  if (spec.voxel) {
    const v = spec.voxel;
    const parts = v.parts.filter(p => options.enabledParts?.[p.id] ?? partVisibleByDefault(p));
    const poses = poseParts(parts.map(p => ({ ...p, turret: p.turretOffset ? { offset: p.turretOffset } : null })), options.facing, options.turretFacing ?? 0, v.useClassicPerspectiveFudge, v.cameraPitch);
    const loaded = await Promise.all(poses.map(async ({ part, yaw, worldOffset }) => ({
      vxl: await loadVxl(part.vxl), hva: await loadHva(part.hva), yaw, worldOffset,
      frame: options.frame ?? 0, showShadow: options.shadow === false ? false : part.showShadow,
    })));
    const image = rasterizeUnit({
      parts: loaded, scale: v.scale, cameraPitch: v.cameraPitch, lightPitch: v.lightPitch, lightYaw: v.lightYaw,
      ambient: v.ambient, diffuse: v.diffuse, palette, normals: normalsTable(v.normals),
      shadowColor: [0, 0, 0, 140], altitude: options.airborne && v.altitude ? v.altitude : 0,
    }, options.frameBox);
    return { ...image, notes: [] };
  }
  const s = spec.sprite;
  const stand = s?.stand;
  if (!s || !stand?.file) throw new Error(`${spec.id}: no published sprite body`);
  const shp = await loadShp(stand.file);
  const layers: SpriteLayer[] = [{ shp, seq: stand, facing: options.facing, frame: options.frame ?? 0 }];
  if (s.turret?.file) layers.push({ shp: await loadShp(s.turret.file), seq: s.turret, facing: (options.turretFacing ?? s.turretInitialFacing ?? 0) & 1023, frame: 0 });
  const overlays = s.overlays ?? (s.overlay ? [{ seq: s.overlay, offset: [0, 0, 0] as [number, number, number], animated: true }] : []);
  for (const o of overlays) if (o.seq.file) layers.push({ shp: await loadShp(o.seq.file), seq: o.seq, facing: options.facing, frame: o.animated ? options.frame ?? 0 : 0, ...turretScreenOffset(o.offset, stand.facings > 1 ? options.facing : 0) });
  layers.sort((a, b) => (a.seq.zOffset + a.seq.offset[2]) - (b.seq.zOffset + b.seq.offset[2]));
  const image = composeLayers(layers, palette, shp, stand, options.shadow !== false);
  if (!options.frameBox) return { ...image, notes: [] };
  const box = options.frameBox, data = new Uint8ClampedArray(4 * box.width * box.height);
  blit(data, box.width, box.height, image.data, image.width, image.height, box.anchorX - image.anchorX, box.anchorY - image.anchorY);
  return { ...box, data, notes: [] };
}

/** Multiplies RGB by a map tint (TintPostProcessEffect), leaving alpha. */
export function applyTint(data: Uint8ClampedArray, tint: [number, number, number]) {
  if (tint[0] === 1 && tint[1] === 1 && tint[2] === 1) return data;
  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < out.length; i += 4) { out[i] = data[i] * tint[0]; out[i + 1] = data[i + 1] * tint[1]; out[i + 2] = data[i + 2] * tint[2]; }
  return out;
}

export function toImageData(image: { width: number; height: number; data: Uint8ClampedArray }) {
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
}
