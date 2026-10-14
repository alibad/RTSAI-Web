import assert from "node:assert/strict";
import test from "node:test";
import { POST as earthFeatures } from "../app/api/earth-features/route";
import {
  MAX_BUILDINGS,
  classifyTerrain,
  overpassFailure,
  seaFromCoastlines,
  terrainBox,
  terrainFeatures,
  terrainQuery,
  type OverpassElement,
} from "../lib/earth-evidence";

test("ways are classified as the desktop map workshop classifies them", () => {
  const cases: [Record<string, string>, string | null][] = [
    [{ natural: "water" }, "water"],
    [{ natural: "bay" }, "water"],
    [{ natural: "water", building: "yes" }, "water"],
    [{ natural: "coastline" }, "coastline"],
    [{ waterway: "river" }, "river"],
    [{ waterway: "stream", intermittent: "yes" }, "dry-river"],
    [{ highway: "motorway" }, "road"],
    [{ highway: "secondary" }, "road"],
    [{ highway: "tertiary" }, "local-road"],
    [{ highway: "residential" }, "local-road"],
    [{ building: "yes", landuse: "retail" }, "building"],
    [{ railway: "rail" }, "rail"],
    [{ natural: "wood" }, "forest"],
    [{ natural: "grassland" }, "forest"],
    [{ landuse: "orchard" }, "forest"],
    [{ leisure: "park" }, "forest"],
    [{ natural: "beach" }, "sand"],
    [{ natural: "cliff" }, "rough"],
    [{ landuse: "quarry" }, "rough"],
    [{ landuse: "residential" }, "urban"],
    [{ natural: "tree_row" }, null],
    [{ amenity: "parking" }, null],
  ];
  for (const [tags, kind] of cases) assert.equal(classifyTerrain(tags), kind, JSON.stringify(tags));
});

test("the terrain query covers the workshop's box and tags, with buildings as centres", () => {
  const query = terrainQuery(60, 10, 2226.4);
  const dy = 2226.4 / 111320;
  const dx = dy / Math.cos((60 * Math.PI) / 180);
  const box = [60 - dy, 10 - dx, 60 + dy, 10 + dx].join(",");
  assert.ok(query.startsWith("[out:json][timeout:25];("));
  assert.equal(query.split(`way(${box})`).length - 1, 6);
  for (const tag of ['[natural~"water|bay|coastline|wood|scrub|sand|beach|bare_rock|cliff"]', "[waterway]", '[highway~"motorway|trunk|primary|secondary|tertiary|residential"]', "[landuse]", '[leisure~"park|garden|nature_reserve"]'])
    assert.ok(query.includes(tag), tag);
  assert.ok(query.endsWith(`);out tags geom;way(${box})[building];out tags center;`));
  // Lakes, forests and sands mapped as multipolygon relations, up to a lake's size, with the ways.
  assert.ok(query.includes(`relation(${box})[type=multipolygon][natural~"water|bay|wood|scrub|sand|beach|bare_rock"](if:count_members()<2000);`));
  assert.ok(query.includes(`relation(${box})[type=multipolygon][landuse~"forest|meadow|orchard|quarry|reservoir|basin"](if:count_members()<2000);`));
  assert.deepEqual(terrainBox(60, 10, 2226.4), { s: 60 - dy, w: 10 - dx, n: 60 + dy, e: 10 + dx });
  // Near the poles the box stops widening (cos is clamped at 0.15, as in the workshop).
  assert.ok(terrainQuery(89, 0, 1000).includes(`,${-(1000 / 111320) / 0.15},`));
});

