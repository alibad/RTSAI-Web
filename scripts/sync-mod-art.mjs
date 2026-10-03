// Sync the five modern factions' art from the sibling RTSAI-Mod checkout into the Faction Art Lab.
//
//   npm run sync:art                      # write public/art-lab/, data/art-lab.json, lib/art-lab/normals.generated.ts
//   npm run sync:art -- --check           # fail if the committed copies are stale
//   npm run sync:art -- --mod=../RTSAI-Mod --product=../OpenRA-AI --red-sea=../OpenRA-AI-wt-ra2-red-sea
//
// It resolves what the game draws from the mod's own rules and sequences (OpenRA MiniYaml semantics) and
// copies ONLY files recorded in mods/rtsai/modern-factions/ART-PROVENANCE.json, after checking each file's
// SHA-256 against that record. A referenced file outside the record fails the sync, so no RA2 data is
// ever published. The generator lookup reads the OpenRA-AI builders at the pinned commits (optional).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ART_DIR, MOD_DIR, loadModData, resolveArtLab } from "../lib/art-lab/resolve.ts";
import { child, childValue, parseMiniYaml } from "../lib/art-lab/miniyaml.ts";
import { assertPublishable, summarizeProvenance } from "../lib/art-lab/provenance.ts";
import { spriteGenerators, voxelGenerators } from "../lib/art-lab/generator-sources.ts";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const modRoot = resolve(web, arg("mod", "../RTSAI-Mod"));
const productRoots = {
  "OpenRA-AI": resolve(web, arg("product", "../OpenRA-AI")),
  "OpenRA-AI codex/ra2-red-sea": resolve(web, arg("red-sea", "../OpenRA-AI-wt-ra2-red-sea")),
};
const GITHUB = "https://github.com/alibad/OpenRA-AI";
const check = process.argv.includes("--check");

const reader = {
  text: p => readFileSync(join(modRoot, p), "utf8"),
  bytes: p => new Uint8Array(readFileSync(join(modRoot, p))),
  exists: p => existsSync(join(modRoot, p)),
};
if (!reader.exists("mods/rtsai/mod.yaml")) throw new Error(`No RTSAI mod at ${modRoot}; pass --mod=<path>`);

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const data = loadModData(reader);
const resolution = resolveArtLab(reader, data);
const provenanceText = reader.text(`${ART_DIR}/ART-PROVENANCE.json`);
const provenance = JSON.parse(provenanceText);
const keys = [...resolution.files.keys()].sort();
const entries = assertPublishable(keys, provenance, key => sha256(reader.bytes(`${ART_DIR}/${key}`)));

