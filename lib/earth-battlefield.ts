// Earth battlefields compiled in the browser (or Node): a port of RTSAI-Mod tools/earth-battlefield.py compile_map()
// and the parts of tools/standalone-maps.py it uses (MapBuilder, poly_dist, road_mask, clean_path, field, cell_at,
// write_map). OpenStreetMap evidence is painted on the corner grid of the corner-transition templates; base zones,
// ground corridors and resources are deliberate gameplay edits. With the rough-ground noise switched off the output
// (map.yaml, map.bin, map.png pixels) is byte-for-byte the Python's; tests/earth-battlefield.test.ts checks that
// against the Python itself.
//
// Differences from the Python, all deliberate:
// - numpy's random generator cannot be reproduced, so smooth_noise uses a seeded mulberry32 + Box-Muller generator
//   with the same formula (still deterministic per seed).
// - numpy evaluates every corner against every segment and polygon; here each shape visits only the corners in its
//   bounding box (polygons by scanline), with the same arithmetic per corner, so the result is identical.
// - A building may be a single point (its centre, as /api/earth-features returns it); Python skips 1-point features.
// - Titles also lose "#" (a MiniYaml comment); map.yaml is always UTF-8 with LF line endings.
import { strToU8, zipSync, zlibSync } from "fflate";
import terrainData from "../data/earth-terrain.json";

export type EarthKind =
  | "water"
  | "coastline"
  | "river"
  | "dry-river"
  | "road"
  | "local-road"
  | "building"
  | "rail"
  | "forest"
  | "sand"
  | "rough"
  | "urban";
/** One OpenStreetMap way: points are [lat, lon]; a building may be a single point (its centre). */
export type EarthEvidence = { kind: EarthKind; closed?: boolean; points: [number, number][] };
export type BattlefieldRequest = {
  latitude: number;
  longitude: number;
  radius: number;
  seed: number;
  size: 48 | 64 | 80;
  players: 2 | 4;
  title: string;
  /** Recorded in the report as earth.json's sourceStatus (Python's request.get('sourceStatus')). */
  sourceStatus?: string;
};
export type BattlefieldReport = {
  id: string;
  title: string;
  players: 2 | 4;
  seed: number;
  latitude: number;
  longitude: number;
  radius: number;
  size: number;
  features: Record<string, number>;
  source: "OpenStreetMap";
  license: "ODbL-1.0";
  attribution: "© OpenStreetMap contributors";
  sourceStatus: string;
  validation: { connectedBases: true; clearBaseZones: true; homeMines: number; reachableCells: number };
  adaptations: string[];
};
export type Battlefield = {
  id: string;
  title: string;
  players: 2 | 4;
  size: number;
  width: number;
  height: number;
  yaml: string;
  bin: Uint8Array;
  png: Uint8Array;
  report: BattlefieldReport;
  oramap: Uint8Array;
};

const INVALID = "Invalid geographic selection or battlefield settings";
const DISCONNECTED = "Generated routes are disconnected; change the seed or location";
const MAX_FEATURES = 12000;
const DEFAULT_TITLE = "Earth Battlefield";

// Corner classes. Transition sets as in standalone-maps.py: SETS = water 0, dirt 1, rough 2, sand 3.
const GRASS = 0;
const WATER = 1;
const DIRT = 2;
const ROUGH = 3;
const SAND = 4;
const SET_INDEX = [-1, 0, 1, 2, 3];
const PRIORITY = [WATER, DIRT, SAND, ROUGH];
const FILL = new Map([["water", WATER], ["forest", ROUGH], ["urban", DIRT], ["rough", ROUGH], ["sand", SAND]]);
const STROKE = new Set(["river", "water", "road", "local-road", "dry-river", "rail"]);
const ROUTE_TYPES = new Set(["Clear", "Road", "Rough", "DirtRoad"]);
const RESOURCE_TYPES = new Set(["Clear", "Rough", "Road"]);

