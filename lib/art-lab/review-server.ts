/**
 * Dev-only Review API for the local RTSAI-Art workspace, mounted at /api/art-review by a Vite dev-server
 * plugin (vite.config.ts, `apply: "serve"`). It never runs in production: builds do not include the
 * plugin, and the handler itself answers 404 whenever NODE_ENV is "production".
 *
 *   GET  /state                 units, candidates, review.json, local references
 *   GET  /file?path=<relative>  a file inside RTSAI-Art (read-only, path-checked)
 *   POST /action                approve / reject / comment / status -> review.json
 *
 * RTSAI-Art files are read in place; nothing is copied into public/.
 */
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";
import { applyReviewAction, validateAction, type Candidate, type CandidateMeta, type ReviewAction, type ReviewFile, type ReviewState, type UnitWorkspace } from "./review";
import { reviewEnabled } from "./review-gate";

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

export function readState(root: string): ReviewState {
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
      const urls = Object.fromEntries(files.map(f => [f, `${FILE_ROUTE}${encodeURIComponent(`${cdir}/${f}`)}`]));
      if (!meta) { errors.push(`${cdir}/meta.json is missing or not JSON`); candidates.push({ id, actor, createdAt: "", kind: "unknown", files: {}, dir: cdir, urls, metaError: "meta.json missing or invalid" }); continue; }
      candidates.push({ ...meta, id: meta.id ?? id, actor: meta.actor ?? actor, files: meta.files ?? {}, dir: cdir, urls });
    }
    candidates.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const comparisons = listFiles(join(root, "reference-local", "comparisons"), 0)
      .filter(f => f.toLowerCase().startsWith(`${actor}-`) && /\.(png|jpe?g|webp)$/i.test(f))
      .map(f => `${FILE_ROUTE}${encodeURIComponent(`reference-local/comparisons/${f}`)}`);
    units.push({ actor, spec: readJson(join(dir, "spec.json")), candidates, comparisons });
  }
  const review = readJson<ReviewFile>(join(root, "review.json")) ?? {};
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

/** Read-modify-write of review.json (fresh read, atomic replace) so concurrent Forge edits are not lost. */
export function writeAction(root: string, action: ReviewAction) {
  const path = join(root, "review.json");
  const current = readJson<ReviewFile>(path) ?? {};
  const next = applyReviewAction(current, action);
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

export function createArtReviewMiddleware({ root, env = process.env.NODE_ENV }: { root: string; env?: string }) {
  const workspace = resolve(root);
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (!reviewEnabled(env)) return send(res, 404, { error: "Not found" });
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname.replace(/^\/api\/art-review/, "") || "/";
      if (!isLocalRequest(req)) return send(res, 403, { error: "Review mode only answers local requests" });
      if (req.method === "GET" && path === "/state") return send(res, 200, readState(workspace));
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
        return send(res, 200, { entry: writeAction(workspace, action as ReviewAction) });
      }
      return send(res, 404, { error: "Not found" });
    } catch (error) {
      return send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}
