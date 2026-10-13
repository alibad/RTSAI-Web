import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { unzipSync, unzlibSync } from "fflate";
import terrain from "../data/earth-terrain.json";
import {
  compileBattlefield,
  connectBases,
  sanitizeTitle,
  type Battlefield,
  type BattlefieldRequest,
  type EarthEvidence,
  type EarthKind,
} from "../lib/earth-battlefield";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LAT = 47.3769;
const LON = 8.5417;
const RADIUS = 2500;

/** [lat, lon] of a point given as fractions of the map square: fx west to east, fy north to south. */
function geo(fx: number, fy: number, latitude = LAT, longitude = LON, radius = RADIUS): [number, number] {
  const lon = longitude + ((fx - 0.5) * 2 * radius) / (111320 * Math.cos((latitude * Math.PI) / 180));
  const lat = latitude - ((fy - 0.5) * 2 * radius) / 111320;
  return [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5];
}
const line = (kind: EarthKind, points: [number, number][], closed = false): EarthEvidence => ({
  kind,
  closed,
  points: points.map(([fx, fy]) => geo(fx, fy)),
});
const ring = (kind: EarthKind, points: [number, number][]) => line(kind, [...points, points[0]], true);
const ellipse = (cx: number, cy: number, rx: number, ry: number, n: number, wobble = 0): [number, number][] =>
  Array.from({ length: n }, (_, k) => {
    const a = (k / n) * 2 * Math.PI;
    const r = 1 + wobble * Math.sin(3 * a);
    return [cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a)];
  });
const square = (cx: number, cy: number, s: number): [number, number][] => [
  [cx - s, cy - s],
  [cx + s, cy - s],
  [cx + s, cy + s],
  [cx - s, cy + s],
];
const meander = (x0: number, y0: number, x1: number, y1: number, n: number, amplitude: number): [number, number][] =>
  Array.from({ length: n }, (_, k) => {
    const t = k / (n - 1);
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + amplitude * Math.sin(t * 9)];
  });

/** A small but realistic evidence set: every kind, open and closed ways, concave shapes, ways leaving the map. */
function fixtureFeatures(): EarthEvidence[] {
  return [
    ring("water", ellipse(0.52, 0.16, 0.13, 0.06, 28, 0.15)),
    line("river", meander(-0.05, 0.8, 1.05, 0.9, 14, 0.03)),
    line("water", [[0.1, 0.05], [0.18, 0.08], [0.26, 0.1], [0.3, 0.13]]),
    line("road", meander(0.02, 0.42, 0.98, 0.58, 8, 0.02)),
    line("road", [[0.6, 0.02], [0.58, 0.3], [0.57, 0.6], [0.55, 0.98]]),
    ...[0.56, 0.62, 0.68, 0.74].map(y => line("local-road", [[0.28, y], [0.36, y + 0.004], [0.46, y]])),
    ...[0.3, 0.37, 0.44].map(x => line("local-road", [[x, 0.54], [x + 0.003, 0.65], [x, 0.76]])),
    ring("forest", ellipse(0.82, 0.3, 0.09, 0.08, 12, 0.3)),
    line("forest", [[0.7, 0.7], [0.75, 0.72], [0.8, 0.7]]),
    ring("urban", [[0.27, 0.53], [0.47, 0.53], [0.47, 0.6], [0.36, 0.6], [0.36, 0.68], [0.47, 0.68], [0.47, 0.77], [0.27, 0.77]]),
    ...[[0.31, 0.57], [0.33, 0.63], [0.4, 0.57], [0.42, 0.71], [0.32, 0.72], [0.66, 0.45], [0.7, 0.86], [0.12, 0.6]].map(([x, y]) =>
      ring("building", square(x, y, 0.006)),
    ),
    line("rail", [[0, 0.3], [0.25, 0.32], [0.5, 0.33], [0.75, 0.35], [1, 0.36]]),
    line("coastline", [[0, 0.98], [0.5, 0.985], [1, 0.99]]),
    line("dry-river", [[0.85, 0.5], [0.9, 0.6], [0.88, 0.7], [0.93, 0.8]]),
    ring("sand", ellipse(0.15, 0.9, 0.05, 0.03, 10)),
    ring("rough", [[0.05, 0.2], [0.12, 0.18], [0.14, 0.26], [0.08, 0.3]]),
    ring("road", ellipse(0.5, 0.5, 0.02, 0.02, 8)),
    line("road", [[0.4, 0.4]]),
  ];
}

