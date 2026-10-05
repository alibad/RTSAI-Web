/**
 * Dev-only Review API for the local RTSAI-Art workspace, mounted at /api/art-review by a Vite dev-server
 * plugin (vite.config.ts, `apply: "serve"`). It never runs in production: builds do not include the
 * plugin, and the handler itself answers 404 whenever NODE_ENV is "production".
 *
 *   GET  /state                 units, candidates, review.json, local references
 *   GET  /file?path=<relative>  a file inside RTSAI-Art (read-only, path-checked)
 *   POST /action                approve / reject / comment / status -> review.json
 *   GET  /roster                every faction's build roster, with original RA2 units resolved (originals.ts)
 *   GET  /ra2/<name>            an original RA2 file from the local, gitignored cache (EA copyright: never
 *                               published; this route, like the others, does not exist in production)
 *   GET  /stamp                 a short fingerprint that changes when candidates, decisions or preview art change
 *   GET  /preview               which actors the local preview mod (rtsai/art-preview) installs, matched by bytes
 *
 * RTSAI-Art files are read in place; nothing is copied into public/.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { applyReviewAction, migrateEntry, validateAction, type Candidate, type CandidateMeta, type ReviewAction, type ReviewFile, type ReviewState, type UnitWorkspace } from "./review";
import { cachedFile, classicConfig, rosterPayload, visualPayload, SAFE_NAME, type OriginalsConfig } from "./originals";
import { fireRules } from "./fire-server";
import { reviewEnabled } from "./review-gate";
import { duelJob, startDuel } from "./duel-server";
import { baselineCounts, rebuildSummary, type RebuildCampaign } from "./rebuild";
import { readModelLibrary } from "./model-library-server";
import type { ModelLibrary } from "./models";
import { readPreviewStatus, workspaceStamp } from "./preview-server";
import { MEASUREMENT_FILES, measuredGroups } from "./measurements";

const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".glb": "model/gltf-binary",
};

export const FILE_ROUTE = "/api/art-review/file?path=";

function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, "")) as T; } catch { return null; }
}

function listDirs(path: string) {
  try { return readdirSync(path).filter(name => statSync(join(path, name)).isDirectory()).sort(); } catch { return []; }
}

function listFiles(path: string, depth = 2, prefix = ""): string[] {
  let out: string[] = [];
  try {
    for (const name of readdirSync(path).sort()) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) { if (depth > 0) out = out.concat(listFiles(full, depth - 1, `${prefix}${name}/`)); }
      else out.push(`${prefix}${name}`);
    }
  } catch { /* missing */ }
  return out;
}

/** Resolves a workspace-relative path, refusing anything outside the root. */
export function safeResolve(root: string, rel: string) {
  if (!rel || rel.includes("\0") || /^[a-zA-Z]:|^[\\/]/.test(rel)) return null;
  const target = resolve(root, rel);
  const within = relative(root, target);
  if (!within || within.startsWith("..") || within.split(sep).includes("..")) return null;
  return target;
}

const kindsOf = (unit: UnitWorkspace | undefined) => (candidate: string) => unit?.candidates.find(c => c.id === candidate)?.kind;

function unitWorkspace(root: string, actor: string): UnitWorkspace | undefined {
  return readState(root).units.find(u => u.actor === actor);
}

