// OpenStreetMap evidence for Earth battlefields (lib/earth-battlefield.ts), as /api/earth-features returns it for
// { detail: "terrain" }. The query's bounding box and tag set and the classification follow the desktop map workshop
// (RTSAI-WebGame server/map-workshop.mjs acquire() and classify()); buildings come back as one centre point each,
// from a separate `out tags center` statement, which keeps the response small.
import type { EarthEvidence, EarthKind } from "./earth-battlefield";

export const MAX_EVIDENCE_FEATURES = 12000;
export const MAX_BUILDINGS = 6000;
export const MAX_TERRAIN_RESPONSE_CHARS = 20_000_000;
export const TOO_DENSE = "This area is too dense; choose a smaller footprint.";

type OverpassPoint = { lat?: number; lon?: number } | null;
export type OverpassElement = {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  geometry?: OverpassPoint[];
  center?: OverpassPoint;
  /** A relation's members, each way with its geometry (`out geom`). */
  members?: { type?: string; role?: string; geometry?: OverpassPoint[] }[];
};
export type OverpassPayload = { elements?: OverpassElement[]; remark?: string };

/** map-workshop.mjs classify(): the battlefield kind of an OpenStreetMap way, or null to ignore it. */
export function classifyTerrain(t: Record<string, string>): EarthKind | null {
  if (t.natural === "water" || t.natural === "bay") return "water";
  if (t.natural === "coastline") return "coastline";
  if (t.waterway) return t.intermittent === "yes" ? "dry-river" : "river";
  if (t.highway) return ["motorway", "trunk", "primary", "secondary"].includes(t.highway) ? "road" : "local-road";
  if (t.building) return "building";
  if (t.railway) return "rail";
  if (["wood", "scrub", "grassland"].includes(t.natural) || ["forest", "meadow", "orchard"].includes(t.landuse) || t.leisure) return "forest";
  if (["sand", "beach", "dune"].includes(t.natural)) return "sand";
  if (["bare_rock", "scree", "cliff"].includes(t.natural) || t.landuse === "quarry") return "rough";
  if (t.landuse) return "urban";
  return null;
}

/** The area a terrain query covers (map-workshop's bounding box): south, west, north, east in degrees. */
export type TerrainBox = { s: number; w: number; n: number; e: number };
export function terrainBox(latitude: number, longitude: number, radiusM: number): TerrainBox {
  const dy = radiusM / 111320;
  const dx = dy / Math.max(0.15, Math.cos((latitude * Math.PI) / 180));
  return { s: latitude - dy, w: longitude - dx, n: latitude + dy, e: longitude + dx };
}

/** Multipolygon relations up to this many members are read (a lake, a forest); bigger ones are country-sized. */
const MAX_RELATION_MEMBERS = 2000;

/**
 * The Overpass query: map-workshop's bounding box and tags, with buildings as centres in a second statement. Lakes,
 * forests and sands mapped as multipolygon relations (Lake Timsah) come with the ways, their members' geometry included.
 */
export function terrainQuery(latitude: number, longitude: number, radiusM: number, timeoutS = 25): string {
  const b = terrainBox(latitude, longitude, radiusM);
  const box = [b.s, b.w, b.n, b.e].join(",");
  const small = `(if:count_members()<${MAX_RELATION_MEMBERS})`;
  return (
    `[out:json][timeout:${timeoutS}];(` +
    `way(${box})[natural~"water|bay|coastline|wood|scrub|sand|beach|bare_rock|cliff"];` +
    `way(${box})[waterway];` +
    `way(${box})[highway~"motorway|trunk|primary|secondary|tertiary|residential"];` +
    `way(${box})[landuse];` +
    `way(${box})[leisure~"park|garden|nature_reserve"];` +
    `relation(${box})[type=multipolygon][natural~"water|bay|wood|scrub|sand|beach|bare_rock"]${small};` +
    `relation(${box})[type=multipolygon][landuse~"forest|meadow|orchard|quarry|reservoir|basin"]${small};` +
    `);out tags geom;` +
    `way(${box})[building];out tags center;`
  );
}