// Generator functions, read at the commit each output's provenance pins.
const sourceCache = new Map();
const sourceAt = (repo, commit) => path => {
  const id = `${repo}@${commit}:${path}`;
  if (!sourceCache.has(id)) {
    const root = productRoots[repo];
    let text = null;
    if (root && existsSync(root)) {
      try { text = git(root, "show", `${commit}:${path}`); } catch { text = null; }
    }
    sourceCache.set(id, text);
  }
  return sourceCache.get(id);
};
let generatorMisses = 0;
function generatorsFor(actor) {
  const byFile = new Map();
  const outputs = actor.render === "voxel"
    ? actor.voxel.parts.filter(p => p.model.vxl).map(p => ({ key: p.model.vxl, label: p.label }))
    : [...new Set(actor.sprite.sequences.filter(s => s.file?.endsWith(".shp")).map(s => s.file))].map(key => ({ key, label: "sprite" }));
  for (const { key, label } of outputs) {
    const entry = entries.get(key);
    if (entry?.generator === "forge-voxel" && entry.source) {
      byFile.set(key, { repo: entry.source.repo, commit: entry.source.commit, script: "tools/mesh_to_vxl.py → tools/palette_pass.py", functions: [], scriptUrl: null, geometry: entry.source.path, note: "Committed local Forge candidate; this repository has no public remote." });
      continue;
    }
    if (!entry?.source || !entry.script || byFile.has(key)) continue;
    const script = entry.script.replace(/\s*\(.*$/, "").trim();
    const { repo, commit } = entry.source;
    const read = sourceAt(repo, commit);
    const output = key.split("/").pop().replace(/\.(vxl|shp)$/, "");
    const functions = (actor.render === "voxel"
      ? voxelGenerators(script, output, read)
      : spriteGenerators(script, actor.id, actor.category === "defense" ? "defense" : "infantry", read)
    ).map(f => ({ ...f, url: `${GITHUB}/blob/${commit}/${f.file}#L${f.line}`, part: f.part ? `${label}: ${f.part}` : label }));
    if (!functions.length) generatorMisses++;
    byFile.set(key, {
      repo: repo === "OpenRA-AI" ? "alibad/OpenRA-AI (main)" : "alibad/OpenRA-AI (codex/ra2-red-sea)",
      commit, script, functions, scriptUrl: `${GITHUB}/blob/${commit}/${script}`,
      geometry: entry.geometry ?? null,
      note: functions.length ? null : "Builder checkout not available; script-level link only.",
    });
  }
  // One entry per distinct script+commit, merging the functions of each output.
  const merged = new Map();
  for (const g of byFile.values()) {
    const id = `${g.commit}:${g.script}`;
    const existing = merged.get(id);
    if (!existing) merged.set(id, { ...g, functions: [...g.functions] });
    else for (const f of g.functions) if (!existing.functions.some(x => x.url === f.url && x.part === f.part)) existing.functions.push(f);
  }
  return [...merged.values()];
}

// Catalog links: faction and unit pages that already exist on the public site.
const catalog = JSON.parse(readFileSync(join(web, "data/factions.generated.json"), "utf8")).catalog;
const catalogFaction = Object.fromEntries(catalog.factions.map(f => [f.variants.ra2?.engineFactionId ?? f.id, f.id]));
const catalogUnit = Object.fromEntries(catalog.units.filter(u => u.variants.ra2?.actorId).map(u => [u.variants.ra2.actorId, u.id]));

const files = {};
for (const key of keys) {
  const bytes = reader.bytes(`${ART_DIR}/${key}`);
  files[key] = { url: `/art-lab/${key}`, modPath: `${ART_DIR}/${key}`, bytes: bytes.length, sha256: sha256(bytes), provenance: summarizeProvenance(entries.get(key)) };
}
const actors = {};
for (const faction of resolution.factions) for (const id of faction.actors) {
  const actor = resolution.actors[id];
  actors[id] = { ...actor, catalogUnitId: catalogUnit[id] ?? null, generator: generatorsFor(actor) };
}
// Battlefield lighting: maps can tint everything drawn (TintPostProcessEffect in their inline World rules).
const mapTints = [];
for (const map of readdirSync(join(modRoot, MOD_DIR, "maps")).sort()) {
  const path = `${MOD_DIR}/maps/${map}/map.yaml`;
  if (!reader.exists(path)) continue;
  const yaml = { value: null, nodes: parseMiniYaml(reader.text(path), path) };
  const tint = child(child(child(yaml, "Rules")?.value, "World")?.value, "TintPostProcessEffect")?.value;
  if (!tint) continue;
  const f = key => Number(childValue(tint, key) ?? 1);
  const ambient = f("Ambient");
  mapTints.push({ map, title: childValue(yaml, "Title") ?? map, tint: [f("Red"), f("Green"), f("Blue")].map(c => Math.round(ambient * c * 10000) / 10000) });
}

let modCommit = "unknown";
let dirty = false;
try {
  modCommit = git(modRoot, "rev-parse", "HEAD");
  dirty = git(modRoot, "status", "--porcelain", "--", ART_DIR).length > 0;
} catch { /* not a git checkout */ }

const manifest = {
  schemaVersion: 1,
  generatedBy: "scripts/sync-mod-art.mjs",
  mod: {
    repo: "alibad/RTSAI-Mod", commit: dirty ? `${modCommit}+dirty` : modCommit,
    provenanceGeneratedBy: provenance.generatedBy, provenanceSha256: sha256(provenanceText.replace(/\r\n/g, "\n")),
    commercialRa2Data: provenance.commercialRa2Data,
  },
  render: { tileSize: [60, 30], tileScale: 1448, shadowColor: resolution.shadowColor, presetColors: resolution.presetColors, mapTints },
  palettes: resolution.palettes,
  factions: resolution.factions.map(f => ({ ...f, catalogId: catalogFaction[f.id] ?? null })),
  actors,
  files,
};

// RA2 / TS voxel normal tables: format data parsed from OpenRA's GPL-3.0 VoxelNormalsPalette.cs.
const normalsSource = reader.text("engine/OpenRA.Mods.Cnc/Traits/World/VoxelNormalsPalette.cs");
const table = name => {
  const raw = normalsSource.split(`float[] ${name} =`)[1].split("];")[0];
  return [...raw.matchAll(/(-?\d+(?:\.\d+)?)f/g)].map(m => Number(m[1]));
};
const normalsModule = `// Generated by scripts/sync-mod-art.mjs from RTSAI-Mod engine/OpenRA.Mods.Cnc/Traits/World/VoxelNormalsPalette.cs
// (OpenRA, GPL-3.0). Voxel normal-vector format tables (x, y, z triplets), not art.
export const RA2_NORMALS: readonly number[] = ${JSON.stringify(table("RA2Normals"))};
export const TS_NORMALS: readonly number[] = ${JSON.stringify(table("TSNormals"))};
`;

const outputs = [
  { path: join(web, "data/art-lab.json"), text: JSON.stringify(manifest, null, 1) + "\n" },
  { path: join(web, "lib/art-lab/normals.generated.ts"), text: normalsModule },
];
const publicDir = join(web, "public/art-lab");
const listPublic = dir => (existsSync(dir) ? readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? listPublic(full) : [relative(publicDir, full).split(sep).join("/")];
}) : []);