export function readState(root: string, mode: "ra2" | "classic" = "ra2", fileRoot = root): ReviewState {
  if (mode === "classic") return readState(join(root, "modes", "classic"), "ra2", root);
  const url = (path: string) => `${FILE_ROUTE}${encodeURIComponent(relative(fileRoot, join(root, path)).split(sep).join("/"))}`;
  const errors: string[] = [];
  const exists = existsSync(root);
  const units: UnitWorkspace[] = [];
  for (const actor of listDirs(join(root, "units"))) {
    const dir = join(root, "units", actor);
    const candidates: Candidate[] = [];
    for (const id of listDirs(join(dir, "candidates"))) {
      const cdir = `units/${actor}/candidates/${id}`;
      const meta = readJson<CandidateMeta>(join(root, cdir, "meta.json"));
      const files = listFiles(join(root, cdir));
      const urls = Object.fromEntries(files.map(f => [f, url(`${cdir}/${f}`)]));
      if (!meta) { errors.push(`${cdir}/meta.json is missing or not JSON`); candidates.push({ id, actor, createdAt: "", kind: "unknown", files: {}, dir: cdir, urls, metaError: "meta.json missing or invalid" }); continue; }
      // The candidate's proposed rules/sequences (MiniYaml) travel with it so the viewer reads the real layout.
      // A separate sequences file (files.sequences) is part of the same proposal: its layout is the truth.
      const snippets = [meta.files?.rules, (meta.files as Record<string, unknown> | undefined)?.sequences].filter((f): f is string => typeof f === "string");
      const texts: string[] = [];
      for (const file of snippets) {
        const path = safeResolve(root, `${cdir}/${file}`);
        try { if (path && statSync(path).size < 256 * 1024) texts.push(readFileSync(path, "utf8")); } catch { /* unreadable: ignored */ }
      }
      const rulesText: string | null = texts.length ? texts.join("\n") : null;
      // Measured results the art routes saved beside the candidate (small JSON files), reshaped for the Checks step.
      const measuredFiles: Record<string, unknown> = {};
      for (const name of MEASUREMENT_FILES) if (files.includes(name)) { const parsed = readJson(join(root, cdir, name)); if (parsed) measuredFiles[name] = parsed; }
      const measured = measuredGroups(measuredFiles, meta as unknown as Record<string, unknown>);
      const { prompt, ...rest } = meta;
      candidates.push({ ...rest, ...(typeof prompt === "string" && prompt ? { promptChars: prompt.length } : {}), id: meta.id ?? id, actor: meta.actor ?? actor, files: meta.files ?? {}, dir: cdir, urls, rulesText, measured });
    }
    candidates.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const comparisons = listFiles(join(root, "reference-local", "comparisons"), 0)
      .filter(f => f.toLowerCase().startsWith(`${actor}-`) && /\.(png|jpe?g|webp)$/i.test(f))
      .map(f => url(`reference-local/comparisons/${f}`));
    units.push({ actor, spec: readJson(join(dir, "spec.json")), candidates, comparisons });
  }
  // Present every entry in the current (version 2, per-slot) shape; the file itself is rewritten only on a decision.
  const raw = readJson<Record<string, unknown>>(join(root, "review.json")) ?? {};
  const review: ReviewFile = {};
  for (const [actor, entry] of Object.entries(raw)) review[actor] = migrateEntry(entry, kindsOf(units.find(u => u.actor === actor)));
  const stockIndex = readJson<{ units?: Record<string, { usedBy?: string[]; parts?: Record<string, string[]>; found?: boolean }> }>(join(root, "reference-local", "ra2-stock", "index.json"));
  const stock = Object.entries(stockIndex?.units ?? {}).filter(([, u]) => u.found !== false).map(([id, u]) => ({ id, usedBy: u.usedBy ?? [], parts: Object.keys(u.parts ?? {}) }));
  const stockPalette = existsSync(join(root, "reference-local", "ra2-stock", "unittem.pal")) ? `${FILE_ROUTE}${encodeURIComponent("reference-local/ra2-stock/unittem.pal")}` : null;
  const bibles = listFiles(join(root, "bible"), 0).filter(f => f.endsWith(".md") && !f.startsWith("_")).map(f => {
    const faction = f.replace(/\.md$/, "");
    return {
      faction,
      md: (() => { try { return readFileSync(join(root, "bible", f), "utf8"); } catch { return null; } })(),
      boards: listFiles(join(root, "bible", faction), 0).filter(b => /\.(png|jpe?g|webp)$/i.test(b)).map(b => `${FILE_ROUTE}${encodeURIComponent(`bible/${faction}/${b}`)}`),
    };
  });
  return { root, exists, units, review, stock, stockPalette, bibles, errors };
}

/**
 * Adds pre-rendered thumbnails (scripts/render-glb-thumbs.mjs) to GLB options, only while the index's size and
 * modification time still match the model on disk: a changed GLB never shows its old picture.
 */