/** "dense" when Overpass ran out of memory, "failed" on another runtime error (its partial output is unusable). */
export function overpassFailure(payload: OverpassPayload): "dense" | "failed" | null {
  const remark = payload.remark ?? "";
  if (!/runtime error/i.test(remark)) return null;
  return /out of memory/i.test(remark) ? "dense" : "failed";
}

const round5 = (value: number) => Math.round(value * 1e5) / 1e5;
const coordinate = (point: OverpassPoint): [number, number] | null =>
  point && Number.isFinite(point.lat) && Number.isFinite(point.lon) ? [round5(point.lat!), round5(point.lon!)] : null;

// ------------------------------------------------------------------------------------------------ areas
// The compiler paints closed polygons; two kinds of OpenStreetMap area arrive in pieces and are assembled here.
//   Coastlines: the sea has no polygon. Coastline ways run with the land on their left (the Suez Canal's banks, a
//   bay's shore), so each run of coastline through the box, closed along the box's edge to the next run, bounds sea.
//   Multipolygon relations: a lake's outer ring is split over member ways, joined here end to end.
type LatLon = [number, number];
const MAX_AREA_POINTS = 4000;
const same = (a: LatLon, b: LatLon) => a[0] === b[0] && a[1] === b[1];

/** Joins lines that share end points into longer ones (closed rings where they close); `flip` lets a line reverse. */
function joinLines(lines: LatLon[][], flip: boolean): LatLon[][] {
  const pool = lines.filter(line => line.length > 1).map(line => [...line]);
  const joined: LatLon[][] = [];
  while (pool.length) {
    let chain = pool.pop()!;
    for (let grew = true; grew && !same(chain[0], chain[chain.length - 1]); ) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const line = pool[i];
        const head = chain[0];
        const tail = chain[chain.length - 1];
        if (same(tail, line[0])) chain = chain.concat(line.slice(1));
        else if (same(line[line.length - 1], head)) chain = line.concat(chain.slice(1));
        else if (flip && same(tail, line[line.length - 1])) chain = chain.concat([...line].reverse().slice(1));
        else if (flip && same(head, line[0])) chain = [...line].reverse().concat(chain.slice(1));
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    joined.push(chain);
  }
  return joined;
}

const inBox = (p: LatLon, b: TerrainBox) => p[0] >= b.s && p[0] <= b.n && p[1] >= b.w && p[1] <= b.e;
const along = (a: LatLon, c: LatLon, t: number): LatLon => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];

