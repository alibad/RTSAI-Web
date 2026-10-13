/**
 * Other projects' OpenRA mods, browsable in the local Studio (Node only; imported solely by review-server.ts).
 *
 * Each mod is read in place from its checkout under OpenRA-Upstreams: its own rules, sequences and art, mounted in the
 * order its mod.yaml gives. A file the mod takes from an owned game (RA2 or Red Alert MIX files) comes from the
 * player's own files through the same private extraction as the originals. The shared Studio shows the result from the
 * owner's published snapshot (scripts/publish-studio.ts), credited to each mod's authors.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AssetSource } from "./asset-source";
import { localAssetSource } from "./asset-source-server";
import { child, parseMiniYaml, type YamlNode } from "./miniyaml";
import { classicConfig, findYrDir, resolveStock, yrConfig, type OriginalsConfig, type RosterPayload, type StockRun } from "./originals";
import { loadModData, type ModReader } from "./resolve";
import { computeRosters } from "./roster";

export type ExternalMod = {
  id: string; name: string; repo: string; modId: string;
  /** The owned game files the mod builds on, when the Studio can read them from this machine (ra2yr: with Yuri's Revenge). */
  content: "ra2" | "ra2yr" | "ra" | null;
  /** What the mod needs that this machine lacks. */
  gaps?: string;
  url: string;
};

export const EXTERNAL_MODS: ExternalMod[] = [
  { id: "ra2", name: "OpenRA Red Alert 2", repo: "ra2", modId: "ra2", content: "ra2", url: "https://github.com/OpenRA/ra2" },
  { id: "rv", name: "Romanov’s Vengeance", repo: "Romanovs-Vengeance", modId: "rv", content: "ra2yr", url: "https://github.com/MustaphaTR/Romanovs-Vengeance" },
  { id: "ca", name: "Combined Arms", repo: "CAmod", modId: "ca", content: "ra", gaps: "Tiberian Dawn files (desert.mix) are not on this machine.", url: "https://github.com/Inq8/CAmod" },
  { id: "cameo", name: "Cameo", repo: "Cameo-mod", modId: "cameo", content: "ra", gaps: "Tiberian Dawn and Tiberian Sun files are not on this machine.", url: "https://github.com/cameo-mod/Cameo-mod" },
  { id: "gen", name: "Generals Alpha", repo: "Generals-Alpha", modId: "gen", content: "ra", url: "https://github.com/MustaphaTR/Generals-Alpha" },
  { id: "raplus", name: "RA+", repo: "raplusmod", modId: "raplus", content: "ra", url: "https://github.com/MlemandPurrs/raplusmod" },
  { id: "sp", name: "Shattered Paradise", repo: "Shattered-Paradise-SDK", modId: "sp", content: null, gaps: "Tiberian Sun files are not on this machine: only the mod's own art draws.", url: "https://github.com/ABrandau/Shattered-Paradise-SDK" },
  { id: "hv", name: "OpenHV", repo: "OpenHV", modId: "hv", content: null, url: "https://github.com/OpenHV/OpenHV" },
  { id: "example", name: "OpenRA Mod SDK example", repo: "OpenRAModSDK", modId: "example", content: null, url: "https://github.com/OpenRA/OpenRAModSDK" },
];

export type ModLibraryConfig = { upstreams: string; engine: string };
export function modLibraryConfig(webRoot: string, env: NodeJS.ProcessEnv = process.env): ModLibraryConfig {
  return { upstreams: resolve(webRoot, env.RTSAI_UPSTREAMS_DIR ?? "../OpenRA-Upstreams"), engine: resolve(webRoot, env.RTSAI_UPSTREAM_ENGINE ?? "../OpenRA") };
}

/** What the Studio lists: every mod whose checkout is on this machine. */
export function availableMods(lib: ModLibraryConfig) {
  return EXTERNAL_MODS.filter(m => existsSync(join(lib.upstreams, m.repo, "mods", m.modId, "mod.yaml")))
    .map(({ id, name, content, gaps, url }) => ({ id, name, content, gaps: gapsOf(content, gaps), url }));
}

const NO_YR = "No Yuri’s Revenge install found (set RTSAI_YR_DIR): Yuri units stay blank.";
const gapsOf = (content: ExternalMod["content"], gaps?: string) => (content === "ra2yr" && !findYrDir() ? NO_YR : gaps ?? null);