test("Overpass elements become compact, ordered battlefield evidence", () => {
  const ring = [
    { lat: 47.000001, lon: 8.000004 },
    { lat: 47.01, lon: 8 },
    { lat: 47.01, lon: 8.01 },
    { lat: 47.000001, lon: 8.000004 },
  ];
  const elements: OverpassElement[] = [
    { type: "way", id: 30, tags: { natural: "water" }, geometry: ring },
    { type: "way", id: 10, tags: { highway: "primary" }, geometry: [{ lat: 47.123456789, lon: 8.987654321 }, { lat: 47.2, lon: 9 }] },
    { type: "way", id: 11, tags: { highway: "residential" }, geometry: [{ lat: 47.1, lon: 8.1 }] },
    { type: "way", id: 12, tags: { amenity: "parking" }, geometry: ring },
    { type: "way", id: 13, tags: { landuse: "farmland" }, geometry: ring.slice(0, 3) },
    { type: "way", id: 14, tags: { building: "yes", landuse: "retail" }, geometry: ring },
    { type: "way", id: 14, tags: { building: "yes", landuse: "retail" }, center: { lat: 47.005, lon: 8.005 } },
    { type: "way", id: 20, tags: { building: "house" }, center: { lat: 47.0050049, lon: 8.0050051 } },
    { type: "way", id: 21, tags: { building: "house" } },
    { type: "way", id: 22, tags: { waterway: "river" }, geometry: [{ lat: 47.3, lon: 8.3 }, null, { lat: 47.31, lon: 8.31 }] },
  ];
  const features = terrainFeatures({ elements });
  assert.deepEqual(features, [
    { kind: "road", closed: false, points: [[47.12346, 8.98765], [47.2, 9]] },
    { kind: "urban", closed: false, points: [[47, 8], [47.01, 8], [47.01, 8.01]] },
    { kind: "building", closed: true, points: [[47, 8], [47.01, 8], [47.01, 8.01], [47, 8]] },
    { kind: "building", closed: false, points: [[47.005, 8.00501]] },
    { kind: "river", closed: false, points: [[47.3, 8.3], [47.31, 8.31]] },
    { kind: "water", closed: true, points: [[47, 8], [47.01, 8], [47.01, 8.01], [47, 8]] },
  ]);
  assert.deepEqual(terrainFeatures({}), []);
});

test("buildings are thinned evenly to the cap; other evidence is kept", () => {
  const elements: OverpassElement[] = [
    { type: "way", id: 1, tags: { highway: "primary" }, geometry: [{ lat: 1, lon: 1 }, { lat: 1.1, lon: 1.1 }] },
    ...Array.from({ length: MAX_BUILDINGS * 2 + 1 }, (_, k): OverpassElement => ({ type: "way", id: 100 + k, tags: { building: "yes" }, center: { lat: k / 1e4, lon: 0 } })),
    { type: "way", id: 1e9, tags: { waterway: "canal" }, geometry: [{ lat: 2, lon: 2 }, { lat: 2.1, lon: 2.1 }] },
  ];
  const features = terrainFeatures({ elements });
  const buildings = features.filter(f => f.kind === "building");
  assert.equal(buildings.length, MAX_BUILDINGS);
  assert.deepEqual(buildings[0].points, [[0, 0]]);
  assert.deepEqual(buildings[1].points, [[0.0002, 0]], "every other building of twice the cap");
  assert.equal(features[0].kind, "road");
  assert.equal(features.at(-1)!.kind, "river");
  assert.equal(terrainFeatures({ elements: elements.slice(0, MAX_BUILDINGS + 1) }).length, MAX_BUILDINGS + 1);
});

test("Overpass runtime errors are not mistaken for evidence", () => {
  assert.equal(overpassFailure({ elements: [] }), null);
  assert.equal(overpassFailure({ remark: "runtime error: Query timed out in \"query\" at line 1 after 26 seconds." }), "failed");
  assert.equal(overpassFailure({ remark: "runtime error: Query run out of memory using about 2048 MB of RAM." }), "dense");
});

test("terrain evidence keeps the route's validation and sign-in checks", async () => {
  const post = (body: unknown) =>
    earthFeatures(new Request("https://rtsai.net/api/earth-features", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const invalid = await post({ latitude: 24.7, longitude: 46.7, radiusM: 100, detail: "terrain" });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "Invalid Earth selection" });
  const anonymous = await post({ latitude: 24.7, longitude: 46.7, radiusM: 3500, detail: "terrain" });
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: "Sign in required" });
});

// ------------------------------------------------------------------------------------------------ areas
const unit = { s: 0, w: 0, n: 1, e: 1 };
const area = (ring: [number, number][]) => Math.abs(ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[1] * q[0] - q[1] * p[0]; }, 0) / 2);

