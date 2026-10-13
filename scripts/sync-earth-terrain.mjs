// Copy the terrain facts the browser Earth battlefield compiler (lib/earth-battlefield.ts) needs from the sibling
// RTSAI-Mod checkout's standalone tileset into data/earth-terrain.json.
//
//   npm run sync:earth-terrain                    # write data/earth-terrain.json
//   npm run check:earth-terrain                   # exit 1 when the committed JSON is stale (skips without RTSAI-Mod)
//   npm run sync:earth-terrain -- --mod=../RTSAI-Mod
//
// It parses the tileset exactly as terrain_types() in RTSAI-Mod tools/standalone-maps.py does, but keeps only the
// template ids the generator can emit (0 = grass, 1000 + set * 16 + mask for the water/dirt/rough/sand corner sets)
// and the Ore and Gems radar colours that the map preview uses.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const modRoot = resolve(web, arg("mod", process.env.RTSAI_MOD_DIR ?? "../RTSAI-Mod"));
const TILESET = "mods/rtsai/standalone/tilesets/temperat.yaml";
const OUTPUT = join(web, "data", "earth-terrain.json");
const check = process.argv.includes("--check");

const tilesetPath = join(modRoot, TILESET);
if (!existsSync(tilesetPath)) {
  if (check) {
    console.log(`check:earth-terrain skipped: no RTSAI-Mod checkout at ${modRoot} (pass --mod=<path> or set RTSAI_MOD_DIR)`);
    process.exit(0);
  }
  console.error(`No RTSAI-Mod tileset at ${tilesetPath}; pass --mod=<path> or set RTSAI_MOD_DIR`);
  process.exit(1);
}

const bytes = readFileSync(tilesetPath);
// Python's read_text() reads with universal newlines; the tileset is LF in git (RTSAI-Mod .gitattributes).
const text = bytes.toString("utf8").replace(/\r\n?/g, "\n");
const hex6 = value => value.slice(0, 6).toLowerCase();

// terrain_types(): template id -> (type of tile 0, min colour, max colour); later duplicates win, as in a dict.
const templates = new Map();
for (const block of text.split(/^(?=\tTemplate@)/m).slice(1)) {
  const id = block.match(/^\t\tId: (\d+)/m);
  if (!id) throw new Error(`Tileset template without an Id: ${block.slice(0, 60)}`);
  const tile = block.match(/^\t\t\t0: (\S+)\n\t\t\t\tMinColor: (\w+)\n\t\t\t\tMaxColor: (\w+)/m);
  if (tile) templates.set(Number(id[1]), [tile[1], hex6(tile[2]), hex6(tile[3])]);
}
const colors = new Map();
for (const m of text.matchAll(/TerrainType@\w+:\n\t\tType: (\w+)\n(?:\t\t.*\n)*?\t\tColor: (\w+)/g)) colors.set(m[1], hex6(m[2]));

// The generator's template ids: grass, then 1000 + SETS[class] * 16 + corner mask (tid() in standalone-maps.py).
const ids = [0];
for (let set = 0; set < 4; set++) for (let mask = 1; mask < 16; mask++) ids.push(1000 + set * 16 + mask);
const missing = ids.filter(id => !templates.has(id));
if (missing.length) throw new Error(`${TILESET} lacks templates ${missing.join(", ")}`);
for (const name of ["Ore", "Gems"]) if (!colors.has(name)) throw new Error(`${TILESET} lacks the ${name} terrain colour`);

const lines = [
  "{",
  `  "source": "RTSAI-Mod ${TILESET}",`,
  `  "sha256": "${createHash("sha256").update(bytes).digest("hex")}",`,
  `  "templates": {`,
  ids.map(id => `    "${id}": ${JSON.stringify(templates.get(id)).replace(/,/g, ", ")}`).join(",\n"),
  "  },",
  `  "colors": { "Ore": "${colors.get("Ore")}", "Gems": "${colors.get("Gems")}" }`,
  "}",
  "",
];
const output = lines.join("\n");

if (check) {
  const committed = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n") : "";
  if (committed !== output) {
    console.error("data/earth-terrain.json is stale; run npm run sync:earth-terrain");
    process.exit(1);
  }
  console.log(`data/earth-terrain.json matches ${TILESET} (${ids.length} templates)`);
} else {
  writeFileSync(OUTPUT, output);
  console.log(`wrote data/earth-terrain.json: ${ids.length} templates from ${TILESET}`);
}
