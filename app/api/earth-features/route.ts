import type { EarthFeature } from "../../../lib/oramap";
import { verifyFirebaseRequest } from "../../../lib/firebase-token";
import {
  MAX_EVIDENCE_FEATURES,
  MAX_TERRAIN_RESPONSE_CHARS,
  TOO_DENSE,
  overpassFailure,
  terrainFeatures,
  terrainQuery,
  type OverpassPayload,
} from "../../../lib/earth-evidence";

const overpassEndpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;

// { detail: "terrain" } asks for the full battlefield evidence (lib/earth-evidence.ts) instead of water and roads.
type EarthRequest = { latitude?: number; longitude?: number; radiusM?: number; detail?: string };
type RoadsAndWater = {
  elements?: Array<{
    tags?: Record<string, string>;
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
};

class TooDense extends Error {}

export async function POST(request: Request) {
  let input: EarthRequest;
  try {
    input = (await request.json()) as EarthRequest;
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const latitude = Number(input.latitude);
  const longitude = Number(input.longitude);
  const radiusM = Math.round(Number(input.radiusM));
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(radiusM) || radiusM < 500 || radiusM > 12000)
    return Response.json({ error: "Invalid Earth selection" }, { status: 400 });

  const userId = await verifyFirebaseRequest(request);
  if (!userId) return Response.json({ error: "Sign in required" }, { status: 401 });

  const terrain = input.detail === "terrain";
  const query = terrain
    ? terrainQuery(latitude, longitude, radiusM, 25)
    : `[out:json][timeout:10];(
way(around:${radiusM},${latitude},${longitude})[natural~"water|coastline|bay"];
way(around:${radiusM},${latitude},${longitude})[waterway];
way(around:${radiusM},${latitude},${longitude})[highway~"motorway|trunk|primary|secondary|tertiary"];
);out tags geom;`;

  async function queryEndpoint(endpoint: string): Promise<OverpassPayload | RoadsAndWater> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), terrain ? 27_000 : 12_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "RTS-AI/1.0 (https://rtsai.net)",
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
      if (!terrain) return (await response.json()) as RoadsAndWater;
      const text = await response.text();
      if (text.length > MAX_TERRAIN_RESPONSE_CHARS) throw new TooDense();
      const payload = JSON.parse(text) as OverpassPayload;
      // Overpass reports timeouts and memory exhaustion in a remark next to partial (unusable) results.
      const failure = overpassFailure(payload);
      if (failure === "dense") throw new TooDense();
      if (failure) throw new Error(`Overpass failed: ${payload.remark}`);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }

  if (terrain) {
    let payload: OverpassPayload;
    try {
      payload = (await Promise.any(overpassEndpoints.map(queryEndpoint))) as OverpassPayload;
    } catch (error) {
      if (error instanceof AggregateError && error.errors.some(reason => reason instanceof TooDense))
        return Response.json({ error: TOO_DENSE }, { status: 413 });
      return Response.json({ error: "Earth data is temporarily unavailable" }, { status: 503 });
    }
    const features = terrainFeatures(payload);
    if (features.length > MAX_EVIDENCE_FEATURES) return Response.json({ error: TOO_DENSE }, { status: 413 });
    return Response.json(
      { features, provider: "OpenStreetMap / Overpass", featureCount: features.length },
      { headers: { "Cache-Control": "private, max-age=900" } },
    );
  }

  try {
    // Race independent community mirrors so an overloaded provider does not
    // stall the entire in-game generation experience.
    const payload = (await Promise.any(overpassEndpoints.map(queryEndpoint))) as RoadsAndWater;
    const features: EarthFeature[] = (payload.elements ?? []).flatMap((element) => {
      const tags = element.tags ?? {};
      const geometry = element.geometry ?? [];
      if (geometry.length < 2) return [];
      const kind = tags.highway ? "road" : tags.waterway || tags.natural ? "water" : null;
      return kind ? [{ kind, points: geometry.map((point) => [point.lat, point.lon] as [number, number]) }] : [];
    });
    return Response.json(
      { features, provider: "OpenStreetMap / Overpass", featureCount: features.length },
      { headers: { "Cache-Control": "private, max-age=900" } },
    );
  } catch {
    return Response.json({ error: "Earth data is temporarily unavailable" }, { status: 503 });
  }
}
