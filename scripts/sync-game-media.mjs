import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const webRoot = resolve(import.meta.dirname, "..");
const gameRoot = resolve(process.env.RTSAI_GAME_REPO || join(webRoot, "..", "OpenRA-AI"));
// The tracked media stay in the archived OpenRA-AI checkout. Its local generated/ and .artifacts/ folders moved to
// RTSAI-Mod/companion on 1 Nov 2026, so each source is looked up in both, with the same relative path.
const gameRoots = [gameRoot, resolve(process.env.RTSAI_COMPANION_DIR || join(webRoot, "..", "RTSAI-Mod", "companion"))];
const fromGame = (...parts) => gameRoots.map(root => resolve(root, ...parts)).find(existsSync) ?? resolve(gameRoot, ...parts);
const publicRoot = resolve(webRoot, "public", "game-media");
const generatedModule = resolve(webRoot, "lib", "game-media.generated.ts");
const generatedManifest = resolve(publicRoot, "manifest.json");
const scratchRoot = mkdtempSync(join(tmpdir(), "rtsai-game-media-"));

if (!existsSync(gameRoot)) throw new Error(`OpenRA AI source not found: ${gameRoot}`);
if (!publicRoot.startsWith(resolve(webRoot, "public") + sep)) throw new Error(`Refusing to replace unsafe output: ${publicRoot}`);

const actorNames = {
  ah64sa: "AH-64SA gunship", f15sa: "F-15SA fighter", falcon1: "Falcon One", m1a2s: "M1A2S tank",
  saat: "Saudi ATGM team", sads: "Saudi air defense", sajtac: "Saudi JTAC", samad: "Samad drone",
  sang: "Saudi National Guard", tech: "Armed technical", wadighost: "Wadi Ghost", ymlr: "Yemen rocket launcher",
  ymr: "Yemen rifle team", yrpg: "Yemen RPG team", yspot: "Yemen spotter",
  iratgm: "ATGM team", irazar: "Azar interceptor", irbas: "Basij rifle section", ircloak: "Cloak effect",
  ircoast: "Coastal missile truck", irdc: "Drone controller", irfajr: "Fajr launcher", irghadir: "Ghadir submarine",
  irkarr: "Karrar tank", irloiter: "Simorgh loitering munition", irmohajer: "Mohajer UAV", irpey: "Peykaap missile boat",
  irraad: "Raad air defense", irtoufan: "Toufan gunship", shadowone: "Shadow One",
  aras8: "Aras-8 carrier", bozkir: "Bozkir tank", denizkaplan: "Deniz Kaplan amphibious vehicle", ege: "Ege corvette",
  gokkalkan: "Gokkalkan air defense", greywolf: "Grey Wolf", kuzgunm: "Kuzgun-M UCAV", marmara: "Marmara frigate",
  poyraz: "Poyraz unmanned vessel", sahinx: "Sahin-X fighter", sancak: "Sancak EW vehicle", trat: "Portable AT specialist",
  trdroneop: "Forward drone operator", trrifle: "Mechanized rifleman", turnaah: "Turna-AH rotorcraft", yildirim: "Yildirim artillery",
  cncloud: "Cloud Lancer aircraft", cncrane: "Crane rotorcraft", cnhaiwang: "Haiwang naval unit", cnluyang: "Luyang destroyer",
  cnlynx: "Lynx vehicle", cnnetwork: "Network specialist", cnphl: "PHL rocket artillery", cnportable: "Portable missile team",
  cnqilin: "Qilin tank", cnrifle: "Rifle section", cnskyspear: "Sky Spear air defense", cnzbd: "ZBD assault vehicle",
  redspear: "Red Spear",
};

const sources = [
  {
    faction: "red-sea", root: fromGame("generated", "red-sea-sprites"), mode: "pixel",
  },
  {
    faction: "iran", root: fromGame("generated", "iran-sprites"), mode: "pixel",
  },
  {
    faction: "turkey", root: fromGame("generated", "turkey-sprites"), mode: "pixel",
  },
  {
    faction: "china", root: fromGame(".artifacts", "china-faction", "pre-clean-sprite-staging-20260812"), mode: "pixel",
  },
];

