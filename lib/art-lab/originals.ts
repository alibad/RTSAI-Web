/**
 * Original RA2 art for the dev-only Review (Node only; imported solely by review-server.ts).
 *
 * Original Westwood files are EA copyright: they are extracted from the player's own RA2 content by the mod's engine
 * (`OpenRA.Utility rtsai-classic --extract`, which reads the encrypted MIX headers and mounts the classic add-on's
 * packages exactly as the game does) into a gitignored cache and served by the dev review API (404 in production).
 * Nothing here is imported by any page or committed. The shared Studio shows them from a snapshot the owner publishes
 * (scripts/publish-studio.ts), free and non-commercial under EA's C&C modding guidelines, with EA's notice.
 *
 * The standalone game (`mods/rtsai`) mounts no RA2 file: its stand-ins carry the EA file names, so its own art is
 * read from the mod's folders, never from this cache. The original countries are drawn as the classic add-on
 * plays them, with the player's files.
 *
 * The engine looks for content under `<EngineDir>/Support`; a small shim directory in the cache gives it one,
 * linking the mod engine's `mods` and the existing RA2 content, so no other repository is touched.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { crc32, deflateSync } from "node:zlib";
import { child, childValue, traits, parseMiniYaml } from "./miniyaml";
import { decodePal } from "./pal";
import { buildRenderSpec, spriteWithUrlsOf } from "./render-spec";
import { CLASSIC_DIR, loadModData, MOD_DIR, MODERN_FACTIONS, resolveActor, worldNormals, type ModData, type ModReader, type Ra2Hook } from "./resolve";
import { behaviorFacts, type BehaviorFacts } from "./behavior";
import { loadClassicData, loadDefaultExperienceData } from "./classic";
import { computeRosters, type FactionRoster, type RosterUnit } from "./roster";
import { decodeShp } from "./shp";
import type { PaletteSpec, RenderSpec } from "./spec";
import { drawShpFrame } from "./sprite-render";
import type { PaletteRef, SpriteArt, SpriteSequence } from "./types";
import { combineSources, type ActorSources, type AssetSource } from "./asset-source";
import { localAssetSource } from "./asset-source-server";
import type { ProvenanceRecord } from "./provenance";

const run = promisify(execFile);

export type OriginalsConfig = {
  /** RTSAI-Mod checkout (rules, sequences, the engine and its OpenRA.Utility). */
  modRoot: string;
  /** `ra2yr`: Red Alert 2 with Yuri's Revenge, read from the player's own install (`contentDir`). */
  mode?: "ra2" | "classic" | "ra2yr";
  /** Directory holding Content/ra2 (ra2.mix, language.mix): the player's RA2 data. */
  supportDir: string;
  /** Gitignored cache for extracted files. */
  cacheDir: string;
  /** `ra2yr`: the installed game folder holding ra2.mix and ra2md.mix (e.g. Steam's). */
  contentDir?: string;
};

/** The player's Yuri's Revenge install: RTSAI_YR_DIR, else the usual Steam folders. Null when there is none. */
export function findYrDir(env: NodeJS.ProcessEnv = process.env) {
  const game = "steamapps/common/Command & Conquer Red Alert II";
  const candidates = [env.RTSAI_YR_DIR, `D:/SteamLibrary/${game}`, `C:/Program Files (x86)/Steam/${game}`, `C:/SteamLibrary/${game}`].filter((p): p is string => Boolean(p));
  return candidates.find(p => existsSync(join(p, "ra2md.mix")) && existsSync(join(p, "ra2.mix"))) ?? null;
}

/** RA2 + Yuri's Revenge from the player's own install, extracted into its own private cache. */
export function yrConfig(cfg: OriginalsConfig, env: NodeJS.ProcessEnv = process.env): OriginalsConfig | null {
  const contentDir = findYrDir(env);
  if (!contentDir) return null;
  const cacheDir = resolve(cfg.cacheDir, "..", "ra2yr-originals");
  return { ...cfg, mode: "ra2yr", cacheDir, supportDir: join(cacheDir, "support"), contentDir };
}

/** Yuri's Revenge archives, then Red Alert 2's, in the order Romanov's Vengeance mounts them (last mounted wins). */
const YR_PACKAGES = [
  "content|langmd.mix: langmd", "content|ra2md.mix: ra2md", "langmd|cameomd.mix: cameomd", "ra2md|cachemd.mix", "ra2md|conqmd.mix: conqmd",
  "ra2md|des.mix", "ra2md|desert.mix", "ra2md|genermd.mix", "ra2md|isodesmd.mix", "ra2md|isodes.mix", "ra2md|isogenmd.mix", "ra2md|isolunmd.mix",
  "ra2md|isolun.mix", "ra2md|isosnomd.mix", "ra2md|isotemmd.mix", "ra2md|isoubnmd.mix", "ra2md|isoubn.mix", "ra2md|isourbmd.mix", "ra2md|loadmd.mix",
  "ra2md|localmd.mix: localmd", "ra2md|lun.mix", "ra2md|lunar.mix", "ra2md|ntrlmd.mix", "ra2md|snowmd.mix", "ra2md|ubn.mix", "ra2md|urbann.mix",
  "content|language.mix: lang", "content|ra2.mix: ra2base", "lang|cameo.mix: cameo", "ra2base|cache.mix: cache", "ra2base|conquer.mix: conquer",
  "ra2base|generic.mix", "ra2base|isogen.mix", "ra2base|isosnow.mix", "ra2base|isotemp.mix", "ra2base|isourb.mix", "ra2base|load.mix",
  "ra2base|local.mix: local", "ra2base|neutral.mix", "ra2base|sidec01.mix", "ra2base|sidec02.mix", "ra2base|sno.mix", "ra2base|snow.mix",
  "ra2base|tem.mix", "ra2base|temperat.mix", "ra2base|urb.mix", "ra2base|urban.mix",
];

