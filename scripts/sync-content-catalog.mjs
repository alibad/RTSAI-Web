import { readFile, writeFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const product = resolve(process.argv.find(arg => arg.startsWith("--product="))?.slice(10) ?? "../OpenRA-AI");
const engine = resolve(process.argv.find(arg => arg.startsWith("--engine="))?.slice(9) ?? "../OpenRA");
const python = process.env.CATALOG_PYTHON ?? (process.platform === "win32" ? resolve(product, ".venv/Scripts/python.exe") : "python3");
execFileSync(python, [resolve(product, "scripts/content_catalog.py"), "--engine", engine], { stdio: "inherit" });
// Hash LF-normalized text so Windows autocrlf checkouts produce the same snapshot.
const source = (await readFile(resolve(product, "catalog/factions.json"), "utf8")).replace(/\r\n/g, "\n");
const catalog = JSON.parse(source);
// The curated dossiers live in the shared catalog. Complete build rosters come
// from the Art Lab's rule export: JSON facts only, never commercial image data.
const rosterPath = resolve("../RTSAI-Art/rebuild/catalog.json");
const rosterSource = JSON.parse(await readFile(rosterPath, "utf8"));
for (const [mode, repo, rules] of [["ra2", resolve("../RTSAI-Mod"), ["mods/rtsai"]], ["classic", engine, ["mods/ra", "mods/common"]]]) {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  if (head !== rosterSource.modes[mode].sourceCommit) throw new Error(`${mode} roster is stale; refresh the Art Lab rule export first`);
  if (execFileSync("git", ["status", "--porcelain", "--", ...rules], { cwd: repo, encoding: "utf8" }).trim()) throw new Error(`${mode} rules have uncommitted changes; refresh and commit the rule export before syncing`);
  if (rosterSource.modes[mode].unresolved.length) throw new Error(`${mode} roster has unresolved actors`);
}
const toMode = mode => mode === "classic" ? "ra" : mode;
// Direct Building.TerrainTypes facts: yards target as buildings but sit on water.
async function waterBuildings(directory) {
  const ids = new Set();
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
    const text = (await readFile(resolve(entry.parentPath, entry.name), "utf8")).replace(/\r\n/g, "\n") + "\n";
    for (const section of text.matchAll(/^([^\s#][^:\n]*):[^\n]*\n((?:\t[^\n]*\n|\n)*)/gm)) {
      const building = section[2].match(/^\tBuilding(?:@[^:]+)?:[^\n]*\n((?:\t\t[^\n]*\n)*)/m);
      if (building && /^\t\tTerrainTypes:.*\bWater\b/m.test(building[1])) ids.add(section[1].toLowerCase());
    }
  }
  return ids;
}
const waterPlacement = { ra: await waterBuildings(resolve(engine,"mods/ra/rules")), ra2: await waterBuildings(resolve("../RTSAI-Mod/mods/rtsai/rules")) };
const rosters = {
  sources: Object.fromEntries(Object.entries(rosterSource.modes).map(([mode, facts]) => [toMode(mode), { commit: facts.sourceCommit, snapshotSha256: facts.snapshotSha256 }])),
  factions: rosterSource.factions.map(f => ({ id: f.id, mode: toMode(f.mode), name: f.name, side: f.side, actors: f.actors })),
  actors: Object.values(rosterSource.actors).map(a => ({ key: a.key, id: a.actor, mode: toMode(a.mode), name: a.name, category: a.category, cost: a.cost, roles: a.roles, behavior: {
    health: a.currentBehavior?.health ?? null, armor: a.currentBehavior?.armor ?? null,
    speed: a.currentBehavior?.speed ?? null, footprint: a.currentBehavior?.footprint ?? null,
    waterPlacement: a.category === "ship" || waterPlacement[toMode(a.mode)].has(a.actor.toLowerCase()),
    description: a.currentBehavior?.description ?? "", weapons: a.currentBehavior?.weapons ?? [],
    actions: a.currentBehavior?.actions ?? [],
    targetTypes: a.currentBehavior?.targetTypes ?? [],
  } })),
};
const actorKeys = new Set(rosters.actors.map(a => a.key));
if (actorKeys.size !== rosters.actors.length) throw new Error("Duplicate roster actors");
for (const f of rosters.factions) {
  if (new Set(f.actors).size !== f.actors.length || f.actors.some(key => !actorKeys.has(key))) throw new Error(`Invalid roster for ${f.id}`);
}
const media = JSON.parse(await readFile(new URL("../public/game-media/manifest.json", import.meta.url), "utf8"));
const ids = new Set(media.map(item => item.id));
for (const id of [...catalog.factions.map(item => item.heroAssetId), ...catalog.units.flatMap(item => item.assetIds)]) {
  if (!ids.has(id)) throw new Error("Missing catalog media: " + id);
}
const output = new URL("../data/factions.generated.json", import.meta.url);
const serialized = JSON.stringify({ source: "OpenRA-AI/catalog/factions.json", sha256: createHash("sha256").update(source).digest("hex"), catalog, rosters }, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if ((await readFile(output, "utf8")).replace(/\r\n/g, "\n") !== serialized) throw new Error("Catalog snapshot is stale; run npm run sync:content");
} else { await writeFile(output, serialized); }
console.log(`Validated catalog: ${catalog.factions.length} factions / ${catalog.units.length} signature units`);
