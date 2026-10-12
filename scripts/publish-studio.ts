/**
 * Publish the shared Studio's snapshot (rtsai.net/faction-studio) from this machine.
 *
 *   node --import tsx scripts/publish-studio.ts            # resolve, upload what is new, write data/studio-snapshot.json
 *   node --import tsx scripts/publish-studio.ts --dry-run  # resolve and count only
 *
 * It resolves every roster the local Studio shows (RTS AI's factions; the original countries with Westwood art from the
 * player's own RA2 / Yuri's Revenge / Red Alert files; every mod of the mod library), uploads each referenced art file
 * once to the public Vercel Blob store under its content hash, uploads the roster JSON with those URLs, and records the
 * snapshot's index in data/studio-snapshot.json (commit and push it to publish). Needs BLOB_READ_WRITE_TOKEN (.env.local,
 * from `vercel env pull`). No C&C music is published: the Studio's art is sprites, models, palettes and icons only.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { list, put } from "@vercel/blob";
import { cachedFile, classicConfig, rosterPayload, yrConfig, originalsConfig, type OriginalsConfig } from "../lib/art-lab/originals";
import { availableMods, modConfig, modLibraryConfig, modRosterPayload } from "../lib/art-lab/mod-library";
import { readState } from "../lib/art-lab/review-server";

const web = resolve(process.cwd());
const dryRun = process.argv.includes("--dry-run");
for (const line of existsSync(join(web, ".env.local")) ? readFileSync(join(web, ".env.local"), "utf8").split(/\r?\n/) : []) {
  const m = /^([A-Z_][A-Z0-9_]*)="?(.*?)"?$/.exec(line);
  if (m && m[1] === "BLOB_READ_WRITE_TOKEN" && !process.env.BLOB_READ_WRITE_TOKEN) process.env.BLOB_READ_WRITE_TOKEN = m[2];
}
if (!dryRun && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not set (vercel env pull)");

const base = originalsConfig(web), lib = modLibraryConfig(web);
const yr = yrConfig(base), classic = classicConfig(base);
const started = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - started) / 1000).toFixed(0)}s]`, ...a);

// 1. Every roster the local Studio shows.
const mods = availableMods(lib);
const rosters: Record<string, unknown> = { ra2: await rosterPayload(base, true), classic: await rosterPayload(classic, true) };
for (const mod of mods) { rosters[`mod:${mod.id}`] = await modRosterPayload(base, lib, mod.id, true); log("resolved", mod.name); }

// 2. The local file behind each art URL the rosters name.
const cfgFor = (mode: string): OriginalsConfig | null => (mode === "classic" ? classic : mode === "ra2yr" ? yr : mode.startsWith("mod:") ? modConfig(base, mode.slice(4)) : base);
function localFile(url: string): string | null {
  const route = /^\/api\/art-review\/(ra2|ra2yr|classic)\/([^?]+)$/.exec(url);
  if (route) { const cfg = cfgFor(route[1]); return cfg && cachedFile(cfg, decodeURIComponent(route[2])); }
  const owned = /^\/api\/art-review\/mod\/([^?]+)\?mode=(.+)$/.exec(url);
  if (owned) { const cfg = cfgFor(decodeURIComponent(owned[2])); return cfg && cachedFile(cfg, `owned/${decodeURIComponent(owned[1])}`); }
  return null;
}
const urls = new Set<string>();
const walk = (v: unknown) => {
  if (typeof v === "string") { if (v.startsWith("/api/art-review/")) urls.add(v); }
  else if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === "object") Object.values(v).forEach(walk);
};
Object.values(rosters).forEach(walk);
const files = new Map<string, { path: string; key: string; bytes: number }>();
const unresolved: string[] = [];
for (const url of urls) {
  const path = localFile(url);
  if (!path) { unresolved.push(url); continue; }
  const data = readFileSync(path);
  files.set(url, { path, key: `studio/a/${createHash("sha256").update(data).digest("hex").slice(0, 24)}${extname(path).toLowerCase()}`, bytes: data.length });
}
const unique = new Map([...files.values()].map(f => [f.key, f]));
log(`${urls.size} art URLs, ${unique.size} unique files, ${([...unique.values()].reduce((n, f) => n + f.bytes, 0) / 1048576).toFixed(0)} MB, ${unresolved.length} unresolved`);
if (unresolved.length) console.log("unresolved:", unresolved.slice(0, 10).join(" "));
if (dryRun) process.exit(0);

// 3. Upload what the store lacks (content-addressed, so a file is uploaded once across publishes).
const have = new Map<string, string>();
for (let cursor: string | undefined; ;) {
  const page = await list({ prefix: "studio/a/", limit: 1000, cursor });
  for (const b of page.blobs) have.set(b.pathname, b.url);
  if (!page.hasMore) break;
  cursor = page.cursor;
}
const type = (key: string) => (key.endsWith(".png") ? "image/png" : key.endsWith(".json") ? "application/json" : "application/octet-stream");
const todo = [...unique.values()].filter(f => !have.has(f.key));
log(`${have.size} already hosted, uploading ${todo.length}`);
let done = 0;
async function upload(f: { path: string; key: string }) {
  for (let attempt = 1; ; attempt++) {
    try {
      const blob = await put(f.key, readFileSync(f.path), { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: type(f.key), cacheControlMaxAge: 31536000 });
      have.set(f.key, blob.url);
      if (++done % 250 === 0) log(`uploaded ${done}/${todo.length}`);
      return;
    } catch (e) { if (attempt >= 5) throw e; await new Promise(r => setTimeout(r, 1000 * attempt)); }
  }
}
for (let i = 0; i < todo.length; i += 12) await Promise.all(todo.slice(i, i + 12).map(upload));

// 4. Rosters pointing at the hosted files, then the snapshot index.
const rewrite = (v: unknown): unknown => {
  if (typeof v === "string") { const f = files.get(v); return f ? have.get(f.key) ?? v : v; }
  if (Array.isArray(v)) return v.map(rewrite);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x)]));
  return v;
};
const publishedAt = new Date().toISOString(), id = publishedAt.replace(/[:.]/g, "-");
const putJson = async (name: string, body: unknown) => (await put(`studio/s/${id}/${name}`, JSON.stringify(body), { access: "public", addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 31536000 })).url;
const rosterUrls: Record<string, string> = {};
for (const [mode, payload] of Object.entries(rosters)) rosterUrls[mode] = await putJson(`roster-${mode.replace(":", "-")}.json`, rewrite(payload));
const state = readState(join(web, ".cache", "shared-studio-empty-workspace"));
const index = await putJson("index.json", { publishedAt, rosters: rosterUrls, mods, state });
const counts = Object.fromEntries(Object.entries(rosters).map(([mode, r]) => [mode, Object.keys((r as { stock: object }).stock).length]));
writeFileSync(join(web, "data", "studio-snapshot.json"), `${JSON.stringify({ index, publishedAt, files: unique.size, units: counts }, null, 2)}\n`);
log(`published ${index}`);