type Rgb = [number, number, number];
type TemplateInfo = { type: string; lo: Rgb; hi: Rgb };
const rgb = (hex: string): Rgb => [0, 2, 4].map(k => parseInt(hex.slice(k, k + 2), 16)) as Rgb;
const TEMPLATES = new Map<number, TemplateInfo>(
  Object.entries(terrainData.templates as Record<string, string[]>).map(([id, [type, lo, hi]]) => [Number(id), { type, lo: rgb(lo), hi: rgb(hi) }]),
);
const COLORS = terrainData.colors as Record<string, string>;
const ORE_COLOR = COLORS.Ore ? rgb(COLORS.Ore) : ([150, 128, 96] as Rgb);
const GEM_COLOR = COLORS.Gems ? rgb(COLORS.Gems) : ([150, 128, 96] as Rgb);

function template(id: number): TemplateInfo {
  const info = TEMPLATES.get(id);
  if (!info) throw new Error(`Template ${id} is missing from data/earth-terrain.json; run npm run sync:earth-terrain`);
  return info;
}

const mposToCpos = (u: number, v: number): [number, number] => {
  const off = v & 1;
  return [(v + off) / 2 + u, (v - off) / 2 - u];
};
const cposToMpos = (x: number, y: number): [number, number] => {
  const v = x + y;
  return [(v - (v & 1)) / 2 - y, v];
};
/** Python's float modulo: the result takes the divisor's sign. */
const pyMod = (a: number, m: number) => {
  const r = a % m;
  return r !== 0 && r < 0 !== m < 0 ? r + m : r;
};
/** Python's round(): half to even. */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff !== 0.5) return diff < 0.5 ? f : f + 1;
  return f % 2 === 0 ? f : f + 1;
}
// numpy's hypot is the C runtime's, which on these inputs is sqrt(x*x + y*y) to the last bit.
const hypot = (x: number, y: number) => Math.sqrt(x * x + y * y);
const PY_WHITESPACE = new Set(
  "\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0                　",
);

