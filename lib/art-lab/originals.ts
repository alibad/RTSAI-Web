/**
 * Original RA2 art for the dev-only Review (Node only; imported solely by review-server.ts).
 *
 * Original Westwood files are EA copyright and stay LOCAL: they are extracted from the player's own RA2 content
 * by the mod's engine (`OpenRA.Utility rtsai --extract`, which reads the encrypted MIX headers and mounts the
 * mod's packages exactly as the game does) into a gitignored cache, and served only by the dev review API,
 * which answers 404 in production. Nothing here is imported by any page, and nothing is copied into public/.
 *
 * The engine looks for content under `<EngineDir>/Support`; a small shim directory in the cache gives it one,
 * linking the mod engine's `mods` and the existing RA2 content, so no other repository is touched.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { crc32, deflateSync } from "node:zlib";
import { child, childValue, traits } from "./miniyaml";
import { decodePal } from "./pal";
import { buildRenderSpec, spriteWithUrlsOf } from "./render-spec";
import { loadModData, MOD_DIR, resolveActor, worldNormals, type ModReader, type Ra2Hook } from "./resolve";
import { behaviorFacts, type BehaviorFacts } from "./behavior";
import { loadClassicData } from "./classic";
import { computeRosters, type FactionRoster, type RosterUnit } from "./roster";
import { decodeShp } from "./shp";
import type { PaletteSpec, RenderSpec } from "./spec";
import { drawShpFrame } from "./sprite-render";
import type { PaletteRef, SpriteArt } from "./types";

const run = promisify(execFile);

export type OriginalsConfig = {
  /** RTSAI-Mod checkout (rules, sequences, the engine and its OpenRA.Utility). */
  modRoot: string;
  mode?: "ra2" | "classic";
  /** Directory holding Content/ra2 (ra2.mix, language.mix): the player's RA2 data. */
  supportDir: string;
  /** Gitignored cache for extracted files. */
  cacheDir: string;
};

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

export type StockArt = { spec: RenderSpec; sprite: SpriteArt | null; files: string[]; fromModBits: string[]; info: RosterUnit | null; behavior: BehaviorFacts; ruleKey?: string };
export type RosterPayload = {
  mode?: "ra2" | "classic";
  factions: FactionRoster[];
  unresolved?: string[];
  stock: Record<string, StockArt>;
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
  return cached(cfg, name) ? cachePath(cfg, name) : null;
}