export const modConfig = (base: OriginalsConfig, id: string): OriginalsConfig => ({ ...base, mode: undefined, cacheDir: resolve(base.cacheDir, "..", "mod-library", id) });

const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const ARCHIVE = /\.(mix|bag|idx|big|zip|oramod)$/i;

const LISTS = ["Rules", "Sequences", "ModelSequences", "Weapons", "FluentMessages"];
/**
 * The manifest with its `Include:` files (relative to the mod folder, nested) merged in, as the engine reads it: the
 * file lists of every part are concatenated in order. Returned as text for the rules loader.
 */
function expandManifest(modDir: string, file = "mod.yaml", depth = 0, out: YamlNode[] = []): YamlNode[] {
  const path = join(modDir, file);
  if (depth > 6 || !existsSync(path)) return out;
  for (const node of parseMiniYaml(readFileSync(path, "utf8"), path)) {
    if (node.key === "Include" && node.value.value) expandManifest(modDir, node.value.value.trim(), depth + 1, out);
    else out.push(node);
  }
  return out;
}
const manifestText = (nodes: YamlNode[]) => LISTS.map(k => `${k}:\n${nodes.filter(n => n.key === k).flatMap(n => n.value.nodes).map(n => `\t${n.key}\n`).join("")}`).join("");

/** A mod's packages as its engine mounts them: folders by alias, and where the owned game's archives come in. */
export function mountPlan(lib: ModLibraryConfig, mod: ExternalMod) {
  const repo = join(lib.upstreams, mod.repo);
  const manifestPath = join(repo, "mods", mod.modId, "mod.yaml");
  const top = expandManifest(join(repo, "mods", mod.modId));
  const fs = top.find(n => n.key === "FileSystem")?.value;
  // Older manifests list one top-level Packages; FileSystem loaders mount system packages, then content packages.
  const entries: YamlNode[] = fs ? ["Packages", "SystemPackages", "ContentPackages"].flatMap(k => child(fs, k)?.value.nodes ?? []) : top.find(n => n.key === "Packages")?.value.nodes ?? [];
  const modDir = (id: string) => [join(repo, "mods", id), join(lib.engine, "mods", id)].find(isDir) ?? null;
  const aliases = new Map<string, string>([["common", join(lib.engine, "mods", "common")]]);
  const archives = new Set<string>();
  const mounts: ({ dir: string } | { archive: true })[] = [];
  for (const node of entries) {
    const key = node.key.replace(/^~/, "").trim(), name = node.value.value?.trim() || null;
    if (!key || key === "^EngineDir") continue;
    if (key.startsWith("$")) {
      const dir = modDir(key.slice(1));
      if (dir) { aliases.set(name ?? key.slice(1), dir); mounts.push({ dir }); }
      continue;
    }
    // The owned game's folders: not on this machine in the mod's layout; their archives stand for them.
    if (key.startsWith("^SupportDir|")) { if (name) archives.add(name); continue; }
    if (key.startsWith("^EngineDir|")) {
      const dir = join(lib.engine, key.slice(11));
      if (isDir(dir)) { if (name) aliases.set(name, dir); mounts.push({ dir }); }
      continue;
    }
    const bar = key.indexOf("|");
    const alias = bar < 0 ? null : key.slice(0, bar), rest = bar < 0 ? key : key.slice(bar + 1);
    if (ARCHIVE.test(rest) || (alias && archives.has(alias))) { if (name) archives.add(name); mounts.push({ archive: true }); continue; }
    const base = alias ? aliases.get(alias) : null;
    const dir = base ? join(base, rest) : null;
    if (dir && isDir(dir)) { if (name) aliases.set(name, dir); mounts.push({ dir }); }
  }
  const first = mounts.findIndex(m => "archive" in m);
  const dirsOf = (list: typeof mounts) => list.flatMap(m => ("dir" in m ? [m.dir] : [])).reverse();
  return {
    repo, manifestPath, aliases, manifest: manifestText(top),
    // Last mounted wins (OpenRA.Game/FileSystem/FileSystem.cs): folders after the archives override them.
    high: dirsOf(first < 0 ? mounts : mounts.slice(first)),
    low: first < 0 ? [] : dirsOf(mounts.slice(0, first)),
    /** `alias|name` inside one of the owned game's archives: the extractor finds it by `name`. */
    archive: (ref: string) => { const bar = ref.indexOf("|"); return bar > 0 && archives.has(ref.slice(0, bar)); },
    /** `alias|path` -> file path, or null for the owned game's archives and unknown packages. */
    packages: (ref: string) => { const bar = ref.indexOf("|"), base = bar > 0 ? aliases.get(ref.slice(0, bar)) : null; return base ? join(base, ref.slice(bar + 1)) : null; },
  };
}