/** The part of segment a-c inside the box (Liang-Barsky), as fractions along it, or null. */
function clipSegment(a: LatLon, c: LatLon, b: TerrainBox): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dLat = c[0] - a[0];
  const dLon = c[1] - a[1];
  for (const [p, q] of [[-dLon, a[1] - b.w], [dLon, b.e - a[1]], [-dLat, a[0] - b.s], [dLat, b.n - a[0]]]) {
    if (p === 0) {
      if (q < 0) return null;
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/** A ring clipped to the box (Sutherland-Hodgman), closed, or [] when nothing of it is inside. */
function clipRing(ring: LatLon[], b: TerrainBox): LatLon[] {
  let points = same(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
  const cut = (a: LatLon, c: LatLon, axis: 0 | 1, v: number) => along(a, c, (v - a[axis]) / (c[axis] - a[axis]));
  const sides: [(p: LatLon) => boolean, 0 | 1, number][] = [
    [p => p[1] >= b.w, 1, b.w],
    [p => p[1] <= b.e, 1, b.e],
    [p => p[0] >= b.s, 0, b.s],
    [p => p[0] <= b.n, 0, b.n],
  ];
  for (const [inside, axis, v] of sides) {
    const next: LatLon[] = [];
    points.forEach((current, i) => {
      const previous = points[(i + points.length - 1) % points.length];
      if (inside(current)) {
        if (!inside(previous)) next.push(cut(previous, current, axis, v));
        next.push(current);
      } else if (inside(previous)) next.push(cut(previous, current, axis, v));
    });
    points = next;
    if (!points.length) return [];
  }
  return points.length >= 3 ? [...points, points[0]] : [];
}

/** Twice the signed area in (lon, lat): positive for a counter-clockwise ring. */
const signedArea = (ring: LatLon[]) =>
  ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p[1] * q[0] - q[1] * p[0];
  }, 0);

/** At most MAX_AREA_POINTS points, by even sampling (the compiler skips longer features); rounded like all evidence. */
function areaPoints(ring: LatLon[]): LatLon[] {
  const rounded = ring.map(([lat, lon]) => [round5(lat), round5(lon)] as LatLon);
  if (rounded.length <= MAX_AREA_POINTS) return rounded;
  const step = (rounded.length - 1) / (MAX_AREA_POINTS - 1);
  const kept = Array.from({ length: MAX_AREA_POINTS - 1 }, (_, k) => rounded[Math.round(k * step)]);
  return [...kept, kept[0]];
}

/** The sea in the box, from the coastline ways that cross it (land on their left), as closed rings. */
export function seaFromCoastlines(coastlines: LatLon[][], b: TerrainBox): LatLon[][] {
  const runs: LatLon[][] = [];
  const seas: LatLon[][] = [];
  for (const chain of joinLines(coastlines, false)) {
    const closed = same(chain[0], chain[chain.length - 1]);
    if (closed && chain.every(p => inBox(p, b))) {
      // A ring of coastline inside the box: clockwise is water; counter-clockwise is an island, left as land.
      if (signedArea(chain) < 0) seas.push(chain);
      continue;
    }
    const pieces: LatLon[][] = [];
    let run: LatLon[] | null = inBox(chain[0], b) ? [chain[0]] : null;
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1];
      const c = chain[i];
      const inside = clipSegment(a, c, b);
      if (!inside) continue;
      if (!run) run = [along(a, c, inside[0])];
      if (inside[1] < 1) {
        run.push(along(a, c, inside[1]));
        pieces.push(run);
        run = null;
      } else run.push(c);
    }
    if (run) {
      // Still inside at the end: a closed chain wraps into its first piece; an open one stops in the box (data
      // missing), and then the sea can't be told from the land.
      if (closed && inBox(chain[0], b) && pieces.length) pieces[0] = run.concat(pieces[0].slice(1));
      else return [];
    }
    runs.push(...pieces);
  }
  if (!runs.length) return seas;

  // Each run enters and leaves on the box's edge. A sea follows a run, then the edge clockwise to the next run's
  // entry, and so on until it is back at the run it started from.
  const W = b.e - b.w;
  const H = b.n - b.s;
  const P = 2 * (W + H);
  const perimeter = ([lat, lon]: LatLon) => {
    const d = [Math.abs(lat - b.n), Math.abs(lon - b.e), Math.abs(lat - b.s), Math.abs(lon - b.w)];
    return [lon - b.w, W + (b.n - lat), W + H + (b.e - lon), 2 * W + H + (lat - b.s)][d.indexOf(Math.min(...d))];
  };
  const corners: [number, LatLon][] = [[0, [b.n, b.w]], [W, [b.n, b.e]], [W + H, [b.s, b.e]], [2 * W + H, [b.s, b.w]]];
  const entry = runs.map(r => perimeter(r[0]));
  const exit = runs.map(r => perimeter(r[r.length - 1]));
  const used = new Set<number>();
  for (let first = 0; first < runs.length; first++) {
    if (used.has(first)) continue;
    const sea: LatLon[] = [];
    for (let i = first, guard = 0; guard <= runs.length; guard++) {
      used.add(i);
      sea.push(...runs[i]);
      let next = first;
      let gap = Infinity;
      runs.forEach((_, j) => {
        const d = (entry[j] - exit[i] + P) % P;
        if (d < gap) [gap, next] = [d, j];
      });
      const passed = corners.map(([s, c]) => [(s - exit[i] + P) % P, c] as [number, LatLon]).filter(([d]) => d > 0 && d < gap);
      for (const [, corner] of passed.sort((x, y) => x[0] - y[0])) sea.push(corner);
      if (next === first || used.has(next)) break;
      i = next;
    }
    if (sea.length >= 3) seas.push([...sea, sea[0]]);
  }
  return seas;
}