function modReader(root: string): ModReader {
  const path = (p: string) => join(root, existsSync(join(root, "engine")) ? p : p.replace(/^engine\//, ""));
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

/** Extracts RA2 files with the mod's own engine. Returns the names it could not find. */
export async function extractOriginals(cfg: OriginalsConfig, names: string[]): Promise<string[]> {
  const out = filesDir(cfg);
  mkdirSync(out, { recursive: true });
  const missingFile = join(cfg.cacheDir, "missing.json");
  const known = new Set<string>(existsSync(missingFile) ? JSON.parse(readFileSync(missingFile, "utf8")) : []);
  const todo = names.filter(n => SAFE_NAME.test(n) && !cached(cfg, n) && !known.has(n));
  if (!todo.length) return names.filter(n => known.has(n));
  if (!existsSync(join(cfg.supportDir, "Content", cfg.mode === "classic" ? "ra/v2" : "ra2", cfg.mode === "classic" ? "conquer.mix" : "ra2.mix"))) throw new Error(`No RA2 content at ${join(cfg.supportDir, "Content", "ra2")} (set RTSAI_RA2_SUPPORT)`);
  const shim = ensureShim(cfg);
  const bin = join(cfg.modRoot, cfg.mode === "classic" ? "bin" : "engine/bin");
  const [cmd, pre] = process.platform === "win32" ? [join(bin, "OpenRA.Utility.exe"), []] : ["dotnet", [join(bin, "OpenRA.Utility.dll")]];
  const env = { ...process.env, ENGINE_DIR: shim, MOD_SEARCH_PATHS: join(cfg.modRoot, "mods") };
  const extract = (batch: string[]) => run(cmd, [...pre, cfg.mode === "classic" ? "ra" : "rtsai", "--extract", ...batch], { cwd: out, env, windowsHide: true, timeout: 120_000 });
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

/** The temperate player palette and the cameo palette, read from the World rules as the game resolves them. */
function stockPalettes(data: ReturnType<typeof loadModData>) {
  const world = data.rules.get("world")!;
  const list = (v: string | null) => (v ?? "").split(",").map(x => x.trim()).filter(Boolean).map(Number);
  const fromFile = (name: string) => traits(world, "PaletteFromFile").map(([, n]) => n.value).find(v => childValue(v, "Name") === name && (!childValue(v, "Tileset") || childValue(v, "Tileset") === "TEMPERATE"));
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
  const reader = modReader(cfg.modRoot);
  const data = cfg.mode === "classic" ? loadClassicData(reader) : loadModData(reader);
  const { factions, stock: stockInfo } = computeRosters(data);
  const ids = new Set<string>();
  for (const f of factions) for (const u of f.units) { ids.add(u.id); if (u.reference) ids.add(u.reference); }
  const palettes = stockPalettes(data);
  const paletteRefs: Record<string, PaletteRef> = {};
  const world = data.rules.get("world")!;
  const numbers = (s: string | null) => (s ?? "").split(",").filter(x => x.trim()).map(x => Number(x.trim())).filter(Number.isFinite);
  const ownFile = (path: string) => {
    const name = `${createHash("sha256").update(path).digest("hex").slice(0, 12)}-${basename(path).toLowerCase()}`;
    if (!SAFE_NAME.test(name) || !reader.exists(path)) throw new Error(`Missing mod art: ${path}`);
    mkdirSync(join(cfg.cacheDir, "owned-files"), { recursive: true });
    writeFileSync(join(cfg.cacheDir, "owned-files", name), reader.bytes(path));
    return `owned/${name}`;
  };
  for (const [, node] of traits(world, "PaletteFromFile")) {
    if (childValue(node.value, "Tileset") && childValue(node.value, "Tileset") !== "TEMPERATE") continue;
    const name = childValue(node.value, "Name") ?? "", ref = childValue(node.value, "Filename") ?? "";
    const file = ref.includes("|") ? ownFile(ref.replace(/^ra2\|/, "mods/rtsai/").replace(/^ra\|/, "mods/ra/")) : ref.toLowerCase();
    if (!SAFE_NAME.test(file.replace(/^owned\//, ""))) continue;
    paletteRefs[name] = { name, file, basePalette: name, remap: [], transparent: child(node.value, "TransparentIndex") ? numbers(childValue(node.value, "TransparentIndex")) : [0], shadow: numbers(childValue(node.value, "ShadowIndex")), definedBy: "Merged World rules" };
  }
  for (const [, node] of traits(world, "PlayerColorPalette")) {
    const base = paletteRefs[childValue(node.value, "BasePalette") ?? ""];
    if (base) paletteRefs[childValue(node.value, "BaseName") ?? childValue(node.value, "Name") ?? base.name] = { ...base, remap: numbers(childValue(node.value, "RemapIndex")) };
  }
  // The default player remap may retain its base name.
  if (palettes.player && paletteRefs.player) paletteRefs.player.remap = palettes.player.remap;
  const normalsTypes = worldNormals(data);
  const outside = ownFile;
  const resolveAll = (ra2: Ra2Hook) => {
    const out = new Map<string, ReturnType<typeof resolveActor>>();
    for (const id of ids) {
      const actor = data.rules.get(id);
      if (!actor) continue;
      try { out.set(id, resolveActor(reader, data, id, actor, null, { palettes: paletteRefs, normalsTypes, recordFile: outside, ra2 })); } catch { /* reported as missing art */ }
    }
    return out;
  };

  // Pass 1: which RA2 files the game would read for these actors.
  const wanted = new Set<string>(Object.values(paletteRefs).map(p => p.file!).filter(Boolean));
  const localRef = (n: string): string | null => {
    if (n.includes("|")) {
      const path = n.replace(/^ra\|/, "mods/ra/").replace(/^ra2\|/, "mods/rtsai/").replace(/^common\|/, "engine/mods/common/");
      return reader.exists(path) ? ownFile(path) : null;
    }
    const dir = cfg.mode === "classic" ? "mods/ra" : MOD_DIR;
    for (const sub of ["bits", "bits/structures", "bits/animations", "bits/projectiles", "uibits"]) if (reader.exists(`${dir}/${sub}/${n}`)) return ownFile(`${dir}/${sub}/${n}`);
    return null;
  };
  resolveAll({ record: n => localRef(n) ?? (wanted.add(n), null), bytes: n => cached(cfg, n) ? new Uint8Array(readFileSync(cachePath(cfg, n)!)) : new Uint8Array(0) });
  let error: string | null = null;
  let missing: string[] = [];
  try { missing = await extractOriginals(cfg, [...wanted]); } catch (e) { error = e instanceof Error ? e.message : String(e); }

  // Pass 2: resolve with the extracted bytes.
  const bytes = (n: string) => new Uint8Array(readFileSync(cachePath(cfg, n)!));
  const resolved = resolveAll({ record: n => localRef(n) ?? (cached(cfg, n) ? n : null), bytes });
  const url = (key: string | null | undefined) => (key ? key.startsWith("owned/") ? `/api/art-review/mod/${encodeURIComponent(key.slice(6))}?mode=${cfg.mode ?? "ra2"}` : `${cfg.mode === "classic" ? "/api/art-review/classic/" : RA2_ROUTE}${encodeURIComponent(key)}` : null);
  const paletteSpec = (p: PaletteRef | null): PaletteSpec | null => (p && cached(cfg, p.file!) ? { name: p.name, url: url(p.file)!, remap: p.remap, transparent: p.transparent, shadow: p.shadow } : null);
  const chromePal = palettes.chrome && cached(cfg, palettes.chrome.file!) ? decodePal(bytes(palettes.chrome.file!), palettes.chrome.transparent, palettes.chrome.shadow) : null;
  const bitsFiles = new Set<string>();
  for (const dir of ["bits", "bits/cameos", "bits/structures", "bits/animations", "bits/projectiles"]) {
    try { for (const f of readdirSync(join(cfg.modRoot, MOD_DIR, dir))) bitsFiles.add(f.toLowerCase()); } catch { /* absent */ }
  }

  const stock: Record<string, StockArt> = {};
  for (const [id, art] of resolved) {
    // Cameos become PNGs once (cameo.pal, frame 0), so the unit list shows static images only.
    let cameoUrl: string | null = null;
    if (art.cameo.file?.endsWith(".png")) cameoUrl = url(art.cameo.file);
    else if (art.cameo.file && chromePal) {
      const png = `${art.cameo.file.replace(/\.shp$/, "")}.png`;
      if (!cached(cfg, png)) {
        try {
          const shp = decodeShp(bytes(art.cameo.file));
          writeFileSync(cachePath(cfg, png)!, encodePng(shp.width, shp.height, drawShpFrame(shp, 0, chromePal)));
        } catch { /* leave without a cameo */ }
      }
      if (cached(cfg, png)) cameoUrl = url(png);
    }
    // Stock sequences arrive through templates (^ArmedInfantry); every one an always-on trait uses is what the
    // game draws. Turrets, overlays and bodies behind a condition that is off by default (a GI's sandbagged
    // `deployed` turret, the mind-control overlay) stay out, as they do on a unit standing on the map.
    const actor = data.rules.get(id)!;
    const granted = spawnConditions(actor);
    const conditional = new Set<string>();
    for (const [trait, fallback] of [["WithSpriteTurret", "turret"], ["WithIdleOverlay", "idle-overlay"], ["WithSpriteBody", "idle"]] as const) {
      for (const [, node] of traits(actor, trait)) {
        const condition = childValue(node.value, "RequiresCondition");
        if (condition && !conditionHolds(condition, granted)) conditional.add(childValue(node.value, "Sequence") ?? fallback);
      }
    }
    const sprite = art.sprite ? {
      ...art.sprite,
      turret: art.sprite.turret && !conditional.has(art.sprite.turret.sequence) ? art.sprite.turret : null,
      sequences: art.sprite.sequences.map(q => (q.file && q.name !== "icon" ? { ...q, inherited: false } : q)),
    } : null;
    const owned = { ...art, sprite, factionId: "" };
    const spec = buildRenderSpec(owned, url, name => paletteSpec(paletteRefs[name ?? "player"] ?? null), cameoUrl);
    stock[id] = { spec, sprite: spriteWithUrlsOf(sprite, url), files: art.files, fromModBits: art.files.filter(f => bitsFiles.has(f)), info: stockInfo[id] ?? factions.flatMap(f => f.units).find(u => u.id === id) ?? null, behavior: behaviorFacts(data, id), ruleKey: data.ruleKeys.get(id) };
  }
  return { mode: cfg.mode ?? "ra2", factions, stock, unresolved: [...ids].filter(id => !stock[id]), extraction: { requested: wanted.size, cached: [...wanted].filter(n => cached(cfg, n)).length, missing, error, ms: Date.now() - started } };
}