/**
 * The extraction mod for `ra2yr`: the classic add-on's manifest with a file system that mounts the player's install
 * (linked into a private support folder, never copied). Only plain files are ever removed from the cache.
 */
function ensureYrMod(cfg: OriginalsConfig) {
  const content = join(cfg.supportDir, "Content");
  mkdirSync(content, { recursive: true });
  if (!existsSync(join(content, "ra2yr"))) symlinkSync(cfg.contentDir!, join(content, "ra2yr"), process.platform === "win32" ? "junction" : "dir");
  const packages = ["^EngineDir", "$rtsai: ra2", "$rtsai-classic: classic", "^EngineDir|mods/common: common", "^SupportDir|Content/ra2yr: content", ...YR_PACKAGES.map(p => `~${p}`)];
  const fileSystem = `FileSystem: DefaultFileSystem\n\tPackages:\n${packages.map(p => `\t\t${p}\n`).join("")}\n`;
  const classic = readFileSync(join(cfg.modRoot, CLASSIC_DIR, "mod.yaml"), "utf8").replace(/\r\n/g, "\n");
  const manifest = classic.replace(/^FileSystem:[\s\S]*?(?=^[A-Za-z])/m, fileSystem);
  const dir = join(cfg.cacheDir, "mods", "studio-ra2yr");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "mod.yaml");
  if (!existsSync(file) || readFileSync(file, "utf8") !== manifest) writeFileSync(file, manifest);
}

export const RA2_ROUTE = "/api/art-review/ra2/";
export const SAFE_NAME = /^[a-z0-9][a-z0-9_.-]{0,63}$/;

export function originalsConfig(webRoot: string, env: NodeJS.ProcessEnv = process.env): OriginalsConfig {
  const modRoot = resolve(webRoot, env.RTSAI_MOD_DIR ?? "../RTSAI-Mod");
  return {
    modRoot,
    supportDir: resolve(webRoot, env.RTSAI_RA2_SUPPORT ?? "../OpenRA/Support"),
    cacheDir: resolve(webRoot, env.RTSAI_RA2_CACHE ?? ".cache/ra2-originals"),
  };
}

export type StockArt = { spec: RenderSpec; sprite: SpriteArt | null; files: string[]; fromModBits: string[]; info: RosterUnit | null; behavior: BehaviorFacts; ruleKey?: string; sources?: ActorSources };
export type RosterPayload = {
  mode?: "ra2" | "classic";
  factions: FactionRoster[];
  unresolved?: string[];
  /** What the game draws today. In RA2 mode the standalone game: original countries wear modern-faction stand-ins. */
  stock: Record<string, StockArt>;
  /** RA2: the original countries' units as the classic add-on draws them, from the player's own files. */
  originals?: Record<string, StockArt>;
  /** RA2: the original countries (faction ids) that `originals` draws. */
  countries?: string[];
  /** Another project's mod (the Studio's mod library), read in place from its checkout. */
  mod?: { id: string; name: string; gaps: string | null; url: string; commit: string | null };
  extraction: { requested: number; cached: number; missing: string[]; error: string | null; ms: number };
};

export function classicConfig(cfg: OriginalsConfig): OriginalsConfig { return { ...cfg, mode: "classic", modRoot: resolve(cfg.modRoot, "../OpenRA"), cacheDir: resolve(cfg.cacheDir, "../classic-originals") }; }

const filesDir = (cfg: OriginalsConfig) => join(cfg.cacheDir, "files");
const cachePath = (cfg: OriginalsConfig, name: string) => name.startsWith("owned/")
  ? SAFE_NAME.test(name.slice(6)) ? join(cfg.cacheDir, "owned-files", name.slice(6)) : null
  : SAFE_NAME.test(name) ? join(filesDir(cfg), name) : null;
const cached = (cfg: OriginalsConfig, name: string) => { const p = cachePath(cfg, name); return Boolean(p && existsSync(p)); };

/** Path of a cached original file, or null (unsafe name or not extracted). */
export function cachedFile(cfg: OriginalsConfig, name: string) {
  checkCacheSource(cfg);
  return cached(cfg, name) ? cachePath(cfg, name) : null;
}