const memo = new Map<string, Promise<RosterPayload>>();
export function modRosterPayload(base: OriginalsConfig, lib: ModLibraryConfig, id: string, refresh = false): Promise<RosterPayload> {
  if (!refresh && memo.has(id)) return memo.get(id)!;
  const payload = buildModPayload(base, lib, id);
  memo.set(id, payload);
  payload.catch(() => { if (memo.get(id) === payload) memo.delete(id); });
  return payload;
}

async function buildModPayload(base: OriginalsConfig, lib: ModLibraryConfig, id: string): Promise<RosterPayload> {
  const started = Date.now();
  const mod = EXTERNAL_MODS.find(m => m.id === id);
  if (!mod) throw new Error("Unknown mod");
  const plan = mountPlan(lib, mod);
  const abs = (p: string) => (isAbsolute(p) ? p : join(plan.repo, p));
  // The manifest is read merged with its includes; every other file in place.
  const reader: ModReader = { text: p => (p === plan.manifestPath ? plan.manifest : readFileSync(abs(p), "utf8")), bytes: p => new Uint8Array(readFileSync(abs(p))), exists: p => existsSync(abs(p)) };
  const data = loadModData(reader, { manifestPath: plan.manifestPath, resolvePackage: ref => ({ path: plan.packages(ref), reason: null }), lenient: true });
  const { factions, stock: info } = computeRosters(data);
  // Nothing here is RTS AI's own art: every unit is the mod's.
  for (const f of factions) for (const u of f.units) { u.origin = "original"; u.reference = null; }
  for (const u of Object.values(info)) u.origin = "original";
  // Tech trees and faction gates differ per mod; every unit it can build is also listed in one place.
  const order = ["infantry", "vehicle", "aircraft", "ship", "defense", "structure"];
  const all = Object.values(info).sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.order - b.order || a.id.localeCompare(b.id));
  factions.unshift({ id: "all-units", name: "All units", side: "", units: all.map(u => ({ ...u })), replaced: [] });
  const ids = new Set(factions.flatMap(f => f.units.map(u => u.id)));
  let commit = "";
  try { commit = execFileSync("git", ["-C", plan.repo, "rev-parse", "--short", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(); } catch { /* not a git checkout */ }
  const run: StockRun = { cfg: modConfig(base, id), reader, provenance: null, ownedPaths: new Map(), extraction: { requested: 0, cached: 0, missing: [], error: null } };
  // RA2 with Yuri's Revenge comes from the player's own install (Steam), else RA2 alone from the support folder.
  const content = mod.content === "ra2yr" ? yrConfig(base) ?? base : mod.content === "ra2" ? base : mod.content === "ra" ? classicConfig(base) : null;
  const credit = (path: string): AssetSource => {
    const inEngine = !relative(lib.engine, path).startsWith("..");
    const pack = inEngine ? "OpenRA engine" : mod.name;
    return { kind: "third-party", label: pack, pack, creator: inEngine ? "The OpenRA developers" : `${mod.name} authors`, file: relative(inEngine ? lib.engine : plan.repo, path).split("\\").join("/"), evidence: "declared", rights: "unreviewed" };
  };
  const stock = await resolveStock(run, data, ids, info, factions, {
    dirs: plan.high, low: plan.low, content, packages: plan.packages, archive: plan.archive, modeParam: `mod:${id}`, paletteFallback: "player",
    rules: `${mod.name} · ${mod.repo}${commit ? `@${commit}` : ""}`,
    source: (file, path, bytes) => (path ? credit(path) : localAssetSource(file, content?.mode === "classic" ? "classic" : "ra2", undefined, bytes, null)),
  });
  return {
    mode: "ra2", factions, stock, unresolved: [...ids].filter(i => !stock[i]),
    mod: { id: mod.id, name: mod.name, gaps: gapsOf(mod.content, mod.gaps), url: mod.url, commit: commit || null },
    extraction: { ...run.extraction, ms: Date.now() - started },
  };
}