function attachGlbThumbnails(library: ModelLibrary, workspace: string, dir: string) {
  const index = readJson<Record<string, { stamp: string; thumb: string }>>(join(dir, "index.json"));
  if (!index) return;
  for (const actor of library.actors) for (const option of actor.options) {
    const rel = new URL(option.url, "http://localhost").searchParams.get("path");
    const entry = rel ? index[rel] : undefined;
    if (!rel || !entry) continue;
    try {
      const s = statSync(join(workspace, rel));
      if (`${s.size}:${Math.round(s.mtimeMs)}` === entry.stamp && existsSync(join(dir, entry.thumb))) option.thumbnail = `/api/art-review/glb-thumb/${encodeURIComponent(entry.thumb)}?v=${encodeURIComponent(entry.stamp)}`;
    } catch { /* model gone */ }
  }
}

/** Read-modify-write of review.json (fresh read, atomic replace) so concurrent Forge edits are not lost. */
export function writeAction(root: string, action: ReviewAction, mode: "ra2" | "classic" = "ra2") {
  if (mode === "classic") root = join(root, "modes", "classic");
  mkdirSync(root, { recursive: true });
  const path = join(root, "review.json");
  const current = readJson<ReviewFile>(path) ?? {};
  const next = applyReviewAction(current, action, new Date().toISOString(), kindsOf(unitWorkspace(root, action.actor)));
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(next, null, 2) + "\n");
  renameSync(temp, path);
  return next[action.actor];
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.end(typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body));
}

/** Only same-machine pages may write: a cross-site form cannot send application/json without a preflight. */
function isLocalRequest(req: IncomingMessage) {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  const local = (h: string) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(h) || h.endsWith(".localhost");
  if (!local(host)) return false;
  const origin = req.headers.origin;
  if (origin) { try { if (!local(new URL(origin).hostname)) return false; } catch { return false; } }
  return true;
}