if (check) {
  const stale = [];
  for (const o of outputs) if (!existsSync(o.path) || readFileSync(o.path, "utf8").replace(/\r\n/g, "\n") !== o.text) stale.push(relative(web, o.path));
  const present = new Set(listPublic(publicDir));
  for (const key of keys) {
    const target = join(publicDir, key);
    if (!present.has(key) || sha256(readFileSync(target)) !== files[key].sha256) stale.push(`public/art-lab/${key}`);
    present.delete(key);
  }
  for (const extra of present) stale.push(`public/art-lab/${extra} (not referenced)`);
  if (stale.length) throw new Error(`Art Lab copy is stale; run npm run sync:art\n- ${stale.slice(0, 20).join("\n- ")}`);
} else {
  for (const extra of listPublic(publicDir)) if (!files[extra]) rmSync(join(publicDir, extra));
  for (const key of keys) {
    const target = join(publicDir, key);
    mkdirSync(dirname(target), { recursive: true });
    const bytes = reader.bytes(`${ART_DIR}/${key}`);
    if (!existsSync(target) || sha256(readFileSync(target)) !== files[key].sha256) writeFileSync(target, bytes);
  }
  for (const o of outputs) writeFileSync(o.path, o.text);
}
const total = Object.values(files).reduce((sum, f) => sum + f.bytes, 0);
console.log(`Art Lab: ${Object.keys(actors).length} actors in ${manifest.factions.length} factions, ${keys.length} provenance-checked files (${(total / 1e6).toFixed(1)} MB) from ${manifest.mod.commit.slice(0, 12)}${generatorMisses ? `; ${generatorMisses} outputs without a function-level generator link` : ""}`);