const request = (overrides: Partial<BattlefieldRequest> = {}): BattlefieldRequest => ({
  latitude: LAT,
  longitude: LON,
  radius: RADIUS,
  seed: 42,
  size: 64,
  players: 2,
  title: "Zurich Lakeside",
  ...overrides,
});

function readPngChunks(png: Uint8Array) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: { type: string; data: Uint8Array }[] = [];
  for (let at = 8; at < png.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return chunks;
}

test("map.bin is OpenRA format 2 with tile, zero height and resource layers for every size", async () => {
  for (const size of [48, 64, 80] as const) {
    const map = await compileBattlefield(request({ size }), fixtureFeatures());
    const w = size;
    const h = size * 2;
    assert.equal(map.width, w);
    assert.equal(map.height, h);
    assert.equal(map.bin.byteLength, 17 + 6 * w * h);
    const view = new DataView(map.bin.buffer, map.bin.byteOffset, map.bin.byteLength);
    assert.equal(view.getUint8(0), 2);
    assert.equal(view.getUint16(1, true), w);
    assert.equal(view.getUint16(3, true), h);
    assert.equal(view.getUint32(5, true), 17);
    assert.equal(view.getUint32(9, true), 17 + w * h * 3);
    assert.equal(view.getUint32(13, true), 17 + w * h * 4);
    assert.ok(map.bin.subarray(17 + w * h * 3, 17 + w * h * 4).every(b => b === 0), "height layer is flat");
    const templates = new Set<number>();
    for (let i = 0; i < w * h; i++) templates.add(view.getUint16(17 + i * 3, true));
    for (const id of templates) assert.ok(String(id) in terrain.templates, `template ${id} is in the tileset`);
    assert.ok(templates.size > 10, "evidence and corridors produce transitions");
    let ore = 0;
    let gems = 0;
    for (let i = 0; i < w * h; i++) {
      const type = map.bin[17 + w * h * 4 + i * 2];
      if (type === 1) ore++;
      if (type === 2) gems++;
    }
    // Resources only stay on Clear/Rough/Road cells, so the dirt corridors through the centre thin out the gems.
    assert.ok(ore > 20 && gems > 0, `size ${size} has home ore (${ore}) and central gems (${gems})`);
  }
});

test("map.yaml declares the rtsai mod, temperate tileset, bounds, spawns and ore mines", async () => {
  const map = await compileBattlefield(request({ size: 48 }), fixtureFeatures());
  assert.match(map.yaml, /^MapFormat: 12\n\nRequiresMod: rtsai\n\nTitle: Zurich Lakeside\n/);
  assert.match(map.yaml, /\nAuthor: RTS AI; geography © OpenStreetMap contributors \(ODbL\)\n/);
  assert.match(map.yaml, /\nTileset: TEMPERATE\n/);
  assert.match(map.yaml, /\nMapSize: 48,96\n/);
  assert.match(map.yaml, /\nBounds: 1,1,46,94\n/);
  assert.equal(map.yaml.match(/: mpspawn\n/g)?.length, 2);
  assert.equal(map.yaml.match(/: oremine\n/g)?.length, 4);
  assert.match(map.yaml, /\tPlayerReference@Multi1:\n/);
  assert.doesNotMatch(map.yaml, /Multi2/);
  assert.ok(!map.yaml.includes("\r"));
  assert.deepEqual(map.report.validation, { connectedBases: true, clearBaseZones: true, homeMines: 4, reachableCells: map.report.validation.reachableCells });
  assert.ok(map.report.validation.reachableCells > 1000);
  assert.equal(map.report.features.building, 8);
  assert.equal(map.report.features.coastline, 1);
  assert.equal(map.report.features.road, 3, "a one-point road is skipped");
  assert.equal(map.report.source, "OpenStreetMap");
  assert.equal(map.report.license, "ODbL-1.0");
  assert.ok(!("paths" in map.report));
});

test("four players get Multi0..Multi3, four spawns and eight mines", async () => {
  const map = await compileBattlefield(request({ players: 4, size: 80 }), fixtureFeatures());
  for (const k of [0, 1, 2, 3]) assert.match(map.yaml, new RegExp(`\\tPlayerReference@Multi${k}:\\n\\t\\tName: Multi${k}\\n\\t\\tPlayable: True\\n`));
  assert.match(map.yaml, /\t\tEnemies: Multi0, Multi1, Multi2, Multi3\n/);
  assert.equal(map.yaml.match(/: mpspawn\n/g)?.length, 4);
  assert.equal(map.yaml.match(/: oremine\n/g)?.length, 8);
  assert.equal(map.report.validation.homeMines, 8);
  assert.equal(map.players, 4);
});

