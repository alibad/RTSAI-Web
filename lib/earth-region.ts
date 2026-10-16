import land from "../data/hormuz-land.json";
import { terrainBox } from "./earth-evidence";
import type { EarthEvidence } from "./earth-battlefield";

/** Packaged public-domain coastlines: available even when public mapping servers fail. */
export function regionalGeography(lat: number, lon: number, radius: number): EarthEvidence[] | null {
  const b = terrainBox(lat, lon, radius), [w, s, e, n] = land.coverage;
  if (b.w < w || b.s < s || b.e > e || b.n > n) return null;
  const features: EarthEvidence[] = [{ kind: "water", closed: true, points: [[b.n, b.w], [b.n, b.e], [b.s, b.e], [b.s, b.w]] }];
  for (const polygon of land.polygons) {
    const outer = polygon[0];
    if (Math.max(...outer.map(p => p[0])) < b.s || Math.min(...outer.map(p => p[0])) > b.n || Math.max(...outer.map(p => p[1])) < b.w || Math.min(...outer.map(p => p[1])) > b.e) continue;
    polygon.forEach((ring, i) => features.push({ kind: i ? "water" : "land", closed: true, points: ring as [number, number][] }));
  }
  return features;
}
