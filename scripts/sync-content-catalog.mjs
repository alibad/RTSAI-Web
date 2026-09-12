import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const product = resolve(process.argv.find(arg => arg.startsWith("--product="))?.slice(10) ?? "../OpenRA-AI");
const engine = resolve(process.argv.find(arg => arg.startsWith("--engine="))?.slice(9) ?? "../OpenRA");
const python = process.env.CATALOG_PYTHON ?? (process.platform === "win32" ? resolve(product, ".venv/Scripts/python.exe") : "python3");
execFileSync(python, [resolve(product, "scripts/content_catalog.py"), "--engine", engine], { stdio: "inherit" });
const source = await readFile(resolve(product, "catalog/factions.json"));
const catalog = JSON.parse(source);
const media = JSON.parse(await readFile(new URL("../public/game-media/manifest.json", import.meta.url), "utf8"));
const ids = new Set(media.map(item => item.id));
for (const id of [...catalog.factions.map(item => item.heroAssetId), ...catalog.units.flatMap(item => item.assetIds)]) {
  if (!ids.has(id)) throw new Error("Missing catalog media: " + id);
}
const output = new URL("../data/factions.generated.json", import.meta.url);
const serialized = JSON.stringify({ source: "OpenRA-AI/catalog/factions.json", sha256: createHash("sha256").update(source).digest("hex"), catalog }, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (await readFile(output, "utf8") !== serialized) throw new Error("Catalog snapshot is stale; run npm run sync:content");
} else { await writeFile(output, serialized); }
console.log("Validated catalog: 5 factions / 12 signature units");