test("the preview PNG, the package and the id are well formed", async () => {
  const map = await compileBattlefield(request({ size: 48 }), fixtureFeatures());
  const chunks = readPngChunks(map.png);
  assert.deepEqual(chunks.map(c => c.type), ["IHDR", "IDAT", "IEND"]);
  const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset, 13);
  assert.equal(ihdr.getUint32(0), 2 * (48 - 2) - 1);
  assert.equal(ihdr.getUint32(4), 96 - 2);
  assert.deepEqual([...chunks[0].data.subarray(8)], [8, 6, 0, 0, 0]);
  const raw = unzlibSync(chunks[1].data);
  assert.equal(raw.length, (4 * 91 + 1) * 94);
  assert.equal(raw[0], 0, "filter type 0");
  // Two pixels per cell with odd rows shifted by one: the cells inside the bounds cover every pixel.
  for (let y = 0; y < 94; y++) {
    assert.equal(raw[y * (4 * 91 + 1)], 0, "filter type 0");
    for (let x = 0; x < 91; x++) assert.equal(raw[y * (4 * 91 + 1) + 1 + x * 4 + 3], 255);
  }

  const files = unzipSync(map.oramap);
  assert.deepEqual(Object.keys(files).sort(), ["earth.json", "map.bin", "map.png", "map.yaml"]);
  assert.deepEqual(files["map.bin"], map.bin);
  assert.deepEqual(files["map.png"], map.png);
  assert.equal(new TextDecoder().decode(files["map.yaml"]), map.yaml);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(files["earth.json"])), map.report);

  const hash = createHash("sha256").update(Buffer.from(map.yaml, "utf8")).update(map.bin).digest("hex");
  assert.equal(map.id, `earth-${hash.slice(0, 16)}`);
  assert.equal(map.report.id, map.id);
});

test("compilation is deterministic and the seed changes the map", async () => {
  const first = await compileBattlefield(request(), fixtureFeatures());
  const second = await compileBattlefield(request(), fixtureFeatures());
  assert.equal(first.id, second.id);
  assert.equal(first.yaml, second.yaml);
  assert.deepEqual(first.bin, second.bin);
  assert.deepEqual(first.png, second.png);
  assert.deepEqual(first.oramap, second.oramap);
  const reseeded = await compileBattlefield(request({ seed: 43 }), fixtureFeatures());
  assert.notEqual(reseeded.id, first.id);
  const quiet = await compileBattlefield(request(), fixtureFeatures(), { noise: false });
  const quietReseeded = await compileBattlefield(request({ seed: 43 }), fixtureFeatures(), { noise: false });
  assert.equal(quiet.id, quietReseeded.id, "without noise the seed only reaches the report");
});

test("settings and evidence are validated with the Python messages", async () => {
  const features = fixtureFeatures();
  const invalid = /^Error: Invalid geographic selection or battlefield settings$/;
  for (const bad of [{ radius: 499 }, { radius: 10001 }, { latitude: 86 }, { longitude: -181 }, { seed: -1 }, { seed: 2147483648 }]) {
    await assert.rejects(compileBattlefield(request(bad), features), invalid);
  }
  await assert.rejects(compileBattlefield({ ...request(), size: 50 as 48 }, features), invalid);
  await assert.rejects(compileBattlefield({ ...request(), players: 3 as 2 }, features), invalid);
  await assert.rejects(compileBattlefield(request({ latitude: Number.NaN }), features), invalid);
  await assert.rejects(compileBattlefield(request(), []), /^Error: No geographic features were returned; choose another area$/);
  const dense = Array.from({ length: 12001 }, () => features[0]);
  await assert.rejects(compileBattlefield(request(), dense), /^Error: This area is too dense; select a smaller radius$/);
  // Python's int() truncation.
  const truncated = await compileBattlefield({ ...request(), radius: 2500.9, seed: 42.7 }, features, { noise: false });
  assert.equal(truncated.report.radius, 2500);
  assert.equal(truncated.report.seed, 42);
});

test("titles are sanitised as in Python, and lose MiniYaml comments", async () => {
  assert.equal(sanitizeTitle("Port: North\r\nShore # 2"), "Port  North  Shore   2");
  assert.equal(sanitizeTitle(" 　 \t"), "Earth Battlefield");
  assert.equal(sanitizeTitle("\x1cZ\x1f"), "Z");
  assert.equal(sanitizeTitle("é".repeat(100)), "é".repeat(80));
  assert.equal(sanitizeTitle("🗺".repeat(81)), "🗺".repeat(80));
  const map = await compileBattlefield(request({ title: "Zürich: #1" }), fixtureFeatures());
  assert.equal(map.title, "Zürich   1");
  assert.match(map.yaml, /\nTitle: Zürich {3}1\n/);
});

