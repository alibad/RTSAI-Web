/** Local JSON facts only; original images are neither opened nor copied. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { loadModData } from "../lib/art-lab/resolve";
import { loadClassicData } from "../lib/art-lab/classic";
import { computeRosters } from "../lib/art-lab/roster";
import { rebuildDependencies } from "../lib/art-lab/rebuild-dependencies";

const modes = Object.fromEntries((["ra2", "classic"] as const).map(mode => {
  const root = resolve(mode === "ra2" ? "../RTSAI-Mod" : "../OpenRA");
  const path = (p: string) => resolve(root, mode === "classic" ? p.replace(/^engine\//, "") : p);
  const reader = { text: (p: string) => readFileSync(path(p), "utf8"), bytes: () => { throw new Error("Dependency export cannot open image bytes"); }, exists: (p: string) => existsSync(path(p)) };
  const data = mode === "classic" ? loadClassicData(reader) : loadModData(reader);
  const roots = [...new Set(computeRosters(data).factions.flatMap(f => f.units.map(u => u.id)))];
  return [mode, { ...rebuildDependencies(data, roots), sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() }];
}));
const out = resolve("../RTSAI-Art/rebuild/dependencies.json");
mkdirSync(resolve(out, ".."), { recursive: true });
writeFileSync(out, JSON.stringify({ schemaVersion: 1, modes }, null, 2) + "\n");
console.log(JSON.stringify(Object.fromEntries(Object.entries(modes).map(([m, d]) => [m, { actors: Object.keys(d.actors).length, additionalActors: Object.values(d.actors).filter(a => !a.buildable).length, weapons: Object.keys(d.weapons).length, imageContracts: Object.keys(d.images).length }]))));
