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
import type { PreviewActor, PreviewAnimation, PreviewStatus } from "./chain";
import { MEASUREMENT_FILES } from "./measurements";
import { childValue, parseMiniYaml, type YamlNode } from "./miniyaml";

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
  for (const [actor, list] of Object.entries(overlayAnimations(overlay, files(overlay, "", 0).filter(f => f.endsWith(".yaml")), actorIds))) {
    if (actors[actor]) actors[actor].animations = list;
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

/**
 * The voxel animations the overlay's rules play, per actor: WithVoxelHelicopterBody (a body that cycles its HVA
 * frames while airborne: rotors and propellers modelled as sections) and WithAnimatedVoxelModel (a model that
 * spins on the body or a turret: radars). Sequence names resolve to voxel files through the overlay's sequence
 * files. Values the overlay leaves out stay null (the actor's own rules or the engine default apply).
 */
export function overlayAnimations(overlay: string, yamlFiles: string[], actorIds: string[]): Record<string, PreviewAnimation[]> {
  const ids = new Set(actorIds.map(a => a.toLowerCase()));
  const sequences: Record<string, Record<string, string>> = {};
  const heli: Record<string, { sequence: string | null; tickRate: number | null }> = {};
  const spins: Record<string, Map<string, Omit<PreviewAnimation, "file">>> = {};
  const num = (v: string | null) => (v !== null && Number.isFinite(Number(v)) ? Number(v) : null);
  for (const yaml of yamlFiles) {
    let nodes: YamlNode[];
    try { nodes = parseMiniYaml(readFileSync(join(overlay, yaml), "utf8"), yaml); } catch { continue; }
    for (const node of nodes) {
      const actor = node.key.toLowerCase();
      if (!ids.has(actor)) continue;
      for (const c of node.value.nodes) {
        const value = c.value.value;
        if (!c.value.nodes.length && value && /voxels\//i.test(value)) { (sequences[actor] ??= {})[c.key] = value.split("/").pop()!.toLowerCase(); continue; }
        const kind = c.key.split("@")[0];
        if (kind === "WithVoxelHelicopterBody") {
          const h = (heli[actor] ??= { sequence: null, tickRate: null });
          h.sequence = childValue(c.value, "Sequence") ?? h.sequence;
          h.tickRate = num(childValue(c.value, "TickRate")) ?? h.tickRate;
        } else if (kind === "WithAnimatedVoxelModel") {
          const list = (spins[actor] ??= new Map());
          const was = list.get(c.key);
          list.set(c.key, {
            trait: c.key, sequence: childValue(c.value, "Sequence") ?? was?.sequence ?? "radar", tickRate: num(childValue(c.value, "TickRate")) ?? was?.tickRate ?? 2,
            turret: childValue(c.value, "Turret") || was?.turret || null, condition: childValue(c.value, "RequiresCondition") ?? was?.condition ?? null, airborne: false,
          });
        }
      }
    }
  }
  const out: Record<string, PreviewAnimation[]> = {};
  for (const actor of new Set([...Object.keys(heli), ...Object.keys(spins)])) {
    const file = (sequence: string) => sequences[actor]?.[sequence] ?? null;
    const h = heli[actor];
    out[actor] = [
      ...(h ? [{ trait: "WithVoxelHelicopterBody", sequence: h.sequence ?? "idle", file: file(h.sequence ?? "idle"), tickRate: h.tickRate, turret: null, condition: null, airborne: true }] : []),
      ...[...(spins[actor]?.values() ?? [])].map(a => ({ ...a, file: file(a.sequence) })),
    ];
  }
  // Remapped sequences the overlay plays through the actor's own traits (an Apache's "rotor" -> its new voxel).
  for (const [actor, map] of Object.entries(sequences)) {
    const used = new Set((out[actor] ?? []).map(a => a.sequence));
    const rest = Object.entries(map).filter(([sequence]) => !used.has(sequence)).map(([sequence, file]) => ({ trait: "sequence", sequence, file, tickRate: null, turret: null, condition: null, airborne: false }));
    if (rest.length) out[actor] = [...(out[actor] ?? []), ...rest];
  }
  return out;
}

/** Changes when candidates, review decisions or preview files change (polled cheaply by the Studio). */
export function workspaceStamp(artRoot: string, previewMod: string | null) {
  const hash = createHash("sha1");
  for (const actor of dirs(join(artRoot, "units"))) {
    const base = join(artRoot, "units", actor, "candidates");
    for (const id of dirs(base)) {
      const dir = join(base, id);
      let names: string[] = [];
      try { names = readdirSync(dir); } catch { /* removed meanwhile */ }
      hash.update(`${actor}/${id}#${names.length};`);
      for (const name of ["meta.json", ...MEASUREMENT_FILES]) {
        if (name !== "meta.json" && !names.includes(name)) continue;
        try { const s = statSync(join(dir, name)); hash.update(`${name}:${s.size}:${s.mtimeMs};`); } catch { hash.update(`${name}-;`); }
      }
    }
  }
  for (const file of ["review.json", "models/manifest.json"]) { try { const s = statSync(join(artRoot, file)); hash.update(`${file}:${s.size}:${s.mtimeMs};`); } catch { /* absent */ } }
  hash.update(previewFingerprint(previewMod));
  return hash.digest("hex").slice(0, 16);
}