const featured = [
  ["red-sea-key-art", "red-sea", fromGame("assets", "red-sea-2026", "red-sea-key-art.png"), "Red Sea 2026 key art", "concept", "Authored theatre key art", "Source artwork"],
  ["red-sea-hodeidah-live", "red-sea", fromGame("artifacts", "red-sea-live-final", "hodeidah-1470.png"), "Hodeidah Lifeline live build", "live", "Current OpenRA renderer", "Live validated"],
  ["red-sea-f15-live", "red-sea", fromGame("artifacts", "air-warfare", "live-f15-saudi-base.png"), "F-15SA at the Saudi airbase", "live", "Native air-warfare test", "Live validated"],
  ["red-sea-samad-live", "red-sea", fromGame("artifacts", "air-warfare", "live-samad-dive-4.png"), "Samad terminal dive", "live", "Native air-warfare test", "Live validated"],
  ["red-sea-saudi-infantry", "red-sea", fromGame("assets", "red-sea-2026", "infantry-concepts", "saudi-infantry-concept.png"), "Saudi infantry concept", "concept", "Production concept source", "Source artwork"],
  ["red-sea-yemen-infantry", "red-sea", fromGame("assets", "red-sea-2026", "infantry-concepts", "yemen-infantry-concept.png"), "Yemen infantry concept", "concept", "Production concept source", "Source artwork"],
  ["red-sea-jizan-mission", "red-sea", fromGame("assets", "red-sea-2026", "jizan-mission-preview.png"), "Jizan Corridor mission", "mission", "Mission browser art", "Shipped asset"],
  ["red-sea-hodeidah-mission", "red-sea", fromGame("assets", "red-sea-2026", "hodeidah-mission-preview.png"), "Hodeidah Lifeline mission", "mission", "Mission browser art", "Shipped asset"],
  ["red-sea-mandab-mission", "red-sea", fromGame("assets", "red-sea-2026", "mandab-mission-preview.png"), "Bab al-Mandab Passage mission", "mission", "Mission browser art", "Shipped asset"],

  ["iran-cameo-roster", "iran", fromGame("docs", "iran-faction-evidence", "00-production-cameos.png"), "Iran production roster", "concept", "Complete production cameo sheet", "Live validated"],
  ["iran-doctrine-range", "iran", fromGame("docs", "iran-faction-evidence", "01-doctrine-range.png"), "Distributed denial doctrine", "live", "Live range and counterplay evidence", "Live validated"],
  ["iran-live-headings", "iran", fromGame("docs", "iran-faction-evidence", "02-live-headings.png"), "Directional movement in engine", "audit", "Heading and movement evidence", "Live validated"],
  ["iran-toufan-rearmed", "iran", fromGame("docs", "iran-faction-evidence", "03-toufan-rearmed.png"), "Toufan rearm cycle", "live", "Finite ammunition and rearm evidence", "Live validated"],
  ["iran-shadow-sabotage", "iran", fromGame("docs", "iran-faction-evidence", "04-shadow-sabotage.png"), "Shadow One sabotage", "live", "Hero counterplay evidence", "Live validated"],
  ["iran-loitering-attack", "iran", fromGame("docs", "iran-faction-evidence", "05-loitering-attack.png"), "Simorgh loitering attack", "live", "One-way munition evidence", "Live validated"],
  ["iran-naval-combat", "iran", fromGame("docs", "iran-faction-evidence", "06-naval-combat.png"), "Littoral combat", "live", "Native naval combat evidence", "Live validated"],

  ["turkey-roster-concept", "turkey", fromGame("assets", "turkey-faction", "concept-sources", "turkey-roster-concept.png"), "Anatolian Guard roster", "concept", "Complete faction concept board", "Source artwork"],
  ["turkey-straits-opening", "turkey", fromGame("artifacts", "turkey-faction", "live", "straits-shield-opening.png"), "Straits Shield opening", "live", "Current OpenRA renderer", "Live validated"],
  ["turkey-straits-combat", "turkey", fromGame("artifacts", "turkey-faction", "live", "straits-shield-live-combat.png"), "Straits Shield combat", "live", "Current OpenRA renderer", "Live validated"],
  ["turkey-ai-progression", "turkey", fromGame("artifacts", "turkey-faction", "turkey-ai-progression.png"), "Native bot progression", "live", "Normal-bot build telemetry", "Live validated"],
  ["turkey-facing-audit", "turkey", fromGame("artifacts", "turkey-faction", "directional-audit", "all-facing-composites.png"), "Ground roster facing audit", "audit", "Full hull and turret facing sets", "Structurally audited"],
  ["turkey-cardinal-audit", "turkey", fromGame("artifacts", "turkey-faction", "directional-audit", "cardinal-handedness-check.png"), "Cardinal handedness check", "audit", "North, east, south, west landmarks", "Structurally audited"],

  ["china-cameo-atlas", "china", fromGame("assets", "china-faction", "icon-sources", "china-unit-cameo-atlas-v1.png"), "China combined-arms roster", "concept", "Original unit concept atlas", "Source artwork"],
  ["china-gap-atlas", "china", fromGame("assets", "china-faction", "icon-sources", "china-gap-cameo-atlas-v2.png"), "China specialist roster", "concept", "Follow-up cameo concept atlas", "Source artwork"],
  ["china-native-renderer", "china", fromGame(".artifacts", "china-faction", "live", "04-native-renderer.png"), "Haitian Network native renderer", "live", "Current OpenRA renderer", "Live validated"],
  ["china-deployment", "china", fromGame(".artifacts", "china-faction", "live", "01-china-deployment.png"), "China live deployment", "live", "Headless battlefield telemetry", "Live validated"],
  ["china-network-maneuver", "china", fromGame(".artifacts", "china-faction", "live", "02-network-and-amphibious-maneuver.png"), "Network and amphibious maneuver", "live", "Headless battlefield telemetry", "Live validated"],
  ["china-combined-arms", "china", fromGame(".artifacts", "china-faction", "live", "03-combined-arms-contact.png"), "Combined-arms contact", "live", "Headless battlefield telemetry", "Live validated"],
];

