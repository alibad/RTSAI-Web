/**
 * Westwood VXL (Tiberian Sun / Red Alert 2 voxel model), following OpenRA.Mods.Cnc/FileFormats/VxlReader.cs.
 * Layout: 802-byte header (incl. 768-byte embedded palette), 28-byte limb headers, the body (span data),
 * then 92-byte limb tailers. Each limb is a sx*sy grid of columns; each column is a list of spans
 * (skip, count, count*(colour, normal), count).
 */
export type NormalsMode = 2 | 4;

export type VxlLimb = {
  name: string;
  /** Limb tailer fields. */
  spanStartOffset: number;
  spanEndOffset: number;
  spanDataOffset: number;
  scale: number;
  /** 3x4 transform stored in the tailer (OpenRA ignores it; the HVA supplies the transform). */
  transform: number[];
  /** minX, minY, minZ, maxX, maxY, maxZ in voxel units before `scale`. */
  bounds: [number, number, number, number, number, number];
  size: [number, number, number];
  normalsMode: number;
  voxelCount: number;
  /** Flat occupancy: index = x + sx*(y + sy*z); colour 0 with normal 0 and `filled` false means empty. */
  colors: Uint8Array;
  normals: Uint8Array;
  filled: Uint8Array;
  /** Number of non-empty columns and spans, for inspection. */
  columns: number;
  spans: number;
  /** Format irregularities found while decoding (OpenRA tolerates them silently). */
  problems: string[];
};

export type Vxl = {
  fileType: string;
  paletteCount: number;
  limbCount: number;
  tailerCount: number;
  bodySize: number;
  remapStart: number;
  remapEnd: number;
  embeddedPalette: Uint8Array;
  limbs: VxlLimb[];
};

function ascii(view: DataView, offset: number, length: number) {
  let s = "";
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

export function decodeVxl(input: ArrayBuffer | Uint8Array): Vxl {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fileType = ascii(view, 0, 16);
  if (!fileType.startsWith("Voxel Animation")) throw new Error("Invalid VXL header");
  const paletteCount = view.getUint32(16, true);
  const limbCount = view.getUint32(20, true);
  const tailerCount = view.getUint32(24, true);
  const bodySize = view.getUint32(28, true);
  const remapStart = view.getUint8(32);
  const remapEnd = view.getUint8(33);
  const embeddedPalette = bytes.slice(34, 34 + 768);
  const headerEnd = 802;
  const bodyStart = headerEnd + 28 * limbCount;
  const tailerStart = bodyStart + bodySize;
  if (tailerStart + 92 * limbCount > bytes.length) throw new Error(`VXL truncated: ${bytes.length} bytes, header needs ${tailerStart + 92 * limbCount}`);

  const limbs: VxlLimb[] = [];
  for (let i = 0; i < limbCount; i++) {
    const name = ascii(view, headerEnd + 28 * i, 16);
    const t = tailerStart + 92 * i;
    const spanStartOffset = view.getUint32(t, true);
    const spanEndOffset = view.getUint32(t + 4, true);
    const spanDataOffset = view.getUint32(t + 8, true);
    const scale = view.getFloat32(t + 12, true);
    const transform = Array.from({ length: 12 }, (_, k) => view.getFloat32(t + 16 + 4 * k, true));
    const bounds = Array.from({ length: 6 }, (_, k) => view.getFloat32(t + 64 + 4 * k, true)) as VxlLimb["bounds"];
    const size: [number, number, number] = [view.getUint8(t + 88), view.getUint8(t + 89), view.getUint8(t + 90)];
    const normalsMode = view.getUint8(t + 91);
    limbs.push({
      name, spanStartOffset, spanEndOffset, spanDataOffset, scale, transform, bounds, size, normalsMode,
      voxelCount: 0, colors: new Uint8Array(0), normals: new Uint8Array(0), filled: new Uint8Array(0), columns: 0, spans: 0, problems: [],
    });
  }

  for (const limb of limbs) {
    // Like OpenRA, read the column-start table at the limb's first tailer offset and take the span data as
    // starting right after the start and end tables; the stored data offset is only cross-checked.
    const [sx, sy, sz] = limb.size;
    const base = sx * sy;
    const starts = bodyStart + limb.spanStartOffset;
    const dataStart = starts + 8 * base;
    if (limb.spanDataOffset !== limb.spanStartOffset + 8 * base) limb.problems.push(`span data offset ${limb.spanDataOffset} != start + 8*sx*sy`);
    const n = sx * sy * sz;
    limb.colors = new Uint8Array(n);
    limb.normals = new Uint8Array(n);
    limb.filled = new Uint8Array(n);
    for (let i = 0; i < base; i++) {
      const colStart = view.getInt32(starts + 4 * i, true);
      if (colStart === -1) continue;
      limb.columns++;
      const x = i % sx;
      const y = Math.floor(i / sx);
      let p = dataStart + colStart;
      let z = 0;
      do {
        z += view.getUint8(p++);
        const count = view.getUint8(p++);
        limb.spans++;
        for (let j = 0; j < count; j++) {
          const color = view.getUint8(p++);
          const normal = view.getUint8(p++);
          if (z < sz) {
            const index = x + sx * (y + sy * z);
            if (!limb.filled[index]) limb.voxelCount++;
            limb.colors[index] = color;
            limb.normals[index] = normal;
            limb.filled[index] = 1;
          } else limb.problems.push(`span runs past height ${sz} at column ${x},${y}`);
          z++;
        }
        const duplicate = view.getUint8(p++);
        if (duplicate !== count) limb.problems.push(`span count ${count} != trailing copy ${duplicate} at column ${x},${y}`);
      } while (z < sz);
    }
  }
  return { fileType, paletteCount, limbCount, tailerCount, bodySize, remapStart, remapEnd, embeddedPalette, limbs };
}

/** Header checks the Art Lab reports: the grid declared by each tailer must agree with its bounds and span data. */
export function checkVxl(vxl: Vxl) {
  const problems: string[] = [];
  if (vxl.limbCount !== vxl.tailerCount) problems.push(`limb count ${vxl.limbCount} != tailer count ${vxl.tailerCount}`);
  for (const limb of vxl.limbs) {
    const [x0, y0, z0, x1, y1, z1] = limb.bounds;
    const extents = [x1 - x0, y1 - y0, z1 - z0];
    extents.forEach((e, axis) => {
      if (Math.abs(e - limb.size[axis]) > 1e-3) problems.push(`${limb.name}: bounds span ${e.toFixed(2)} on axis ${"xyz"[axis]} but size is ${limb.size[axis]}`);
    });
    if (limb.spanEndOffset - limb.spanStartOffset !== 4 * limb.size[0] * limb.size[1]) problems.push(`${limb.name}: span tables are not sx*sy entries`);
    if (limb.normalsMode !== 2 && limb.normalsMode !== 4) problems.push(`${limb.name}: unknown normals mode ${limb.normalsMode}`);
    problems.push(...[...new Set(limb.problems)].map(problem => `${limb.name}: ${problem}`));
  }
  return problems;
}

export function voxelAt(limb: VxlLimb, x: number, y: number, z: number) {
  const [sx, sy, sz] = limb.size;
  if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return -1;
  const index = x + sx * (y + sy * z);
  return limb.filled[index] ? index : -1;
}