test("a single-point building (the centre /api/earth-features returns) is painted as rough ground", async () => {
  const centre = geo(0.66, 0.42);
  const base = [line("road", [[0.1, 0.1], [0.12, 0.1]])];
  const without = await compileBattlefield(request(), [...base, { kind: "coastline", points: [centre] }], { noise: false });
  const withBuilding = await compileBattlefield(request(), [...base, { kind: "building", points: [centre] }], { noise: false });
  assert.notDeepEqual(withBuilding.bin, without.bin);
  assert.equal(withBuilding.report.features.building, 1);
  assert.equal(without.report.features.coastline, undefined, "other one-point features are skipped");
  const view = new DataView(withBuilding.bin.buffer);
  const rough = new Set(Array.from({ length: 15 }, (_, k) => 1033 + k));
  let roughCells = 0;
  for (let i = 0; i < 64 * 128; i++) if (rough.has(view.getUint16(17 + i * 3, true))) roughCells++;
  assert.ok(roughCells >= 1);
});

test("a lake between the bases cannot cut them off: the base corridors are painted over the evidence", async () => {
  // A closed lake over the whole middle band of the map, from the west edge to the east edge.
  const lake = ring("water", [[-0.1, 0.36], [1.1, 0.36], [1.1, 0.64], [-0.1, 0.64]]);
  const map = await compileBattlefield(request({ size: 48 }), [lake], { noise: false });
  assert.equal(map.report.validation.connectedBases, true);
  const view = new DataView(map.bin.buffer);
  let water = 0;
  for (let i = 0; i < 48 * 96; i++) if (view.getUint16(17 + i * 3, true) === 1015) water++;
  assert.ok(water > 300, `the lake is open water (${water} cells)`);
});

test("disconnected bases are rejected with the Python message", () => {
  // The route check on a synthetic legal grid: a band of water (illegal cells) separates the two homes.
  const w = 48;
  const h = 96;
  const legal = new Uint8Array(w * h);
  for (let u = 1; u < w - 1; u++) for (let v = 1; v < h - 1; v++) legal[u * h + v] = v < 40 || v > 50 ? 1 : 0;
  const homes: [number, number][] = [[11, 31], [36, 64]];
  assert.throws(() => connectBases(legal, w, h, homes), /^Error: Generated routes are disconnected; change the seed or location$/);
  for (let v = 40; v <= 50; v++) legal[24 * h + v] = 1; // one ford
  const { starts, reachable } = connectBases(legal, w, h, homes);
  assert.deepEqual(starts, homes);
  assert.equal(reachable, 46 * 94 - 11 * 46 + 11);
  // Starts are the nearest legal cell, first in u-major order on ties.
  legal[11 * h + 31] = 0;
  assert.deepEqual(connectBases(legal, w, h, homes).starts[0], [10, 31]);
});

test("12,000 features compile quickly at size 80", async () => {
  let state = 7;
  const random = () => ((state = (Math.imul(state, 1103515245) + 12345) >>> 0) / 4294967296);
  const features: EarthEvidence[] = [];
  for (let k = 0; k < 6000; k++) {
    const x = random() * 1.2 - 0.1;
    const y = random() * 1.2 - 0.1;
    features.push(k % 2 ? { kind: "building", points: [geo(x, y)] } : ring("building", square(x, y, 0.002)));
  }
  for (let k = 0; k < 4000; k++) {
    const x = random();
    const y = random();
    const points: [number, number][] = [];
    for (let p = 0; p < 6; p++) points.push([x + (random() - 0.5) * 0.08, y + (random() - 0.5) * 0.08]);
    features.push(line(k % 3 ? "local-road" : "road", points));
  }
  for (let k = 0; k < 1700; k++) {
    const kind = (["forest", "urban", "water", "sand", "rough"] as const)[k % 5];
    features.push(ring(kind, ellipse(random(), random(), 0.01 + random() * 0.06, 0.01 + random() * 0.06, 16, 0.2)));
  }
  for (let k = 0; k < 300; k++) features.push(line(k % 2 ? "river" : "rail", meander(-0.1, random(), 1.1, random(), 40, 0.05)));
  assert.equal(features.length, 12000);
  await compileBattlefield(request({ size: 80 }), features.slice(0, 200)); // warm up the JIT
  const started = performance.now();
  const map = await compileBattlefield(request({ size: 80, players: 4 }), features);
  const elapsed = performance.now() - started;
  console.log(`# size 80, 12000 features: ${elapsed.toFixed(0)} ms`);
  assert.equal(Object.values(map.report.features).reduce((a, b) => a + b, 0), 12000);
  assert.ok(elapsed < 2000, `compiled in ${elapsed.toFixed(0)} ms`);
});

