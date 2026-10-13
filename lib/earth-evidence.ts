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

/** The Overpass query: map-workshop's bounding box and tags, with buildings as centres in a second statement. */
export function terrainQuery(latitude: number, longitude: number, radiusM: number, timeoutS = 25): string {
  const dy = radiusM / 111320;
  const dx = dy / Math.max(0.15, Math.cos((latitude * Math.PI) / 180));
  const box = [latitude - dy, longitude - dx, latitude + dy, longitude + dx].join(",");
  return (
    `[out:json][timeout:${timeoutS}];(` +
    `way(${box})[natural~"water|bay|coastline|wood|scrub|sand|beach|bare_rock|cliff"];` +
    `way(${box})[waterway];` +
    `way(${box})[highway~"motorway|trunk|primary|secondary|tertiary|residential"];` +
    `way(${box})[landuse];` +
    `way(${box})[leisure~"park|garden|nature_reserve"];` +
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

/**
 * Overpass elements -> battlefield evidence: classified, deduplicated (a building-tagged way can match both
 * statements), in way-id order as one union query would return them (so painting order matches the desktop),
 * coordinates rounded to 5 decimals (about a metre), ways with fewer than two points dropped except building centres,
 * and buildings thinned by even sampling to at most MAX_BUILDINGS.
 */
export function terrainFeatures(payload: OverpassPayload): EarthEvidence[] {
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
  const buildings = entries.filter(entry => entry.feature.kind === "building");
  if (buildings.length > MAX_BUILDINGS) {
    const keep = new Set(Array.from({ length: MAX_BUILDINGS }, (_, k) => buildings[Math.floor((k * buildings.length) / MAX_BUILDINGS)]));
    return entries.filter(entry => entry.feature.kind !== "building" || keep.has(entry)).map(entry => entry.feature);
  }
  return entries.map(entry => entry.feature);
}