test("a coastline across the box makes the sea on its right", () => {
  // West to east with the land on the left (north): the south half is sea.
  const [sea] = seaFromCoastlines([[[0.5, -0.5], [0.5, 0.4], [0.5, 1.5]]], unit);
  assert.deepEqual(sea, [[0.5, 0], [0.5, 0.4], [0.5, 1], [0, 1], [0, 0], [0.5, 0]]);
  // The other way round, the land is south and the sea north.
  const [north] = seaFromCoastlines([[[0.5, 1.5], [0.5, -0.5]]], unit);
  assert.ok(north.every(([lat]) => lat >= 0.5) && Math.abs(area(north) - 0.5) < 1e-9);
});

test("a canal mapped as coastline (the Suez Canal) is the water between its banks", () => {
  // The west bank runs north (Africa on its left), the east bank south (Sinai on its left); each is split in two ways.
  const west: [number, number][][] = [[[-0.5, 0.4], [0.5, 0.4]], [[0.5, 0.4], [1.5, 0.4]]];
  const east: [number, number][][] = [[[1.5, 0.6], [0.3, 0.6]], [[0.3, 0.6], [-0.5, 0.6]]];
  const seas = seaFromCoastlines([...east, ...west], unit);
  assert.equal(seas.length, 1);
  assert.ok(Math.abs(area(seas[0]) - 0.2) < 1e-9, "the strip between the banks");
  assert.ok(seas[0].every(([, lon]) => lon >= 0.4 - 1e-9 && lon <= 0.6 + 1e-9));
});

test("islands stay land, and a coastline that stops inside the box adds no sea", () => {
  // A counter-clockwise ring (land on the left, inside) is an island.
  assert.deepEqual(seaFromCoastlines([[[0.4, 0.4], [0.4, 0.6], [0.6, 0.6], [0.6, 0.4], [0.4, 0.4]]], unit), []);
  // Missing data: the coast ends in the box, so which side is sea is unknown.
  assert.deepEqual(seaFromCoastlines([[[0.5, -0.5], [0.5, 0.5]]], unit), []);
});

test("multipolygon relations become their outer rings, joined and clipped; coastline seas come first", () => {
  const p = (lat: number, lon: number) => ({ lat, lon });
  const elements: OverpassElement[] = [
    { type: "way", id: 7, tags: { highway: "primary" }, geometry: [p(0.1, 0.1), p(0.9, 0.9)] },
    {
      type: "relation", id: 5809452, tags: { type: "multipolygon", natural: "water" },
      members: [
        // Lake Timsah's outer ring in two ways, the second reversed, half of it outside the box; an island inside.
        { type: "way", role: "outer", geometry: [p(0.2, 0.2), p(0.2, 1.4), p(0.6, 1.4)] },
        { type: "way", role: "outer", geometry: [p(0.2, 0.2), p(0.6, 0.2), p(0.6, 1.4)] },
        { type: "way", role: "inner", geometry: [p(0.3, 0.3), p(0.3, 0.4), p(0.4, 0.4), p(0.3, 0.3)] },
      ],
    },
    // East to west: the land on its left is south, the sea north.
    { type: "way", id: 9, tags: { natural: "coastline" }, geometry: [p(0.95, 1.5), p(0.95, -0.5)] },
  ];
  const features = terrainFeatures({ elements }, unit);
  assert.deepEqual(features.map(f => f.kind), ["water", "road", "coastline", "water"]);
  assert.ok(features[0].points.every(([lat]) => lat >= 0.95), "the sea north of the coast, painted first");
  const lake = features[3];
  assert.ok(lake.closed && lake.points.every(([lat, lon]) => lat >= 0.2 && lat <= 0.6 && lon >= 0.2 && lon <= 1));
  assert.ok(Math.abs(area(lake.points) - 0.4 * 0.8) < 1e-9, "the part of the lake in the box");
  // Without a box (the desktop workshop's evidence) the rings are kept whole and no sea is inferred.
  assert.deepEqual(terrainFeatures({ elements }).map(f => f.kind), ["road", "coastline", "water"]);
});
