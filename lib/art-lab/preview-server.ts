/**
 * Dev-only, read-only view of the local preview mod (RTSAI-Mod worktree on branch rtsai/art-preview, overlay
 * mods/rtsai/art-preview/). Art agents install candidates there so the owner can play them before deciding.
 * An actor is "in local preview" only when overlay files exist for it; the candidate is named only when the
 * installed bytes equal that candidate's own files (SHA-256), never by guessing from names.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PreviewActor, PreviewStatus } from "./chain";

const OVERLAY = "mods/rtsai/art-preview";
const ROUTES = ["voxels", "infantry", "buildings", "icons"];
const ART = /\.(vxl|hva|shp|pal|png)$/i;

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const dirs = (path: string) => { try { return readdirSync(path).filter(n => statSync(join(path, n)).isDirectory()); } catch { return []; } };
const files = (path: string, prefix = "", depth = 2): string[] => {
  let out: string[] = [];
  try {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) { if (depth > 0) out = out.concat(files(full, `${prefix}${name}/`, depth - 1)); }
      else out.push(`${prefix}${name}`);
    }
  } catch { /* missing */ }
  return out;
};
const readJson = (path: string) => { try { return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } };

/** Size and mtime of every overlay and candidate meta file: cheap, and it changes whenever art lands. */
export function previewFingerprint(previewMod: string | null) {
  if (!previewMod) return "";
  const overlay = join(previewMod, OVERLAY);
  return files(overlay).map(f => { try { const s = statSync(join(overlay, f)); return `${f}:${s.size}:${s.mtimeMs}`; } catch { return f; } }).sort().join("|");
}

const cache = new Map<string, { key: string; status: PreviewStatus }>();

export function readPreviewStatus(artRoot: string, previewMod: string | null): PreviewStatus {
  const empty: PreviewStatus = { available: false, branch: null, head: null, actors: {}, unmatched: [] };
  if (!previewMod) return empty;
  const overlay = join(previewMod, OVERLAY);
  if (!existsSync(overlay)) return empty;
  const key = previewFingerprint(previewMod);
  const hit = cache.get(overlay);
  if (hit && hit.key === key) return hit.status;

  let branch: string | null = null, head: string | null = null;
  try {
    branch = execFileSync("git", ["-C", previewMod, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    head = execFileSync("git", ["-C", previewMod, "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { /* not a git checkout */ }

  // Actor ids from the art workspace; a file belongs to the longest id its name starts with (r2mantistur -> r2mantis).
  const actorIds = dirs(join(artRoot, "units")).sort((a, b) => b.length - a.length);
  const ownerOf = (file: string) => {
    const base = file.split("/").pop()!.toLowerCase().replace(ART, "");
    return actorIds.find(id => base.startsWith(id)) ?? null;
  };
  const actors: Record<string, PreviewActor> = {};
  const unmatched: string[] = [];
  const art = files(overlay).filter(f => ROUTES.includes(f.split("/")[0]) && ART.test(f));
  for (const file of art) {
    const actor = ownerOf(file);
    if (!actor) { unmatched.push(file); continue; }
    (actors[actor] ??= { model: null, icon: null, files: [], rules: false }).files.push(file);
  }
  // Rules and sequence overrides name actors as top-level MiniYaml keys.
  for (const yaml of files(overlay, "", 0).filter(f => f.endsWith(".yaml"))) {
    let text = "";
    try { text = readFileSync(join(overlay, yaml), "utf8"); } catch { continue; }
    for (const m of text.matchAll(/^([A-Za-z0-9_.-]+):\s*$/gm)) {
      const id = m[1].toLowerCase();
      if (actorIds.includes(id)) (actors[id] ??= { model: null, icon: null, files: [], rules: false }).rules = true;
    }
  }
  for (const [actor, entry] of Object.entries(actors)) {
    const installed = (ext: RegExp) => entry.files.filter(f => ext.test(f)).map(f => sha(join(overlay, f)));
    const models = installed(/\.(vxl|shp)$/i), icons = installed(/^icons\/.*\.png$/i);
    for (const id of dirs(join(artRoot, "units", actor, "candidates"))) {
      const dir = join(artRoot, "units", actor, "candidates", id);
      const meta = readJson(join(dir, "meta.json"));
      if (!meta?.files) continue;
      const own = (list: unknown) => (Array.isArray(list) ? list : list ? [list] : []).filter((f): f is string => typeof f === "string" && !f.includes("..")).flatMap(f => { const p = join(dir, f); return existsSync(p) ? [sha(p)] : []; });
      const nativeHashes = new Set([...own(meta.files.vxl), ...own(meta.files.shp)]);
      if (!entry.model && models.length && models.every(h => nativeHashes.has(h))) entry.model = meta.id ?? id;
      if (!entry.icon && icons.length && icons.every(h => own(meta.files.cameo).includes(h))) entry.icon = meta.id ?? id;
    }
  }
  const status: PreviewStatus = { available: true, branch, head, actors, unmatched };
  cache.set(overlay, { key, status });
  return status;
}

/** Changes when candidates, review decisions or preview files change (polled cheaply by the Studio). */
export function workspaceStamp(artRoot: string, previewMod: string | null) {
  const hash = createHash("sha1");
  for (const actor of dirs(join(artRoot, "units"))) {
    const base = join(artRoot, "units", actor, "candidates");
    for (const id of dirs(base)) {
      try { const s = statSync(join(base, id, "meta.json")); hash.update(`${actor}/${id}:${s.size}:${s.mtimeMs};`); } catch { hash.update(`${actor}/${id};`); }
    }
  }
  for (const file of ["review.json", "models/manifest.json"]) { try { const s = statSync(join(artRoot, file)); hash.update(`${file}:${s.size}:${s.mtimeMs};`); } catch { /* absent */ } }
  hash.update(previewFingerprint(previewMod));
  return hash.digest("hex").slice(0, 16);
}
