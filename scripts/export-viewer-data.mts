// Writes the Faction viewer's data for every faction (lib/viewer.ts: units with their art specs, stats, weapons,
// doctrine and sounds) as one JSON file per faction, named by the engine's faction id. The browser game's battle
// simulator draws its unit cards with this site's own viewer components from it (RTSAI-WebGame tools/sync-viewer.mjs).
//   node --import tsx scripts/export-viewer-data.mts <out-dir>
import fs from "node:fs";
import path from "node:path";
import { viewerFaction, viewerFactionIds } from "../lib/viewer";
import { rosterFactionById } from "../lib/game-content";

const out = path.resolve(process.argv[2] ?? "viewer-data");
fs.mkdirSync(out, { recursive: true });

const index: Record<string, { catalogId: string; name: string; units: number }> = {};
for (const id of viewerFactionIds()) {
  const faction = viewerFaction(id);
  if (!faction) continue;
  // The catalog id (saudi-arabia) to the engine's faction id (saudi): the game asks by the engine's.
  const engine = rosterFactionById(id, "ra2")?.id ?? id;
  fs.writeFileSync(path.join(out, `${engine}.json`), JSON.stringify(faction));
  index[engine] = { catalogId: id, name: faction.name, units: faction.units.length };
}
fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`viewer data for ${Object.keys(index).length} factions -> ${out}`);