function modReader(root: string, classic = false): ModReader {
  const product = resolve(root, '../RTSAI-Mod');
  const recovered = classic && existsSync(join(product, 'mods/rtsai-classic-core/mod.yaml'));
  const path = (p: string) => recovered && p.startsWith('mods/ra/')
    ? join(product, p.replace(/^mods\/ra\//, 'mods/rtsai-classic-core/'))
    : recovered && p.startsWith('mods/rtsai/') ? join(product, p)
    : join(root, existsSync(join(root, "engine")) ? p : p.replace(/^engine\//, ""));
  return { text: p => readFileSync(path(p), "utf8"), bytes: p => new Uint8Array(readFileSync(path(p))), exists: p => existsSync(path(p)) };
}

/** A minimal engine directory for OpenRA.Utility: the mod engine's mods, its mix database, and Support -> RA2 content. */
function ensureShim(cfg: OriginalsConfig) {
  const engine = cfg.mode === "classic" ? cfg.modRoot : join(cfg.modRoot, "engine");
  const shim = join(cfg.cacheDir, "engine-shim");
  mkdirSync(shim, { recursive: true });
  const link = (target: string, path: string) => { if (!existsSync(path)) symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir"); };
  link(join(engine, "mods"), join(shim, "mods"));
  link(cfg.supportDir, join(shim, "Support"));
  for (const f of ["global mix database.dat", "VERSION"]) if (!existsSync(join(shim, f)) && existsSync(join(engine, f))) copyFileSync(join(engine, f), join(shim, f));
  return shim;
}

/** The mod whose file system mounts the player's own files: the classic add-on (the standalone game mounts none). */
const extractMod = (cfg: OriginalsConfig) => (cfg.mode === "classic" ? "ra" : cfg.mode === "ra2yr" ? "studio-ra2yr" : "rtsai-classic");

const checkedCaches = new Set<string>();
/**
 * The cache holds only what `extractMod` read from the player's files. Earlier RA2 caches were extracted through the
 * standalone mod, which answers the EA names with its own stand-ins, so they start over once. Only plain files are
 * removed: the shim next to them links into the engine and the RA2 content.
 */
function checkCacheSource(cfg: OriginalsConfig) {
  if (checkedCaches.has(cfg.cacheDir)) return;
  const marker = join(cfg.cacheDir, "extracted-by.txt");
  const by = extractMod(cfg);
  const recorded = existsSync(marker) ? readFileSync(marker, "utf8").trim() : null;
  if (recorded !== by && !(recorded === null && cfg.mode === "classic")) {
    const dir = filesDir(cfg);
    if (existsSync(dir)) for (const f of readdirSync(dir, { withFileTypes: true })) if (f.isFile()) unlinkSync(join(dir, f.name));
    rmSync(join(cfg.cacheDir, "missing.json"), { force: true });
  }
  mkdirSync(cfg.cacheDir, { recursive: true });
  writeFileSync(marker, `${by}\n`);
  checkedCaches.add(cfg.cacheDir);
}

/**
 * The mod folders a manifest mounts (`ra2|<dir>` packages), last mounted first: the engine reads a bare file name from
 * the last mounted package that has it, named packages included (OpenRA.Game/FileSystem/FileSystem.cs).
 */
export function mountedDirs(reader: ModReader, manifest: string): string[] {
  const fs = parseMiniYaml(reader.text(manifest), manifest).find(n => n.key === "FileSystem")?.value;
  const packages = ["Packages", "SystemPackages", "ContentPackages"].flatMap(k => child(fs, k)?.value.nodes ?? []);
  return packages.flatMap(n => { const dir = /^~?ra2\|(.+)$/.exec(n.key.trim())?.[1]; return dir ? [`${MOD_DIR}/${dir}`] : []; }).reverse();
}

/** Extracts the player's original files with the mod's own engine. Returns the names it could not find. */
export async function extractOriginals(cfg: OriginalsConfig, names: string[]): Promise<string[]> {
  checkCacheSource(cfg);
  const out = filesDir(cfg);
  mkdirSync(out, { recursive: true });
  const missingFile = join(cfg.cacheDir, "missing.json");
  const known = new Set<string>(existsSync(missingFile) ? JSON.parse(readFileSync(missingFile, "utf8")) : []);
  const todo = names.filter(n => SAFE_NAME.test(n) && !cached(cfg, n) && !known.has(n));
  if (!todo.length) return names.filter(n => known.has(n));
  if (cfg.mode === "ra2yr") { if (!cfg.contentDir || !existsSync(join(cfg.contentDir, "ra2md.mix"))) throw new Error("No Yuri's Revenge install (set RTSAI_YR_DIR)"); ensureYrMod(cfg); }
  else if (!existsSync(join(cfg.supportDir, "Content", cfg.mode === "classic" ? "ra/v2" : "ra2", cfg.mode === "classic" ? "conquer.mix" : "ra2.mix"))) throw new Error(`No RA2 content at ${join(cfg.supportDir, "Content", "ra2")} (set RTSAI_RA2_SUPPORT)`);
  const shim = ensureShim(cfg);
  const bin = join(cfg.modRoot, cfg.mode === "classic" ? "bin" : "engine/bin");
  const [cmd, pre] = process.platform === "win32" ? [join(bin, "OpenRA.Utility.exe"), []] : ["dotnet", [join(bin, "OpenRA.Utility.dll")]];
  const env = { ...process.env, ENGINE_DIR: shim, MOD_SEARCH_PATHS: [join(cfg.modRoot, "mods"), ...(cfg.mode === "ra2yr" ? [join(cfg.cacheDir, "mods")] : [])].join(",") };
  const extract = (batch: string[]) => run(cmd, [...pre, extractMod(cfg), "--extract", ...batch], { cwd: out, env, windowsHide: true, timeout: 120_000 });
  // The utility extracts in order and stops at the first file it cannot find: that file is the first one still
  // missing, so note it and carry on with the rest (one extra launch per missing file).
  let rest = todo;
  while (rest.length) {
    const batch = rest.slice(0, 80);
    try {
      await extract(batch);
      rest = rest.slice(batch.length);
    } catch {
      const at = batch.findIndex(n => !cached(cfg, n));
      if (at < 0) { rest = rest.slice(batch.length); continue; }
      known.add(batch[at]);
      rest = rest.slice(at + 1);
    }
  }
  writeFileSync(missingFile, JSON.stringify([...known].sort(), null, 1));
  return names.filter(n => known.has(n));
}

/** PNG (RGBA, no filtering) for a decoded cameo frame. */
export function encodePng(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Palettes read from a file: Westwood .pal, or a mod's text palettes (PaletteFromGimpOrJascFile, e.g. OpenHV). */
const paletteTraits = (world: Parameters<typeof traits>[0]) => [...traits(world, "PaletteFromFile"), ...traits(world, "PaletteFromGimpOrJascFile")];

/** The temperate player palette and the cameo palette, read from the World rules as the game resolves them. */
function stockPalettes(data: ReturnType<typeof loadModData>) {
  const world = data.rules.get("world")!;
  const list = (v: string | null) => (v ?? "").split(",").map(x => x.trim()).filter(Boolean).map(Number);
  const fromFile = (name: string) => paletteTraits(world).map(([, n]) => n.value).find(v => childValue(v, "Name") === name && (!childValue(v, "Tileset") || childValue(v, "Tileset") === "TEMPERATE"));
  const player = fromFile("player");
  const remap = traits(world, "PlayerColorPalette").map(([, n]) => n.value).find(v => childValue(v, "BasePalette") === "player");
  const chrome = fromFile("chrome");
  const ref = (name: string, v: typeof player, remapIdx: number[]): PaletteRef | null => v ? {
    name, file: (childValue(v, "Filename") ?? "").toLowerCase(), remap: remapIdx, basePalette: name,
    transparent: child(v, "TransparentIndex") ? list(childValue(v, "TransparentIndex")) : [0], shadow: list(childValue(v, "ShadowIndex")),
    definedBy: `World PaletteFromFile (${name}, temperate)`,
  } : null;
  return { player: ref("player", player, list(childValue(remap, "RemapIndex"))), chrome: ref("chrome", chrome, []) };
}

/**
 * Whether a RequiresCondition expression holds on a unit standing on the map: conditions it grants itself at
 * spawn (GrantCondition, GrantConditionOnDeploy's undeployed condition) are on, every other one is off.
 * Supports ! && || and parentheses; anything else (comparisons) counts as off.
 */
export function conditionHolds(expression: string, granted: Set<string>): boolean {
  const tokens = expression.match(/!|&&|\|\||\(|\)|[A-Za-z0-9_.-]+|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const or = (): boolean => { let v = and(); while (peek() === "||") { i++; const r = and(); v = v || r; } return v; };
  const and = (): boolean => { let v = not(); while (peek() === "&&") { i++; const r = not(); v = v && r; } return v; };
  const not = (): boolean => { if (peek() === "!") { i++; return !not(); } return atom(); };
  const atom = (): boolean => {
    const t = tokens[i++];
    if (t === "(") { const v = or(); if (peek() === ")") i++; return v; }
    if (t && /^[A-Za-z_]/.test(t) && !/^[<>=]/.test(peek() ?? "")) return granted.has(t);
    while (i < tokens.length && tokens[i] !== "&&" && tokens[i] !== "||" && tokens[i] !== ")") i++;
    return false;
  };
  return or();
}

/** Conditions an actor grants itself as it spawns. */
function spawnConditions(actor: NonNullable<ReturnType<ReturnType<typeof loadModData>["rules"]["get"]>>) {
  const granted = new Set<string>();
  for (const [, node] of traits(actor, "GrantCondition")) {
    const c = childValue(node.value, "Condition");
    if (c && !childValue(node.value, "RequiresCondition")) granted.add(c);
  }
  for (const [, node] of traits(actor, "GrantConditionOnDeploy")) {
    const c = childValue(node.value, "UndeployedCondition");
    if (c) granted.add(c);
  }
  return granted;
}

const memo = new Map<string, Promise<RosterPayload>>();

/** Resolve only a recorded effect's sequence, into the same private cache as units. No public assets. */
let visualQueue: Promise<unknown> = Promise.resolve();
const visualMemo=new Map<string,ReturnType<typeof resolveVisualPayload>>();
export function visualPayload(cfg: OriginalsConfig, image: string, sequence: string, palette: string) {
  const key=`${cfg.modRoot}:${image}:${sequence}:${palette}`;
  const hit=visualMemo.get(key);if(hit)return hit;
  const pending=visualQueue.then(()=>resolveVisualPayload(cfg,image,sequence,palette));
  visualQueue=pending.catch(()=>undefined);visualMemo.set(key,pending);
  if(visualMemo.size>128)visualMemo.delete(visualMemo.keys().next().value!);
  pending.catch(()=>visualMemo.delete(key));return pending;
}
async function resolveVisualPayload(cfg: OriginalsConfig, image: string, sequence: string, palette: string) {
  if (![image, sequence, palette].every(s => SAFE_NAME.test(s))) throw new Error("Invalid effect reference");
  checkCacheSource(cfg);
  const reader = modReader(cfg.modRoot, cfg.mode === 'classic');
  const loaded = cfg.mode === "classic" ? loadClassicData(reader) : loadDefaultExperienceData(reader);
  const img = loaded.sequences.get(image), seq = img && child(img, sequence);
  if (!img || !seq) throw new Error("No such effect sequence");
  const data = { ...loaded, sequences: new Map([[image, { ...img, nodes: img.nodes.filter(n => n.key === "Defaults" || n.key === sequence) }]]) };
  const world = loaded.rules.get("world")!;
  const pal = paletteTraits(world).map(([, n]) => n.value).find(v => childValue(v, "Name") === palette && (!childValue(v, "Tileset") || ["TEMPERATE", "TEMPERAT"].includes(childValue(v, "Tileset")!)));
  // Classic palettes also come from the current tileset. The existing temperate player palette is identical.
  const palFile = childValue(pal, "Filename") ?? stockPalettes(loaded).player?.file;
  if (!palFile) throw new Error("No local effect palette");
  const numbers = (s: string | null) => (s ?? "").split(",").filter(Boolean).map(Number);
  const wanted = new Set<string>([palFile]);
  const actor = parseMiniYaml(`effect:\n\tRenderSprites:\n\t\tImage: ${image}\n\t\tPalette: ${palette}\n\tWithSpriteBody:\n\t\tSequence: ${sequence}\n`)[0].value;
  const ownFile = (path: string) => {
    const name = `${createHash("sha256").update(path).digest("hex").slice(0, 12)}-${basename(path).toLowerCase()}`;
    if (!SAFE_NAME.test(name) || !reader.exists(path)) throw new Error("Missing effect file");
    mkdirSync(join(cfg.cacheDir, "owned-files"), { recursive: true });
    writeFileSync(join(cfg.cacheDir, "owned-files", name), reader.bytes(path));
    return `owned/${name}`;
  };
  // Effects play as the game ships: in RA2 mode a bare name is the standalone mod's own file (its stand-ins included).
  const dirs = cfg.mode === "classic" ? ["mods/ra/bits"] : mountedDirs(reader, `${MOD_DIR}/mod.yaml`);
  const local = (name: string) => {
    if (!name.includes("|")) { const dir = dirs.find(d => reader.exists(`${d}/${name}`)); return dir ? ownFile(`${dir}/${name}`) : null; }
    const path = name.replace(/^ra2\|/, "mods/rtsai/").replace(/^ra\|/, "mods/ra/").replace(/^common\|/, cfg.mode === "classic" ? "mods/common/" : "engine/mods/common/");
    return reader.exists(path) ? ownFile(path) : null;
  };
  const context = (record: (name: string) => string | null) => ({ palettes: {}, normalsTypes: worldNormals(data), recordFile: ownFile, ra2: { record, bytes: (name: string) => cached(cfg, name) ? new Uint8Array(readFileSync(cachePath(cfg, name)!)) : new Uint8Array(0) } });
  // A Combine sequence (e.g. ^WithMachineGunMuzzle: one mgun-<facing>.shp per facing) is its pieces' frames in order.
  const combine = child(seq.value, "Combine")?.value.nodes.map(n => ({
    filename: childValue(n.value, "Filename") ?? "", start: Number(childValue(n.value, "Start") ?? 0),
    length: childValue(n.value, "Length") === "*" ? "*" as const : Number(childValue(n.value, "Length") ?? 1),
    offset: (childValue(n.value, "Offset") ?? "0,0").split(",").map(v => Number(v.trim()) || 0).slice(0, 2) as [number, number],
  })) ?? null;
  if (combine) {
    if (!combine.length || !combine.every(p => p.filename && (p.filename.includes("|") || SAFE_NAME.test(p.filename.toLowerCase())))) throw new Error("Unsupported combined effect");
    for (const p of combine) if (!local(p.filename)) wanted.add(p.filename.toLowerCase());
  } else resolveActor(reader, data, "effect", actor, null, context(n => local(n) ?? (wanted.add(n), null)));
  const paletteKey = local(palFile) ?? palFile;
  wanted.delete(palFile); if (!paletteKey.startsWith("owned/")) wanted.add(paletteKey);
  await extractOriginals(cfg, [...wanted]);
  if (combine) {
    const files = combine.map(p => local(p.filename) ?? p.filename.toLowerCase());
    if (!files.every(f => cached(cfg, f)) || !cached(cfg, paletteKey)) throw new Error("Effect is unavailable locally");
    const url = (key: string) => key.startsWith("owned/") ? `/api/art-review/mod/${key.slice(6)}?mode=${cfg.mode ?? "ra2"}` : `/api/art-review/${cfg.mode === "classic" ? "classic" : "ra2"}/${key}`;
    const field = (key: string) => childValue(seq.value, key) ?? childValue(child(img, "Defaults")?.value, key);
    const facings = Math.abs(Number(field("Facings") ?? 1)) || 1, length = field("Length") === "*" ? "*" as const : Number(field("Length") ?? 1);
    const combined: SpriteSequence = {
      name: sequence, file: null, external: null, start: Number(field("Start") ?? 0), length, stride: Number(field("Stride") ?? (typeof length === "number" ? length : 0)),
      facings, reverseFacings: Number(field("Facings") ?? 1) < 0, useClassicFacings: false, transpose: /^true$/i.test(field("Transpose") ?? ""), tick: Number(field("Tick") ?? 40),
      zOffset: 0, shadowStart: -1, offset: [0, 0, 0], frames: null, reverses: false, usedBy: ["WithMuzzleOverlay"], inherited: false,
    };
    return {
      sequence: combined, combine: combine.map((p, i) => ({ file: url(files[i]), start: p.start, length: p.length, offset: p.offset })),
      palette: { name: palette, url: url(paletteKey), transparent: [0], shadow: numbers(childValue(pal, "ShadowIndex")), remap: [] } satisfies PaletteSpec,
    };
  }
  const resolved = resolveActor(reader, data, "effect", actor, null, context(n => local(n) ?? (cached(cfg, n) ? n : null)));
  const q = resolved.sprite?.sequences.find(s => s.name === sequence && s.file);
  if (!q || !cached(cfg, paletteKey)) throw new Error("Effect is unavailable locally");
  const url = (key: string) => key.startsWith("owned/") ? `/api/art-review/mod/${key.slice(6)}?mode=${cfg.mode ?? "ra2"}` : `/api/art-review/${cfg.mode === "classic" ? "classic" : "ra2"}/${key}`;
  return { sequence: { ...q, file: url(q.file!) }, palette: { name: palette, url: url(paletteKey), transparent: [0], shadow: numbers(childValue(pal, "ShadowIndex")), remap: [] } satisfies PaletteSpec };
}

/** Every faction's roster, with the original units' art resolved from the local RA2 cache (extracting on demand). */
export function rosterPayload(cfg: OriginalsConfig, refresh = false): Promise<RosterPayload> {
  const key = `${cfg.mode ?? "ra2"}|${cfg.modRoot}`;
  if (!refresh && memo.has(key)) return memo.get(key)!;
  const payload = buildPayload(cfg);
  memo.set(key, payload);
  payload.catch(() => { if (memo.get(key) === payload) memo.delete(key); });
  return payload;
}

async function buildPayload(cfg: OriginalsConfig): Promise<RosterPayload> {
  const started = Date.now();
  checkCacheSource(cfg);
  const reader = modReader(cfg.modRoot, cfg.mode === 'classic');
  let provenance: ProvenanceRecord | null = null;
  try { provenance = JSON.parse(reader.text(`mods/${cfg.mode === "classic" ? "ra" : "rtsai"}/modern-factions/ART-PROVENANCE.json`)); } catch { /* Unknown authorship stays unknown. */ }
  const data = cfg.mode === "classic" ? loadClassicData(reader) : loadDefaultExperienceData(reader);
  const { factions, stock: stockInfo } = computeRosters(data);
  const ids = new Set<string>();
  for (const f of factions) for (const u of f.units) { ids.add(u.id); if (u.reference) ids.add(u.reference); }
  const run: StockRun = { cfg, reader, provenance, ownedPaths: new Map(), extraction: { requested: 0, cached: 0, missing: [], error: null } };
  // RA2: the game as it ships reads no player file, so its art (the stand-ins under EA names included) is the mod's own.
  const stock = await resolveStock(run, data, ids, stockInfo, factions, cfg.mode === "classic"
    ? { dirs: ["bits", "bits/structures", "bits/animations", "bits/projectiles", "uibits"].map(d => `mods/ra/${d}`), content: cfg, rules: "Recovered Classic · RTSAI-Mod" }
    : { dirs: mountedDirs(reader, `${MOD_DIR}/mod.yaml`), content: null, rules: "RTS AI · RTSAI-Mod" });
  // The original countries as the classic add-on plays them: Westwood's art from the player's own files.
  let originals: Pick<RosterPayload, "originals" | "countries"> = {};
  if (cfg.mode !== "classic" && reader.exists(`${CLASSIC_DIR}/mod.yaml`)) {
    const classic = loadModData(reader, { manifestPath: `${CLASSIC_DIR}/mod.yaml` });
    const rosters = computeRosters(classic);
    const countries = rosters.factions.filter(f => !(MODERN_FACTIONS as readonly string[]).includes(f.id));
    const countryIds = new Set(countries.flatMap(f => f.units.map(u => u.id)));
    originals = {
      countries: countries.map(f => f.id),
      originals: await resolveStock(run, classic, countryIds, rosters.stock, rosters.factions, { dirs: mountedDirs(reader, `${CLASSIC_DIR}/mod.yaml`), content: cfg, rules: "RTS AI Classic add-on · RTSAI-Mod" }),
    };
  }
  return { mode: cfg.mode === "classic" ? "classic" : "ra2", factions, stock, ...originals, unresolved: [...ids].filter(id => !stock[id]), extraction: { ...run.extraction, ms: Date.now() - started } };
}

export type StockRun = {
  /** Where the mod's own files are copied (owned-files) and which mode serves them. */
  cfg: OriginalsConfig; reader: ModReader; provenance: ProvenanceRecord | null; ownedPaths: Map<string, string>;
  extraction: Omit<RosterPayload["extraction"], "ms">;
};
export type StockOptions = {
  /** Mod folders that override the player's files, last mounted first. */
  dirs: string[];
  /** Mod folders mounted before the player's files: used only for names those files lack. */
  low?: string[];
  /** The player's own files a bare name falls back to (extracted into that config's cache), or none. */
  content: OriginalsConfig | null;
  rules: string;
  /** `alias|path` file references; RTS AI's own packages by default. */
  packages?: (ref: string) => string | null;
  /** True for `alias|name` where the alias is an archive of the owned game (RV's `conquer|gi.shp`): read as `name`. */
  archive?: (ref: string) => boolean;
  /** The `mode` the owned-file route needs to find this run's cache (default: the config's mode). */
  modeParam?: string;
  /** A palette the rules name but define in the mod's own code (Cameo's player_rgba): drawn with this one instead. */
  paletteFallback?: string;
  /** Credits for a file: the default reads RTS AI's provenance record. */
  source?: (file: string, path: string | undefined, bytes: () => Uint8Array) => AssetSource;
};

/**
 * Resolves `ids` with one game's rules. A bare file name is read from `dirs` (the mod folders that game mounts, last
 * mounted first), then from the player's own files (`content`), then from `low`.
 */
export async function resolveStock(run: StockRun, data: ModData, ids: Set<string>, stockInfo: Record<string, RosterUnit>, factions: FactionRoster[], opts: StockOptions): Promise<Record<string, StockArt>> {
  const { cfg, reader, ownedPaths, provenance } = run;
  const content = opts.content;
  if (content) checkCacheSource(content);
  // Owned files live in this run's cache; bare names are the player's files in the content cache.
  const pathOf = (n: string) => (n.startsWith("owned/") ? cachePath(cfg, n) : content ? cachePath(content, n) : null);
  const has = (n: string) => { const p = pathOf(n); return Boolean(p && existsSync(p)); };
  const palettes = stockPalettes(data);
  const paletteRefs: Record<string, PaletteRef> = {};
  const world = data.rules.get("world")!;
  const numbers = (s: string | null) => (s ?? "").split(",").filter(x => x.trim()).map(x => Number(x.trim())).filter(Number.isFinite);
  const ownFile = (path: string) => {
    const name = `${createHash("sha256").update(path).digest("hex").slice(0, 12)}-${basename(path).toLowerCase()}`;
    if (!SAFE_NAME.test(name) || !reader.exists(path)) throw new Error(`Missing mod art: ${path}`);
    ownedPaths.set(`owned/${name}`, path);
    mkdirSync(join(cfg.cacheDir, "owned-files"), { recursive: true });
    writeFileSync(join(cfg.cacheDir, "owned-files", name), reader.bytes(path));
    return `owned/${name}`;
  };
  const packages = opts.packages ?? ((n: string) => n.replace(/^ra\|/, "mods/ra/").replace(/^ra2\|/, "mods/rtsai/").replace(/^classic\|/, `${CLASSIC_DIR}/`).replace(/^common\|/, "engine/mods/common/"));
  const inDirs = (dirs: string[], n: string) => dirs.map(d => `${d}/${n}`).find(p => reader.exists(p));
  const local = new Map<string, string | null>();
  const bareOf = (n: string) => (n.includes("|") && opts.archive?.(n) ? n.slice(n.indexOf("|") + 1) : n);
  const localRef = (ref: string): string | null => {
    const n = bareOf(ref);
    if (n.startsWith("owned/")) return n;
    if (!local.has(n)) {
      const path = n.includes("|") ? packages(n) : inDirs(opts.dirs, n);
      local.set(n, path && reader.exists(path) ? ownFile(path) : null);
    }
    return local.get(n)!;
  };
  // Below the player's files: a mod folder mounted before them answers only what they lack.
  const lowRef = (ref: string) => { const n = bareOf(ref); if (n.includes("|") || !opts.low?.length) return null; const p = inDirs(opts.low, n); return p ? ownFile(p) : null; };
  // The resolver reads some files back by the name the rules use (voxels): the mod's own copy when it has one.
  const keyOf = (ref: string) => { const n = bareOf(ref); return localRef(n) ?? (has(n) ? n : lowRef(n) ?? n); };
  for (const [, node] of paletteTraits(world)) {
    if (childValue(node.value, "Tileset") && !["TEMPERATE", "TEMPERAT"].includes(childValue(node.value, "Tileset")!)) continue;
    const name = childValue(node.value, "Name") ?? "", ref = (childValue(node.value, "Filename") ?? "").toLowerCase();
    const file = localRef(ref) ?? ref;
    if (!SAFE_NAME.test(file.replace(/^owned\//, ""))) continue;
    paletteRefs[name] = { name, file, basePalette: name, remap: [], transparent: child(node.value, "TransparentIndex") ? numbers(childValue(node.value, "TransparentIndex")) : [0], shadow: numbers(childValue(node.value, "ShadowIndex")), definedBy: "Merged World rules" };
  }
  // Player-colour palettes, mods' own kinds included (CA's OverlayPlayerColorPalette); alpha variants keep the base colours.
  for (const node of world.nodes) {
    const remap = /^[A-Za-z]*PlayerColorPalette(@|$)/.test(node.key), alpha = /^PaletteFromPlayerPaletteWithAlpha(@|$)/.test(node.key);
    if (!remap && !alpha) continue;
    const base = paletteRefs[childValue(node.value, "BasePalette") ?? ""];
    if (base) paletteRefs[childValue(node.value, "BaseName") ?? childValue(node.value, "Name") ?? base.name] = remap ? { ...base, remap: numbers(childValue(node.value, "RemapIndex")) } : { ...base };
  }
  // The default player remap may retain its base name.
  if (palettes.player && paletteRefs.player) paletteRefs.player.remap = palettes.player.remap;
  const chromeFile = palettes.chrome ? localRef(palettes.chrome.file!) ?? palettes.chrome.file! : null;
  const normalsTypes = worldNormals(data);
  const resolveAll = (ra2: Ra2Hook) => {
    const out = new Map<string, ReturnType<typeof resolveActor>>();
    for (const id of ids) {
      const actor = data.rules.get(id);
      if (!actor) continue;
      try { out.set(id, resolveActor(reader, data, id, actor, null, { palettes: paletteRefs, normalsTypes, recordFile: ownFile, ra2 })); } catch { /* reported as missing art */ }
    }
    return out;
  };

  // Pass 1: which of the player's files the game would read for these actors.
  const wanted = new Set<string>([...Object.values(paletteRefs).map(p => p.file!), chromeFile ?? ""].filter(f => f && !f.startsWith("owned/")));
  resolveAll({ record: n => localRef(n) ?? (wanted.add(bareOf(n)), null), bytes: n => has(keyOf(n)) ? new Uint8Array(readFileSync(pathOf(keyOf(n))!)) : new Uint8Array(0) });
  let missing = [...wanted];
  if (content) {
    try { missing = await extractOriginals(content, [...wanted]); } catch (e) { run.extraction.error = e instanceof Error ? e.message : String(e); }
  }
  run.extraction.requested += wanted.size;
  run.extraction.cached += [...wanted].filter(n => has(n)).length;
  run.extraction.missing.push(...missing.filter(n => !lowRef(n) && !run.extraction.missing.includes(n)));

  // Pass 2: resolve with the extracted bytes.
  const bytes = (n: string) => new Uint8Array(readFileSync(pathOf(keyOf(n))!));
  const resolved = resolveAll({ record: ref => { const n = bareOf(ref); return localRef(n) ?? (has(n) ? n : lowRef(n)); }, bytes });
  const ownedMode = encodeURIComponent(opts.modeParam ?? cfg.mode ?? "ra2");
  const url = (key: string | null | undefined) => (key ? key.startsWith("owned/") ? `/api/art-review/mod/${encodeURIComponent(key.slice(6))}?mode=${ownedMode}` : `${content?.mode === "classic" ? "/api/art-review/classic/" : content?.mode === "ra2yr" ? "/api/art-review/ra2yr/" : RA2_ROUTE}${encodeURIComponent(key)}` : null);
  const paletteFile = (p: PaletteRef) => (has(p.file!) ? p.file! : lowRef(p.file!));
  const paletteSpec = (p: PaletteRef | null): PaletteSpec | null => { const file = p && paletteFile(p); return p && file ? { name: p.name, url: url(file)!, remap: p.remap, transparent: p.transparent, shadow: p.shadow } : null; };
  const chromeKey = chromeFile && (has(chromeFile) ? chromeFile : lowRef(chromeFile));
  const chromePal = palettes.chrome && chromeKey ? decodePal(bytes(chromeKey), palettes.chrome.transparent, palettes.chrome.shadow) : null;
  const bitsFiles = new Set<string>();
  if (!opts.packages) for (const dir of ["bits", "bits/cameos", "bits/structures", "bits/animations", "bits/projectiles"]) {
    try { for (const f of readdirSync(join(cfg.modRoot, MOD_DIR, dir))) bitsFiles.add(f.toLowerCase()); } catch { /* absent */ }
  }

  const stock: Record<string, StockArt> = {};
  for (const [id, art] of resolved) {
    // Cameos become PNGs once (cameo.pal, frame 0), so the unit list shows static images only.
    let cameoUrl: string | null = null;
    if (art.cameo.file?.endsWith(".png")) cameoUrl = url(art.cameo.file);
    else if (art.cameo.file && chromePal) {
      const png = `${art.cameo.file.replace(/\.shp$/, "")}.png`;
      if (!has(png)) {
        try {
          const shp = decodeShp(bytes(art.cameo.file));
          writeFileSync(pathOf(png)!, encodePng(shp.width, shp.height, drawShpFrame(shp, 0, chromePal)));
        } catch { /* leave without a cameo */ }
      }
      if (has(png)) cameoUrl = url(png);
    }
    // Stock sequences arrive through templates (^ArmedInfantry); every one an always-on trait uses is what the
    // game draws. Turrets, overlays and bodies behind a condition that is off by default (a GI's sandbagged
    // `deployed` turret, the mind-control overlay) stay out, as they do on a unit standing on the map.
    const actor = data.rules.get(id)!;
    const granted = spawnConditions(actor);
    const conditional = new Set<string>();
    for (const [trait, fallback] of [["WithSpriteTurret", "turret"], ["WithIdleOverlay", "idle-overlay"], ["WithSpriteBody", "idle"], ["WithFacingSpriteBody", "idle"]] as const) {
      for (const [, node] of traits(actor, trait)) {
        const otherImage = childValue(node.value, "Image");
        if (otherImage && otherImage.toLowerCase() !== art.sprite?.image.toLowerCase()) continue;
        const condition = childValue(node.value, "RequiresCondition");
        if (condition && !conditionHolds(condition, granted)) conditional.add(childValue(node.value, "Sequence") ?? fallback);
      }
    }
    const sprite = art.sprite ? {
      ...art.sprite,
      overlays: art.sprite.overlays?.filter(o => !o.requiresCondition || conditionHolds(o.requiresCondition, granted)),
      turret: art.sprite.turret && !conditional.has(art.sprite.turret.sequence) ? art.sprite.turret : null,
      sequences: art.sprite.sequences.map(q => (q.file && q.name !== "icon" ? { ...q, inherited: false } : q)),
    } : null;
    const owned = { ...art, sprite, factionId: "" };
    const spec = buildRenderSpec(owned, url, name => paletteSpec(paletteRefs[name ?? "player"] ?? (opts.paletteFallback ? paletteRefs[opts.paletteFallback] ?? null : null)), cameoUrl);
    const sourceOf = (file: string) => (opts.source ?? ((f, path, read) => localAssetSource(f, (content?.mode ?? cfg.mode) === "classic" ? "classic" : "ra2", path, read, provenance)))(file, ownedPaths.get(file), () => bytes(file));
    const files = art.files.map(sourceOf);
    // The model is the unit's own files: shared effects drawn over it (muzzle flashes, the mind-control overlay) are
    // credited in the file list, not to the model, once the actor has art of its own.
    // PNG sheets are the model only for a unit drawn without SHP or voxels (OpenHV); elsewhere they are shared effects.
    const native = art.files.filter(f => /\.(vxl|hva|shp)$/.test(f) && f !== art.cameo.file);
    const modelFiles = native.length ? native : art.files.filter(f => /\.png$/.test(f) && f !== art.cameo.file);
    const own = modelFiles.filter(f => ownedPaths.has(f));
    const model = combineSources((own.length ? own : modelFiles).map(sourceOf), "Current model");
    const icon = art.cameo.file ? sourceOf(art.cameo.file) : combineSources([], "Current icon");
    stock[id] = { spec, sprite: spriteWithUrlsOf(sprite, url), files: art.files, fromModBits: art.files.filter(f => bitsFiles.has(f)), info: stockInfo[id] ?? factions.flatMap(f => f.units).find(u => u.id === id) ?? null, behavior: behaviorFacts(data, id), ruleKey: data.ruleKeys.get(id), sources: { model, icon, files, rules: opts.rules } };
  }
  return stock;
}