function listRootPngs(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .map((entry) => resolve(root, entry.name));
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function classifySheet(name) {
  if (name.includes("icon-review")) return "cameo";
  if (/(husk|sink|rotor|muzzle|impact|wake|projectile|sabotage|designator)/.test(name)) return "effects";
  return "unit";
}

function sheetTitle(fileName) {
  const stem = basename(fileName, extname(fileName));
  const base = stem
    .replace(/icon-review$/, "")
    .replace(/-contact-sheet$/, "")
    .replace(/husk$/, " husk")
    .replace(/sink$/, " sinking sequence")
    .replace(/rotor$/, " rotor sequence");
  const key = slugify(base).replace(/-/g, "");
  const named = actorNames[key];
  if (named) return stem.includes("icon-review") ? `${named} production cameo` : `${named} sprite sheet`;
  return base.split(/[-_ ]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

function relativeSource(sourcePath) {
  const root = gameRoots.find(r => sourcePath.startsWith(r + sep));
  if (root) return relative(root, sourcePath).replaceAll("\\", "/");
  return relative(webRoot, sourcePath).replaceAll("\\", "/");
}

function encode(sourcePath, mode) {
  const tempPath = resolve(scratchRoot, `${createHash("sha1").update(sourcePath).digest("hex")}.webp`);
  if (extname(sourcePath).toLowerCase() === ".webp") return { buffer: readFileSync(sourcePath), extension: ".webp", dimensionsPath: sourcePath };
  const args = mode === "pixel"
    ? ["-y", "-v", "error", "-i", sourcePath, "-map_metadata", "-1", "-frames:v", "1", "-c:v", "libwebp", "-lossless", "1", "-compression_level", "6", tempPath]
    : ["-y", "-v", "error", "-i", sourcePath, "-map_metadata", "-1", "-frames:v", "1", "-vf", "scale=w='min(1920,iw)':h=-2", "-c:v", "libwebp", "-quality", "82", "-compression_level", "6", tempPath];
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffmpeg failed for ${sourcePath}: ${result.stderr}`);
  return { buffer: readFileSync(tempPath), extension: ".webp", dimensionsPath: tempPath };
}

function dimensions(path) {
  const result = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`ffprobe failed for ${path}: ${result.stderr}`);
  const stream = JSON.parse(result.stdout).streams?.[0];
  return { width: Number(stream?.width || 1), height: Number(stream?.height || 1) };
}

function writeAsset({ id, faction, sourcePath, title, category, detail, validation, mode = "photo" }) {
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) throw new Error(`Missing media source: ${sourcePath}`);
  const encoded = encode(sourcePath, mode);
  const hash = createHash("sha256").update(encoded.buffer).digest("hex").slice(0, 12);
  const fileName = `${slugify(id)}.${hash}${encoded.extension}`;
  const factionRoot = resolve(publicRoot, faction);
  mkdirSync(factionRoot, { recursive: true });
  writeFileSync(resolve(factionRoot, fileName), encoded.buffer);
  const size = dimensions(encoded.dimensionsPath);
  return {
    id,
    faction,
    title,
    category,
    detail,
    validation,
    src: `/game-media/${faction}/${fileName}`,
    width: size.width,
    height: size.height,
    bytes: encoded.buffer.byteLength,
    sourcePath: relativeSource(sourcePath),
  };
}

try {
  rmSync(publicRoot, { recursive: true, force: true });
  mkdirSync(publicRoot, { recursive: true });
  const assets = [];

  for (const [id, faction, sourcePath, title, category, detail, validation] of featured) {
    assets.push(writeAsset({ id, faction, sourcePath, title, category, detail, validation }));
  }

  for (const source of sources) {
    for (const sourcePath of listRootPngs(source.root)) {
      const fileName = basename(sourcePath);
      const stem = basename(fileName, extname(fileName));
      const category = classifySheet(stem);
      assets.push(writeAsset({
        id: `${source.faction}-${slugify(stem)}`,
        faction: source.faction,
        sourcePath,
        title: sheetTitle(fileName),
        category,
        detail: category === "cameo" ? "Production cameo review" : category === "unit" ? "Generated animation contact sheet" : "Generated effects and damage-state review",
        validation: category === "cameo" ? "Shipped asset" : "Structurally audited",
        mode: source.mode,
      }));
    }
  }

  assets.sort((a, b) => a.faction.localeCompare(b.faction) || a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  const json = JSON.stringify(assets, null, 2);
  writeFileSync(generatedManifest, `${json}\n`);
  writeFileSync(generatedModule, `// Generated by scripts/sync-game-media.mjs. Do not edit by hand.\nexport const gameMedia = ${json} as const;\n`);
  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  console.log(`Synced ${assets.length} game media assets (${(totalBytes / 1024 / 1024).toFixed(2)} MB) from ${gameRoot}`);
} finally {
  rmSync(scratchRoot, { recursive: true, force: true });
}
