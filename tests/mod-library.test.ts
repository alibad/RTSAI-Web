import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { zlibSync } from "fflate";
import { decodePal } from "../lib/art-lab/pal";
import { decodePngSheet } from "../lib/art-lab/png-sheet";
import { decodeShp } from "../lib/art-lab/shp";
import { drawShpFrame } from "../lib/art-lab/sprite-render";
import { baseQueue } from "../lib/art-lab/roster";
import { EXTERNAL_MODS, modLibraryConfig, modRosterPayload, mountPlan } from "../lib/art-lab/mod-library";
import { originalsConfig } from "../lib/art-lab/originals";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A tiny PNG: colour type 3 (indexed) or 6 (RGBA), 8-bit, filter 0 rows, with tEXt metadata. */
function png(width: number, height: number, colorType: 3 | 6, pixels: number[], text: Record<string, string> = {}) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array([...type].map(ch => ch.charCodeAt(0)).concat([...data]));
    const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
    view.setUint32(0, data.length); out.set(body, 4); view.setUint32(8 + data.length, crc(body));
    return out;
  };
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, width); v.setUint32(4, height); ihdr.set([8, colorType, 0, 0, 0], 8);
  const channels = colorType === 3 ? 1 : 4, raw: number[] = [];
  for (let y = 0; y < height; y++) raw.push(0, ...pixels.slice(y * width * channels, (y + 1) * width * channels));
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    ...Object.entries(text).map(([k, val]) => chunk("tEXt", new Uint8Array([...k, "\0", ...val].map(ch => ch.charCodeAt(0))))),
    chunk("IDAT", zlibSync(new Uint8Array(raw))), chunk("IEND", new Uint8Array(0))];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => { all.set(p, at); return at + p.length; }, 0);
  return all;
}

test("PNG sprite sheets: FrameSize slices keep palette indices; RGBA frames draw as true colour", () => {
  const sheet = decodeShp(png(4, 2, 3, [1, 2, 3, 4, 5, 6, 7, 8], { FrameSize: "2,2" }));
  assert.equal(sheet.frames.length, 2);
  assert.deepEqual([sheet.width, sheet.height], [2, 2]);
  assert.deepEqual([...sheet.frames[1].pixels], [3, 4, 7, 8], "second slice, row by row");
  const rgba = decodePngSheet(png(1, 1, 6, [10, 20, 30, 255]));
  const drawn = drawShpFrame(rgba, 0, new Uint8ClampedArray(1024));
  assert.deepEqual([...drawn], [10, 20, 30, 255], "a true-colour frame ignores the palette");
  const regions = decodePngSheet(png(3, 1, 3, [1, 2, 3], { "Frame[0]": "0,0,1,1;0,0", "Frame[1]": "1,0,2,1;0,0" }));
  assert.equal(regions.frames.length, 2);
  assert.equal(regions.width, 2, "frames share the largest region's size");
});

test("text palettes (JASC-PAL) decode as 8-bit colours with the transparent index cleared", () => {
  const jasc = new TextEncoder().encode("JASC-PAL\r\n0100\r\n256\r\n0 0 0\r\n255 128 64\r\n" + "1 2 3\r\n".repeat(254));
  const pal = decodePal(jasc, [255]);
  assert.deepEqual([...pal.slice(4, 8)], [255, 128, 64, 255]);
  assert.equal(pal[4 * 255 + 3], 0);
});

test("other mods' production queues map onto the Studio's categories; upgrades and powers are no units", () => {
  for (const q of ["Infantry", "Vehicle", "Aircraft", "Ship", "Building", "Defense", "Support"]) assert.equal(baseQueue(q), q, "RTS AI's own names pass unchanged");
  assert.equal(baseQueue("Infantry.Shared"), "Infantry");
  assert.equal(baseQueue("InfantrySQ"), "Infantry");
  assert.equal(baseQueue("RAVehicle"), "Vehicle");
  assert.equal(baseQueue("Air.Shared"), "Aircraft");
  assert.equal(baseQueue("RADefence"), "Defense");
  assert.equal(baseQueue("Upgrade.Shared"), null);
  assert.equal(baseQueue("queue.air_gen_generals_power"), null);
});

test("a downloaded mod (OpenHV) lists every unit with its own art and palette (skipped without the checkout)", async t => {
  const lib = modLibraryConfig(web), mod = EXTERNAL_MODS.find(m => m.id === "hv")!;
  if (!existsSync(join(lib.upstreams, mod.repo, "mods", mod.modId, "bits"))) return t.skip("no OpenHV art checkout");
  const plan = mountPlan(lib, mod);
  assert.ok(plan.high.some(d => d.endsWith(join("bits", "sprites", "vehicles"))), "its sprite folders are mounted");
  const roster = await modRosterPayload(originalsConfig(web), lib, "hv");
  assert.equal(roster.factions[0].id, "all-units");
  const units = Object.values(roster.stock);
  assert.ok(units.length > 40);
  assert.deepEqual(units.filter(u => !u.spec.palette || !u.spec.cameo).map(u => u.spec.id), [], "every unit has a palette and a build icon");
  assert.ok(units.every(u => u.sources?.model.kind === "third-party"), "credited to the mod, not to RTS AI or EA");
});

test("a mod with per-country copies (RA+): one row per unit in All units, its own faction names and flags (skipped without the checkout)", async t => {
  const lib = modLibraryConfig(web), mod = EXTERNAL_MODS.find(m => m.id === "raplus")!;
  if (!existsSync(join(lib.upstreams, mod.repo, "mods", mod.modId, "chrome.yaml"))) return t.skip("no RA+ checkout");
  const roster = await modRosterPayload(originalsConfig(web), lib, "raplus");
  const [all, ...factions] = roster.factions;
  const light = all.units.filter(u => u.name === "Light Tank");
  assert.equal(light.length, 1, "the countries' copies of one tank are one row");
  assert.ok((light[0].variants?.length ?? 0) >= 2 && light[0].variants!.every(id => roster.stock[id]), "which counts the copies it folds");
  assert.ok(factions.every(f => f.units.every(u => !u.variants)), "a country's own list keeps its copy");
  const england = factions.find(f => f.id === "england")!;
  assert.notEqual(england.name, "england", "the faction's name as the mod writes it, not its id");
  assert.match(england.flag ?? "", /^data:image\/png;base64,/, "the mod's own flag");
});