/** A multipolygon relation's outer rings, joined from its member ways (and clipped to the box when given). */
function relationRings(element: OverpassElement, b: TerrainBox | undefined): LatLon[][] {
  const lines = (element.members ?? [])
    .filter(m => (m.type ?? "way") === "way" && m.role !== "inner")
    .map(m => (m.geometry ?? []).map(coordinate).filter((p): p is LatLon => p !== null));
  return joinLines(lines, true)
    .filter(ring => ring.length > 3 && same(ring[0], ring[ring.length - 1]))
    .map(ring => (b ? clipRing(ring, b) : ring))
    .filter(ring => ring.length > 3)
    .map(areaPoints);
}

/**
 * Overpass elements -> battlefield evidence: classified, deduplicated (a building-tagged way can match both
 * statements), in way-id order as one union query would return them (so painting order matches the desktop),
 * coordinates rounded to 5 decimals (about a metre), ways with fewer than two points dropped except building centres,
 * and buildings thinned by even sampling to at most MAX_BUILDINGS. Multipolygon relations become their outer rings.
 * Given the query's box, those are clipped to it, and the sea is drawn from the coastlines and painted first.
 */
export function terrainFeatures(payload: OverpassPayload, box?: TerrainBox): EarthEvidence[] {
  const seen = new Set<string>();
  const entries: { id: number; order: number; feature: EarthEvidence }[] = [];
  for (const [order, element] of (payload.elements ?? []).entries()) {
    if (element.id !== undefined) {
      const key = `${element.type ?? "way"}/${element.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const kind = classifyTerrain(element.tags ?? {});
    if (!kind) continue;
    if (element.type === "relation") {
      for (const ring of relationRings(element, box))
        entries.push({ id: element.id ?? Number.MAX_SAFE_INTEGER, order, feature: { kind, closed: true, points: ring } });
      continue;
    }
    const geometry = element.geometry ?? [];
    const raw = geometry.length ? geometry : element.center ? [element.center] : [];
    const points = raw.map(coordinate).filter((p): p is [number, number] => p !== null);
    if (points.length < (kind === "building" ? 1 : 2)) continue;
    const first = geometry[0];
    const last = geometry[geometry.length - 1];
    const closed = geometry.length > 3 && !!first && !!last && first.lat === last.lat && first.lon === last.lon;
    entries.push({ id: element.id ?? Number.MAX_SAFE_INTEGER, order, feature: { kind, closed, points } });
  }
  entries.sort((a, b) => a.id - b.id || a.order - b.order);
  if (box) {
    const coastlines = entries.filter(entry => entry.feature.kind === "coastline").map(entry => entry.feature.points as LatLon[]);
    for (const ring of seaFromCoastlines(coastlines, box).reverse())
      entries.unshift({ id: -1, order: -1, feature: { kind: "water", closed: true, points: areaPoints(ring) } });
  }
  const buildings = entries.filter(entry => entry.feature.kind === "building");
  if (buildings.length > MAX_BUILDINGS) {
    const keep = new Set(Array.from({ length: MAX_BUILDINGS }, (_, k) => buildings[Math.floor((k * buildings.length) / MAX_BUILDINGS)]));
    return entries.filter(entry => entry.feature.kind !== "building" || keep.has(entry)).map(entry => entry.feature);
  }
  return entries.map(entry => entry.feature);
}