// ------------------------------------------------------------------------------------------------ parity
function findPython(): string | null {
  const bundled = join(homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", process.platform === "win32" ? "python.exe" : "bin/python3");
  const candidate = process.env.RTSAI_PYTHON ?? (existsSync(bundled) ? bundled : null);
  if (!candidate) return null;
  const probe = spawnSync(candidate, ["-B", "-c", "import numpy, PIL"], { encoding: "utf8" });
  return probe.status === 0 ? candidate : null;
}

function firstDifference(a: Uint8Array, b: Uint8Array) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

test("parity: byte-for-byte the output of RTSAI-Mod tools/earth-battlefield.py (noise off)", async t => {
  const mod = resolve(process.env.RTSAI_MOD_DIR ?? join(web, "..", "RTSAI-Mod"));
  const tileset = join(mod, "mods/rtsai/standalone/tilesets/temperat.yaml");
  if (!["tools/earth-battlefield.py", "tools/standalone-maps.py"].every(f => existsSync(join(mod, f))) || !existsSync(tileset)) {
    t.skip(`no RTSAI-Mod checkout at ${mod}`);
    return;
  }
  const python = findPython();
  if (!python) {
    t.skip("no Python with numpy and Pillow (set RTSAI_PYTHON)");
    return;
  }
  assert.equal(
    createHash("sha256").update(readFileSync(tileset)).digest("hex"),
    terrain.sha256,
    "data/earth-terrain.json is stale; run npm run sync:earth-terrain",
  );

  const features = fixtureFeatures();
  const cases = [48, 64, 80].flatMap(size =>
    ([2, 4] as const).map(players => ({ name: `s${size}-p${players}`, request: request({ size: size as 48 | 64 | 80, players, seed: 1234, title: "Parity: Lake\nShore" }) })),
  );
  const dir = mkdtempSync(join(tmpdir(), "earth-parity-"));
  try {
    const ours = new Map<string, Battlefield>();
    for (const { name, request: settings } of cases) {
      const map = await compileBattlefield(settings, features, { noise: false });
      ours.set(name, map);
      writeFileSync(join(dir, `${name}.ts.png`), map.png);
    }
    const casesFile = join(dir, "cases.json");
    writeFileSync(casesFile, JSON.stringify(cases.map(({ name, request: settings }) => ({ name, request: { ...settings, features } }))));
    const run = spawnSync(python, ["-B", join(web, "tests/fixtures/earth-battlefield-parity.py"), mod, casesFile, dir], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 120_000,
    });
    assert.equal(run.status, 0, `Python harness failed:\n${run.stdout}\n${run.stderr}`);
    const summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
    for (const { name, request: settings } of cases) {
      const map = ours.get(name)!;
      const out = join(dir, name);
      // write_map writes LF; compile_map's later write_text() calls translate to the platform's line ending.
      const pythonYaml = readFileSync(join(out, "map.yaml"), "utf8").replace(/\r\n/g, "\n");
      assert.equal(map.yaml, pythonYaml, `${name}: map.yaml`);
      const pythonBin = new Uint8Array(readFileSync(join(out, "map.bin")));
      const at = firstDifference(map.bin, pythonBin);
      const cell = at >= 17 ? Math.floor(((at - 17) % (settings.size * settings.size * 2 * 3)) / 3) : -1;
      assert.equal(at, -1, `${name}: map.bin differs at byte ${at} (u ${Math.floor(cell / (settings.size * 2))}, v ${cell % (settings.size * 2)})`);
      const entry = summary[name];
      assert.equal(entry.pyMode, "RGBA");
      assert.equal(entry.tsMode, "RGBA");
      assert.deepEqual(entry.tsSize, entry.pySize, `${name}: preview size`);
      const pixels = firstDifference(new Uint8Array(readFileSync(join(out, "ts.rgba"))), new Uint8Array(readFileSync(join(out, "py.rgba"))));
      assert.equal(pixels, -1, `${name}: map.png pixels differ at byte ${pixels}`);
      assert.deepEqual(map.report.validation, entry.validation, `${name}: validation`);
      assert.deepEqual(map.report.features, entry.features, `${name}: feature counts`);
      t.diagnostic(`${name}: map.yaml, map.bin and map.png pixels identical (${entry.validation.reachableCells} reachable cells)`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