export function createArtReviewMiddleware({ root, env = process.env.NODE_ENV, originals = null, webRoot = process.cwd(), previewMod = null }: { root: string; env?: string; originals?: OriginalsConfig | null; webRoot?: string; previewMod?: string | null }) {
  const workspace = resolve(root);
  const web = resolve(webRoot);
  const stateCache = new Map<string, { stamp: string; body: string }>();
  const preview = previewMod ? resolve(previewMod) : null;
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (!reviewEnabled(env)) return send(res, 404, { error: "Not found" });
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname.replace(/^\/api\/art-review/, "") || "/";
      if (!isLocalRequest(req)) return send(res, 403, { error: "Review mode only answers local requests" });
      if (req.method === "GET" && path === "/rebuild") {
        const campaign = readJson<RebuildCampaign>(join(workspace, "rebuild", "catalog.json"));
        if (!campaign) return send(res, 404, { error: "The local rebuild catalog has not been generated." });
        const summary = rebuildSummary(campaign);
        try {
          const hash = createHash("sha256");
          for (const file of ["rebuild_baseline.py", "studio_duel.py", "studio_duel.lua"]) hash.update(readFileSync(join(workspace, "tools", file)));
          summary.nativeBaseline = baselineCounts(campaign, readJson(join(workspace, "rebuild", "native-baseline.json")), hash.digest("hex"));
        } catch { /* A workspace without the native runner still exposes the art scope. */ }
        return send(res, 200, summary);
      }
      const reviewMode = url.searchParams.get("mode") ?? "ra2";
      if (["/state", "/action", "/models", "/animations", "/stamp", "/preview", "/prompt"].includes(path) && !["ra2", "classic"].includes(reviewMode)) return send(res, 400, { error: "Unknown game mode" });
      if(req.method==="GET"&&path==="/animations"){
        const actor=url.searchParams.get("actor")??"";
        if(!SAFE_NAME.test(actor))return send(res,400,{error:"Unknown actor"});
        const audit=readJson<{measuredAt:string;actors:Record<string,unknown>}>(join(workspace,"animations/catalog.json"));
        const studies=readJson<{actors:Record<string,unknown>}>(join(workspace,"animations/motion-studies.json"));
        return send(res,200,{measuredAt:audit?.measuredAt??null,current:audit?.actors[`${reviewMode}:${actor}`]??null,motionStudy:reviewMode==="ra2"?studies?.actors[actor]??null:null});
      }
      if (req.method === "GET" && path === "/models") {
        const mode=reviewMode as "ra2"|"classic";
        const roster=originals?await rosterPayload(mode==="classic"?classicConfig(originals):originals):null;
        const thumbnails=Object.fromEntries(Object.entries(roster?.stock??{}).map(([actor,stock])=>[actor,stock.spec.cameo]));
        const models=readModelLibrary(workspace,mode,thumbnails);
        if(models)attachGlbThumbnails(models,workspace,join(web,".cache","glb-thumbs"));
        return models?send(res,200,models):send(res,404,{error:"Run the local model inventory first."});
      }
      if (req.method === "GET" && path.startsWith("/glb-thumb/")) {
        const name = decodeURIComponent(path.slice(11));
        const file = /^[a-z0-9_-]+--[a-z0-9._-]+\.png$/i.test(name) ? join(web, ".cache", "glb-thumbs", name) : null;
        if (!file || !existsSync(file)) return send(res, 404, { error: "No such thumbnail" });
        res.setHeader("Cache-Control", "private, max-age=3600");
        return send(res, 200, readFileSync(file), "image/png");
      }
      if (req.method === "GET" && path === "/state") {
        // One read per change: the same fingerprint the Studio polls decides when the workspace is read again.
        const mode = reviewMode as "ra2" | "classic";
        const stamp = workspaceStamp(mode === "classic" ? join(workspace, "modes", "classic") : workspace, preview);
        const hit = stateCache.get(mode);
        if (hit && hit.stamp === stamp) return send(res, 200, hit.body, "application/json; charset=utf-8");
        const body = JSON.stringify(readState(workspace, mode));
        stateCache.set(mode, { stamp, body });
        return send(res, 200, body, "application/json; charset=utf-8");
      }
      if (req.method === "GET" && path === "/prompt") {
        const actor = url.searchParams.get("actor") ?? "", id = url.searchParams.get("id") ?? "";
        if (!SAFE_NAME.test(actor) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) return send(res, 400, { error: "Bad candidate" });
        const base = reviewMode === "classic" ? join(workspace, "modes", "classic") : workspace;
        const meta = readJson<{ prompt?: string }>(join(base, "units", actor, "candidates", id, "meta.json"));
        return meta ? send(res, 200, { prompt: typeof meta.prompt === "string" ? meta.prompt : null }) : send(res, 404, { error: "No such candidate" });
      }
      if (req.method === "GET" && path === "/stamp") return send(res, 200, { stamp: workspaceStamp(reviewMode === "classic" ? join(workspace, "modes", "classic") : workspace, preview) });
      if (req.method === "GET" && path === "/preview") {
        // The preview overlay is an RA2 mod branch; Classic has none.
        if (reviewMode === "classic") return send(res, 200, { available: false, branch: null, head: null, actors: {}, unmatched: [] });
        const status = readPreviewStatus(workspace, preview);
        if (status.available && preview) {
          // The preview copy has no companion files; OPENRA_AI_HOST=0 keeps the co-commander off cleanly. The RA2
          // files the player imported live in the support folder the Studio's originals use.
          const support = originals?.supportDir ?? resolve(web, "../OpenRA/Support");
          status.launch = {
            worktree: preview, supportDir: support,
            engineBuilt: existsSync(join(preview, "engine", "bin", "OpenRA.exe")),
            ra2Content: existsSync(join(support, "Content", "ra2", "ra2.mix")),
            companionFiles: existsSync(join(preview, "engine", "companion")),
            // launch-game.cmd wraps all its arguments in one pair of quotes, so the setting itself stays unquoted.
            command: `cd /d "${preview}" && set OPENRA_AI_HOST=0&& launch-game.cmd Engine.SupportDir=${support}`,
          };
        }
        return send(res, 200, status);
      }
      if (req.method === "GET" && /^\/duel\/[a-f0-9-]{36}$/.test(path)) {
        const job = duelJob(path.slice(6), web);
        return job ? send(res, 200, job) : send(res, 404, { error: "No such match" });
      }
      if (req.method === "POST" && path === "/duel") {
        if (!originals) return send(res, 404, { error: "Engine not configured" });
        if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return send(res, 415, { error: "Send application/json" });
        let body = "";
        for await (const chunk of req) { body += chunk.toString(); if (body.length > 4096) return send(res, 413, { error: "Too large" }); }
        try { return send(res, 202, await startDuel(web, originals, JSON.parse(body))); }
        catch (error) { return send(res, 400, { error: error instanceof Error ? error.message : "Invalid duel" }); }
      }
      if (req.method === "GET" && path === "/roster") {
        if (!originals) return send(res, 404, { error: "Original units are not configured" });
        const mode = url.searchParams.get("mode") ?? "ra2";
        if (!["ra2", "classic"].includes(mode)) return send(res, 400, { error: "Unknown game mode" });
        return send(res, 200, await rosterPayload(mode === "classic" ? classicConfig(originals) : originals, url.searchParams.has("refresh")));
      }
      if (req.method === "GET" && (path.startsWith("/ra2/") || path.startsWith("/classic/"))) {
        const classic = path.startsWith("/classic/");
        const name = decodeURIComponent(path.slice(classic ? 9 : 5));
        const file = originals && SAFE_NAME.test(name) ? cachedFile(classic ? classicConfig(originals) : originals, name) : null;
        if (!file) return send(res, 404, { error: "No such file" });
        res.setHeader("Cache-Control", "private, max-age=3600");
        res.statusCode = 200;
        res.setHeader("Content-Type", name.endsWith(".png") ? "image/png" : "application/octet-stream");
        return res.end(readFileSync(file));
      }
      if (req.method === "GET" && path === "/fire") {
        // An actor's firing rules: RTSAI-Mod main (in game now) or the local preview copy (candidates).
        const actor = url.searchParams.get("actor") ?? "", source = url.searchParams.get("source") === "preview" ? "preview" : "main";
        const root = source === "preview" ? preview : originals?.modRoot ?? resolve(web, "../RTSAI-Mod");
        if (reviewMode !== "ra2" || !root || !SAFE_NAME.test(actor)) return send(res, 404, { error: "No firing rules" });
        try { const rules = fireRules(root, actor, source); return rules ? send(res, 200, rules) : send(res, 404, { error: "No such actor" }); }
        catch (error) { return send(res, 404, { error: error instanceof Error ? error.message : "Rules unavailable" }); }
      }
      if (req.method === "GET" && path === "/visual") {
        if (!originals) return send(res, 404, { error: "Local art is not configured" });
        const mode = url.searchParams.get("mode") ?? "ra2";
        if (!["ra2", "classic"].includes(mode)) return send(res, 400, { error: "Unknown game mode" });
        // Effects named by the local preview copy's rules (its muzzle sequences) resolve against that checkout; the
        // art itself still comes from the same private originals cache.
        const cfg = mode === "classic" ? classicConfig(originals) : url.searchParams.get("source") === "preview" && preview ? { ...originals, modRoot: preview } : originals;
        try { return send(res, 200, await visualPayload(cfg, url.searchParams.get("image") ?? "", url.searchParams.get("sequence") ?? "", url.searchParams.get("palette") ?? "effect")); }
        catch (error) { return send(res, 404, { error: error instanceof Error ? error.message : "Unavailable effect" }); }
      }
      if (req.method === "GET" && path.startsWith("/mod/")) {
        const name = decodeURIComponent(path.slice(5));
        const cfg = originals && (url.searchParams.get("mode") === "classic" ? classicConfig(originals) : originals);
        const file = cfg && SAFE_NAME.test(name) ? cachedFile(cfg, `owned/${name}`) : null;
        return file ? send(res, 200, readFileSync(file), name.endsWith(".png") ? "image/png" : "application/octet-stream") : send(res, 404, { error: "No such mod file" });
      }
      if (req.method === "GET" && path === "/file") {
        const target = safeResolve(workspace, url.searchParams.get("path") ?? "");
        if (!target || !existsSync(target) || !statSync(target).isFile()) return send(res, 404, { error: "No such file" });
        return send(res, 200, readFileSync(target), TYPES[extname(target).toLowerCase()] ?? "application/octet-stream");
      }
      if (req.method === "POST" && path === "/action") {
        if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return send(res, 415, { error: "Send application/json" });
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) { size += (chunk as Buffer).length; if (size > 64 * 1024) return send(res, 413, { error: "Too large" }); chunks.push(chunk as Buffer); }
        let action: unknown;
        try { action = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(res, 400, { error: "Bad JSON" }); }
        const problem = validateAction(action);
        if (problem) return send(res, 400, { error: problem });
        if (!existsSync(workspace)) return send(res, 409, { error: `No RTSAI-Art workspace at ${workspace}` });
        return send(res, 200, { entry: writeAction(workspace, action as ReviewAction, reviewMode as "ra2" | "classic") });
      }
      return send(res, 404, { error: "Not found" });
    } catch (error) {
      return send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