/** Python's re.sub(r'[\r\n:]', ' ', title)[:80].strip() (code points, Python whitespace), plus "#" for MiniYaml. */
export function sanitizeTitle(raw: unknown): string {
  const chars = Array.from(String(raw ?? DEFAULT_TITLE).replace(/[\r\n:#]/g, " ")).slice(0, 80);
  let start = 0;
  let end = chars.length;
  while (start < end && PY_WHITESPACE.has(chars[start])) start++;
  while (end > start && PY_WHITESPACE.has(chars[end - 1])) end--;
  return chars.slice(start, end).join("") || DEFAULT_TITLE;
}

/** The corner grid of MapBuilder: corner (X, Y) in CPos space at plane point px = X - Y, py = (X + Y) / 2. */
class Corners {
  readonly x0: number;
  readonly y0: number;
  readonly cx: number;
  readonly cy: number;
  readonly cls: Uint8Array;
  readonly w: number;
  readonly h: number;
  private readonly xMax: number;
  private readonly yMax: number;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let u = 0; u < w; u++)
      for (let v = 0; v < h; v++) {
        const [x, y] = mposToCpos(u, v);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    this.x0 = x0;
    this.y0 = y0;
    this.cx = x1 - x0 + 2;
    this.cy = y1 - y0 + 2;
    this.xMax = x0 + this.cx - 1;
    this.yMax = y0 + this.cy - 1;
    this.cls = new Uint8Array(this.cx * this.cy);
  }

  /** Rows of constant py are rows of constant s = X + Y (py = s / 2) inside the grid. */
  rowRange(sLo: number, sHi: number): [number, number] {
    return [Math.max(sLo, this.x0 + this.y0), Math.min(sHi, this.xMax + this.yMax)];
  }

  /** The X range of row s whose px = 2X - s lies in [pxLo, pxHi], clipped to the grid. */
  columns(s: number, pxLo: number, pxHi: number): [number, number] {
    return [Math.max(this.x0, s - this.yMax, Math.ceil((pxLo + s) / 2)), Math.min(this.xMax, s - this.y0, Math.floor((pxHi + s) / 2))];
  }

  index(X: number, s: number): number {
    return (s - X - this.y0) * this.cx + (X - this.x0);
  }

  /** Visit every corner with px in [pxLo, pxHi] and py in [pyLo, pyHi] (a superset of what the caller tests). */
  forBox(pxLo: number, pxHi: number, pyLo: number, pyHi: number, visit: (index: number, px: number, py: number) => void) {
    const [sLo, sHi] = this.rowRange(Math.ceil(2 * pyLo), Math.floor(2 * pyHi));
    for (let s = sLo; s <= sHi; s++) {
      const py = s / 2;
      const [xLo, xHi] = this.columns(s, pxLo, pxHi);
      for (let X = xLo; X <= xHi; X++) visit(this.index(X, s), 2 * X - s, py);
    }
  }

  forAll(visit: (index: number, px: number, py: number) => void) {
    this.forBox(-Infinity, Infinity, -Infinity, Infinity, visit);
  }

  /** mb.paint(np.hypot((px - c0) / 2, py - c1) < radius, cls) */
  disc(c0: number, c1: number, radius: number, cls: number) {
    const cells = this.cls;
    this.forBox(c0 - 2 * radius - 1, c0 + 2 * radius + 1, c1 - radius - 1, c1 + radius + 1, (index, px, py) => {
      if (hypot((px - c0) / 2, py - c1) < radius) cells[index] = cls;
    });
  }

  /** The seg_dist(P, a, b) < width part of poly_dist(P, verts) < width, for one segment. */
  segment(ax: number, ay: number, bx: number, by: number, width: number, cls: number) {
    const abx = bx - ax;
    const aby = by - ay;
    const den = abx * abx + aby * aby;
    const m = width + 1;
    const cells = this.cls;
    this.forBox(Math.min(ax, bx) - m, Math.max(ax, bx) + m, Math.min(ay, by) - m, Math.max(ay, by) + m, (index, px, py) => {
      let t = ((px - ax) * abx + (py - ay) * aby) / den;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (hypot(px - (ax + t * abx), py - (ay + t * aby)) < width) cells[index] = cls;
    });
  }

  /** mb.paint(poly_dist(P, verts) < width, cls): segments shorter than 1e-6 are skipped, as in poly_dist. */
  polyline(xs: ArrayLike<number>, ys: ArrayLike<number>, width: number, cls: number) {
    for (let k = 0; k + 1 < xs.length; k++) {
      if (hypot(xs[k + 1] - xs[k], ys[k + 1] - ys[k]) > 1e-6) this.segment(xs[k], ys[k], xs[k + 1], ys[k + 1], width, cls);
    }
  }

  /**
   * compile_map's even-odd ray cast: a corner is inside when an odd number of edges (a, b), b the next vertex with
   * wrap-around and |b.y - a.y| >= 1e-9, satisfy (a.y > py) != (b.y > py) and px < (b.x - a.x)(py - a.y)/(b.y - a.y) + a.x.
   * The crossings depend on py alone, so they are computed once per row of constant py and counted per corner.
   */
  polygon(xs: ArrayLike<number>, ys: ArrayLike<number>, cls: number) {
    const n = xs.length;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < n; k++) {
      minY = Math.min(minY, ys[k]);
      maxY = Math.max(maxY, ys[k]);
    }
    // A crossing needs lo <= py < hi for the edge's lo/hi, so s = 2py runs from ceil(2 lo) to ceil(2 hi) - 1.
    const [sLo, sHi] = this.rowRange(Math.ceil(2 * minY), Math.ceil(2 * maxY) - 1);
    if (!(sLo <= sHi)) return;
    const rows: number[][] = Array.from({ length: sHi - sLo + 1 }, () => []);
    for (let k = 0; k < n; k++) {
      const ax = xs[k];
      const ay = ys[k];
      const bx = xs[(k + 1) % n];
      const by = ys[(k + 1) % n];
      if (Math.abs(by - ay) < 1e-9) continue;
      const lo = Math.min(ay, by);
      const hi = Math.max(ay, by);
      const r0 = Math.max(sLo, Math.ceil(2 * lo));
      const r1 = Math.min(sHi, Math.ceil(2 * hi) - 1);
      for (let s = r0; s <= r1; s++) {
        const py = s / 2;
        if (ay > py !== by > py) rows[s - sLo].push(((bx - ax) * (py - ay)) / (by - ay) + ax);
      }
    }
    const cells = this.cls;
    for (let s = sLo; s <= sHi; s++) {
      const crossings = rows[s - sLo];
      const count = crossings.length;
      if (!count) continue;
      crossings.sort((a, b) => a - b);
      // Left of every crossing a corner is toggled `count` times: never inside when count is even (always, unless
      // an edge was skipped as flat while still crossing), so start just left of the first crossing then.
      const [xLo, xHi] = this.columns(s, count % 2 ? -Infinity : Math.floor(crossings[0]) - 1, Math.ceil(crossings[count - 1]) + 1);
      let passed = 0;
      for (let X = xLo; X <= xHi; X++) {
        const px = 2 * X - s;
        while (passed < count && crossings[passed] <= px) passed++;
        if ((count - passed) % 2) cells[this.index(X, s)] = cls;
      }
    }
  }

  /** MapBuilder.tiles(): template id per MPos cell (index u * h + v) from its corners tl, tr, br, bl. */
  tiles(): Uint16Array {
    const { w, h, cx, cls } = this;
    const out = new Uint16Array(w * h);
    for (let u = 0; u < w; u++)
      for (let v = 0; v < h; v++) {
        const [x, y] = mposToCpos(u, v);
        const i = x - this.x0;
        const j = y - this.y0;
        const corners = [cls[j * cx + i], cls[j * cx + i + 1], cls[(j + 1) * cx + i + 1], cls[(j + 1) * cx + i]];
        const c = PRIORITY.find(p => corners.includes(p));
        if (c === undefined) continue; // GRASS = template 0
        let mask = 0;
        for (let k = 0; k < 4; k++) if (corners[k] === c) mask |= 1 << k;
        out[u * h + v] = 1000 + SET_INDEX[c] * 16 + mask;
      }
    return out;
  }
}

// Road directions whose edges come out straight on the corner-transition templates (CLEAN in standalone-maps.py).
const CLEAN: [number, number][] = [
  [1, 0],
  [1, 0.5],
  [0, 1],
  [-1, 0.5],
  [-1, 0],
  [-1, -0.5],
  [0, -1],
  [1, -0.5],
].map(([x, y]) => [x / hypot(x, y), y / hypot(x, y)]);
const TAU = 2 * Math.PI;
const CLEAN_ANGLES = CLEAN.map(([x, y]) => pyMod(Math.atan2(y, x), TAU));

/** np.linalg.solve for 2x2 as LAPACK dgesv does it (partial pivoting), so the results match numpy bit for bit. */
function solve2(a00: number, a01: number, a10: number, a11: number, b0: number, b1: number): [number, number] {
  if (Math.abs(a10) > Math.abs(a00)) [a00, a01, a10, a11, b0, b1] = [a10, a11, a00, a01, b1, b0];
  const l = a10 * (1 / a00);
  const u11 = a11 - l * a01;
  const x1 = (b1 - l * b0) / u11;
  return [(b0 - a01 * x1) / a00, x1];
}

/** clean_path(a, b): the Z from a to b along CLEAN directions, as its vertices [a, p1, p2, b]. */
function cleanPath(a: [number, number], b: [number, number]): [number, number][] {
  const v0 = b[0] - a[0];
  const v1 = b[1] - a[1];
  const t = pyMod(Math.atan2(v1, v0), TAU);
  let d1 = CLEAN[0];
  let d2 = CLEAN[1];
  for (let i = 0; i < CLEAN.length; i++) {
    const lo = CLEAN_ANGLES[i];
    const span = pyMod(CLEAN_ANGLES[(i + 1) % CLEAN.length] - lo, TAU);
    if (pyMod(t - lo, TAU) <= span + 1e-9) {
      d1 = CLEAN[i];
      d2 = CLEAN[(i + 1) % CLEAN.length];
      break;
    }
  }
  const [k1, k2] = solve2(d1[0], d2[0], d1[1], d2[1], v0, v1);
  const [major, kM, minor, km] = k1 >= k2 ? [d1, k1, d2, k2] : [d2, k2, d1, k1];
  const p1: [number, number] = [a[0] + (minor[0] * km) / 2, a[1] + (minor[1] * km) / 2];
  const p2: [number, number] = [p1[0] + major[0] * kM, p1[1] + major[1] * kM];
  return [a, p1, p2, b];
}

/** cell_at(): CPos of the cell whose centre is nearest to plane point p (numpy round: half to even). */
function cellAt(p: [number, number]): [number, number] {
  const s = 2 * p[1] - 1;
  return [roundHalfEven((p[0] + s) / 2), roundHalfEven((s - p[0]) / 2)];
}

type Resources = Map<string, { x: number; y: number; type: number; density: number }>;

/** field(): a resource disc of the given type around a plane point; later fields overwrite earlier cells. */
function field(resources: Resources, centre: [number, number], radius: number, type: number) {
  const [cx, cy] = cellAt(centre);
  const r = Math.ceil(radius * 1.6);
  for (let x = cx - r; x <= cx + r; x++)
    for (let y = cy - r; y <= cy + r; y++) {
      const d = hypot(x - y - centre[0], (x + y + 1) / 2 - centre[1]);
      if (d < radius) resources.set(`${x},${y}`, { x, y, type, density: Math.max(1, Math.min(12, roundHalfEven(12 * (1 - d / radius) + 2))) });
    }
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** smooth_noise(px, py, seed, scale) > threshold, with a seeded JS generator in place of numpy's. */
function paintNoise(grid: Corners, seed: number, scale: number, threshold: number, cls: number) {
  const random = mulberry32(seed);
  const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(TAU * random());
  const waves = Array.from({ length: 5 }, (_, k) => {
    const w0 = (normal() * (k + 1)) / scale;
    const w1 = (normal() * (k + 1)) / scale;
    return { w0, w1, phase: random() * 6.3, k };
  });
  const cells = grid.cls;
  grid.forAll((index, px, py) => {
    let s = 0;
    for (const { w0, w1, phase, k } of waves) s += Math.sin(px * w0 + py * w1 + phase) / (k + 1);
    if (s / 2.3 > threshold) cells[index] = cls;
  });
}

/**
 * The route check of compile_map: each seat starts on the legal cell nearest its home (first in u-major order on
 * ties) and every start must be reachable from the first through cardinal MPos neighbours. `legal` is indexed
 * u * h + v. Returns the starts (MPos) and the number of reachable cells; throws when the bases are disconnected.
 */
export function connectBases(legal: Uint8Array, w: number, h: number, homes: [number, number][]) {
  const starts = homes.map(([hu, hv]) => {
    let best = -1;
    let bestDistance = Infinity;
    for (let u = 0; u < w; u++)
      for (let v = 0; v < h; v++) {
        if (!legal[u * h + v]) continue;
        const d = (u - hu) ** 2 + (v - hv) ** 2;
        if (d < bestDistance) {
          bestDistance = d;
          best = u * h + v;
        }
      }
    if (best < 0) throw new Error(DISCONNECTED);
    return best;
  });
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  seen[starts[0]] = 1;
  queue[tail++] = starts[0];
  while (head < tail) {
    const cell = queue[head++];
    const u = Math.floor(cell / h);
    const v = cell % h;
    for (const [nu, nv] of [[u - 1, v], [u + 1, v], [u, v - 1], [u, v + 1]]) {
      if (nu < 0 || nu >= w || nv < 0 || nv >= h) continue;
      const next = nu * h + nv;
      if (!seen[next] && legal[next]) {
        seen[next] = 1;
        queue[tail++] = next;
      }
    }
  }
  if (starts.some(start => !seen[start])) throw new Error(DISCONNECTED);
  return { starts: starts.map(cell => [Math.floor(cell / h), cell % h] as [number, number]), reachable: tail };
}

// ------------------------------------------------------------------------------------------------ outputs
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A minimal RGBA PNG: IHDR, one IDAT (filter 0 scanlines, zlib), IEND. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const chunks: [string, Uint8Array][] = [["IHDR", header], ["IDAT", zlibSync(raw, { level: 9 })], ["IEND", new Uint8Array(0)]];
  const out = new Uint8Array(8 + chunks.reduce((sum, [, data]) => sum + 12 + data.length, 0));
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const outView = new DataView(out.buffer);
  let at = 8;
  for (const [type, data] of chunks) {
    outView.setUint32(at, data.length);
    const body = new Uint8Array(4 + data.length);
    for (let k = 0; k < 4; k++) body[k] = type.charCodeAt(k);
    body.set(data, 4);
    out.set(body, at + 4);
    outView.setUint32(at + 8 + data.length, crc32(body));
    at += 12 + data.length;
  }
  return out;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
}

const ADAPTATIONS = [
  "Flat terrain; land cover simplified to project terrain.",
  "Base zones cleared, ground corridors added, balanced home ore supplied.",
  "Building footprints become rough ground; no real buildings or elevation are reproduced.",
  "Open coastlines are shown in evidence but do not infer an unbounded sea polygon.",
];

/** Compile OpenStreetMap evidence into an isometric OpenRA map for the rtsai mod (compile_map in Python). */
export async function compileBattlefield(
  request: BattlefieldRequest,
  features: EarthEvidence[],
  options: { noise?: boolean } = {},
): Promise<Battlefield> {
  const lat = Number(request.latitude);
  const lon = Number(request.longitude);
  // Python's int() truncates.
  const radius = Math.trunc(Number(request.radius ?? 2500));
  const seed = Math.trunc(Number(request.seed ?? 42));
  const size = Math.trunc(Number(request.size ?? 64));
  const seats = Math.trunc(Number(request.players ?? 2));
  if (
    !(lat >= -85 && lat <= 85 && lon >= -180 && lon <= 180 && radius >= 500 && radius <= 10000) ||
    ![48, 64, 80].includes(size) ||
    ![2, 4].includes(seats) ||
    !(seed >= 0 && seed <= 2147483647)
  )
    throw new Error(INVALID);
  if (!features?.length) throw new Error("No geographic features were returned; choose another area");
  if (features.length > MAX_FEATURES) throw new Error("This area is too dense; select a smaller radius");
  const title = sanitizeTitle(request.title ?? DEFAULT_TITLE);
  const players = seats as 2 | 4;

  const w = size;
  const h = size * 2;
  const grid = new Corners(w, h);
  if (options.noise !== false) paintNoise(grid, seed, 12, 0.65, ROUGH);

  // North-up evidence fits the same physical square as the isometric MPos rectangle.
  const counts = new Map<string, number>();
  const cosLat = Math.cos(lat * (Math.PI / 180));
  const span = 2 * radius;
  for (const feature of features) {
    const points = feature?.points ?? [];
    const kind = String(feature?.kind ?? "");
    if (points.length < (kind === "building" ? 1 : 2) || points.length > 10000) continue;
    const n = points.length;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const x = (Number(points[k][1]) - lon) * 111320 * cosLat;
      const y = (lat - Number(points[k][0])) * 111320;
      xs[k] = (x / span + 0.5) * size * 2;
      ys[k] = ((y / span + 0.5) * size * 2) / 2;
    }
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    const fill = FILL.get(kind);
    if (fill !== undefined && feature.closed) grid.polygon(xs, ys, fill);
    else if (STROKE.has(kind)) {
      const wet = kind === "river" || kind === "water";
      grid.polyline(xs, ys, wet ? 1.3 : 0.8, wet ? WATER : DIRT);
    } else if (kind === "building") {
      // xy.mean(axis=0): numpy accumulates row by row, then divides.
      let sx = xs[0];
      let sy = ys[0];
      for (let k = 1; k < n; k++) {
        sx += xs[k];
        sy += ys[k];
      }
      grid.disc(sx / n, sy / n, 0.8, ROUGH);
    }
  }

  const homes: [number, number][] = [
    [Math.trunc(size * 0.23), Math.trunc(size * 0.65)],
    [Math.trunc(size * 0.77), Math.trunc(size * 1.35)],
  ];
  if (seats === 4) homes.push([Math.trunc(size * 0.77), Math.trunc(size * 0.65)], [Math.trunc(size * 0.23), Math.trunc(size * 1.35)]);
  const homeP = homes.map(([u, v]) => [2 * u, v / 2] as [number, number]);
  const center: [number, number] = [size, size / 2];
  for (const home of homeP) {
    grid.disc(home[0], home[1], 9, GRASS);
    const path = cleanPath(home, center);
    grid.polyline(path.map(p => p[0]), path.map(p => p[1]), 2.1, DIRT);
  }
  // Keep border corners on land: avoids half-water cells outside bounds.
  grid.forAll((index, px, py) => {
    if (px < 3 || px > size * 2 - 3 || py < 2 || py > size - 2) grid.cls[index] = GRASS;
  });
  const resources: Resources = new Map();
  const mines: [number, number][] = [];
  for (const home of homeP)
    for (const [ox, oy] of [[10, -5], [-10, 5]]) {
      const point: [number, number] = [home[0] + ox, home[1] + oy];
      grid.disc(point[0], point[1], 5, GRASS);
      field(resources, point, 4.0, 1);
      mines.push(cellAt(point));
    }
  field(resources, center, 3.5, 2);

  const tiles = grid.tiles();
  const legal = new Uint8Array(w * h);
  for (let u = 1; u < w - 1; u++) for (let v = 1; v < h - 1; v++) legal[u * h + v] = ROUTE_TYPES.has(template(tiles[u * h + v]).type) ? 1 : 0;
  // Validate conservatively against the actual tile classes after transitions.
  const { starts, reachable } = connectBases(legal, w, h, homes);

  // write_map(): a mine is a building, so no ore under it; resources only on Clear/Rough/Road cells in bounds.
  for (const [x, y] of mines) resources.delete(`${x},${y}`);
  const res = new Map<number, { type: number; density: number }>();
  for (const { x, y, type, density } of resources.values()) {
    const [u, v] = cposToMpos(x, y);
    if (!(u >= 1 && u < w - 1 && v >= 1 && v < h - 1)) continue;
    if (RESOURCE_TYPES.has(template(tiles[u * h + v]).type)) res.set(u * h + v, { type, density });
  }

  const area = w * h;
  const bin = new Uint8Array(17 + area * 6);
  const view = new DataView(bin.buffer);
  view.setUint8(0, 2);
  view.setUint16(1, w, true);
  view.setUint16(3, h, true);
  view.setUint32(5, 17, true);
  view.setUint32(9, 17 + area * 3, true);
  view.setUint32(13, 17 + area * 4, true);
  for (let i = 0; i < area; i++) {
    view.setUint16(17 + i * 3, tiles[i], true); // template index byte stays 0; the height layer stays zero
    const r = res.get(i);
    if (r) {
      bin[17 + area * 4 + i * 2] = r.type;
      bin[17 + area * 4 + i * 2 + 1] = r.density;
    }
  }

  let playerRefs =
    "\tPlayerReference@Neutral:\n\t\tName: Neutral\n\t\tOwnsWorld: True\n\t\tNonCombatant: True\n\t\tFaction: china\n" +
    "\tPlayerReference@Creeps:\n\t\tName: Creeps\n\t\tNonCombatant: True\n\t\tFaction: china\n\t\tEnemies: Multi0, Multi1\n";
  for (let k = 0; k < 2; k++) playerRefs += `\tPlayerReference@Multi${k}:\n\t\tName: Multi${k}\n\t\tPlayable: True\n\t\tFaction: Random\n\t\tEnemies: Creeps\n`;
  const spawns = starts.map(([u, v]) => mposToCpos(u, v));
  const actors =
    spawns.map(([x, y], k) => `\tSpawn${k}: mpspawn\n\t\tOwner: Neutral\n\t\tLocation: ${x},${y}\n`).join("") +
    mines.map(([x, y], k) => `\tMine${k}: oremine\n\t\tOwner: Neutral\n\t\tLocation: ${x},${y}\n`).join("");
  let yaml =
    `MapFormat: 12\n\nRequiresMod: rtsai\n\nTitle: ${title}\n\nAuthor: RTS AI (generated by tools/standalone-maps.py)\n\n` +
    `Tileset: TEMPERATE\n\nMapSize: ${w},${h}\n\nBounds: 1,1,${w - 2},${h - 2}\n\nVisibility: Lobby\n\nCategories: Conquest\n\n` +
    `Players:\n${playerRefs}\nActors:\n${actors}`;
  if (seats === 4) {
    // compile_map extends write_map's two player definitions.
    let extra = "";
    for (const k of [2, 3]) extra += `\tPlayerReference@Multi${k}:\n\t\tName: Multi${k}\n\t\tPlayable: True\n\t\tFaction: Random\n\t\tEnemies: Creeps\n`;
    yaml = yaml
      .split("\nActors:")
      .join("\n" + extra + "\nActors:")
      .split("Enemies: Multi0, Multi1")
      .join("Enemies: Multi0, Multi1, Multi2, Multi3");
  }
  yaml = yaml.split("Author: RTS AI (generated by tools/standalone-maps.py)").join("Author: RTS AI; geography © OpenStreetMap contributors (ODbL)");

  // Preview, as Map.SavePreview draws it: two pixels per cell, odd rows shifted right by one; unset pixels transparent.
  const bw = 2 * (w - 2) - 1;
  const bh = h - 2;
  const pixels = new Uint8Array(bw * bh * 4);
  const put = (x: number, y: number, [r, g, b]: Rgb) => pixels.set([r, g, b, 255], (y * bw + x) * 4);
  for (let yy = 0; yy < bh; yy++)
    for (let xx = 0; xx < w - 2; xx++) {
      const u = xx + 1;
      const v = yy + 1;
      const resource = res.get(u * h + v);
      let left: Rgb;
      let right: Rgb;
      if (resource) left = right = resource.type === 1 ? ORE_COLOR : GEM_COLOR;
      else ({ lo: left, hi: right } = template(tiles[u * h + v]));
      const dx = v & 1;
      const xo = 2 * xx + dx;
      if (xx + dx > 0) put(xo - 1, yy, left);
      if (xo < bw) put(xo, yy, right);
    }
  const png = encodePng(bw, bh, pixels);

  const yamlBytes = strToU8(yaml);
  const identity = new Uint8Array(yamlBytes.length + bin.length);
  identity.set(yamlBytes);
  identity.set(bin, yamlBytes.length);
  const id = `earth-${(await sha256Hex(identity)).slice(0, 16)}`;
  const report: BattlefieldReport = {
    id,
    title,
    players,
    seed,
    latitude: lat,
    longitude: lon,
    radius,
    size,
    features: Object.fromEntries(counts),
    source: "OpenStreetMap",
    license: "ODbL-1.0",
    attribution: "© OpenStreetMap contributors",
    sourceStatus: request.sourceStatus ?? "Preserved geographic evidence",
    validation: { connectedBases: true, clearBaseZones: true, homeMines: mines.length, reachableCells: reachable },
    adaptations: [...ADAPTATIONS],
  };
  // A fixed local timestamp keeps the package bytes reproducible (zip stores local DOS time).
  const oramap = zipSync(
    { "map.yaml": yamlBytes, "map.bin": bin, "map.png": png, "earth.json": strToU8(JSON.stringify(report, null, 2)) },
    { level: 9, mtime: new Date(1980, 0, 1) },
  );
  return { id, title, players, size, width: w, height: h, yaml, bin, png, report, oramap };
}
