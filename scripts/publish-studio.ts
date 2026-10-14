/**
 * Publish the shared Studio's snapshot (rtsai.net/faction-studio) from this machine.
 *
 *   node --import tsx scripts/publish-studio.ts              # resolve, write the static site, deploy it, write data/studio-snapshot.json
 *   node --import tsx scripts/publish-studio.ts --dry-run    # resolve and count only
 *   node --import tsx scripts/publish-studio.ts --no-deploy  # write the static site (.cache/studio-cdn) without deploying
 *   node --import tsx scripts/publish-studio.ts --no-deploy --site=D:/studio-cdn   # write it somewhere else
 *   node --import tsx scripts/publish-studio.ts --no-sounds  # art only (no original voices and sound effects)
 *
 * It resolves every roster the local Studio shows (RTS AI's factions; the original countries with Westwood art from the
 * player's own RA2 / Yuri's Revenge / Red Alert files; every mod of the mod library) and writes a static site: each
 * referenced art file once under its content hash (a/<sha>.<ext>), and the snapshot's rosters and index under s/<time>/.
 * The site is served by the Cloudflare Pages project STUDIO_CDN_PROJECT (default rtsai-studio) at STUDIO_CDN_URL
 * (default https://rtsai-studio.pages.dev): free, no transfer cap, and an edge in Doha, close to the players in Qatar.
 * Deploying needs `npx wrangler login` once. Commit and push data/studio-snapshot.json to publish.
 *
 * Next to the art it publishes the original units' voices and sound effects for the Faction viewer
 * (lib/art-lab/sounds-snapshot.ts): one sound list per faction (s/<time>/sounds-<faction>.json) and each original clip
 * once as MP3 (a/<sha>.mp3), named in the index under `sounds`. Never music, and nothing EA's in the repository.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { cachedFile, classicConfig, rosterPayload, yrConfig, originalsConfig, type OriginalsConfig } from "../lib/art-lab/originals";
import { availableMods, modConfig, modLibraryConfig, modRosterPayload } from "../lib/art-lab/mod-library";
import { readState } from "../lib/art-lab/review-server";
import { buildSoundSnapshot, SOUND_ENCODER_LABEL } from "../lib/art-lab/sounds-snapshot";
import { EA_NOTICE } from "../lib/ea-notice";

const web = resolve(process.cwd());
const dryRun = process.argv.includes("--dry-run");
const deploy = !process.argv.includes("--no-deploy");
const sounds = !process.argv.includes("--no-sounds");
const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const project = process.env.STUDIO_CDN_PROJECT ?? "rtsai-studio";
const cdn = (process.env.STUDIO_CDN_URL ?? `https://${project}.pages.dev`).replace(/\/$/, "");
/** Kept between publishes: every deploy uploads the whole site, and older snapshots stay valid. */
const site = resolve(arg("site") ?? join(web, ".cache", "studio-cdn"));

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
  files.set(url, { path, key: `a/${createHash("sha256").update(data).digest("hex").slice(0, 24)}${extname(path).toLowerCase()}`, bytes: data.length });
}
const unique = new Map([...files.values()].map(f => [f.key, f]));
log(`${urls.size} art URLs, ${unique.size} unique files, ${([...unique.values()].reduce((n, f) => n + f.bytes, 0) / 1048576).toFixed(0)} MB, ${unresolved.length} unresolved`);
if (unresolved.length) console.log("unresolved:", unresolved.slice(0, 10).join(" "));
if (dryRun) process.exit(0);

// 3. The static site: art files (content-addressed, so each is written once across publishes), headers for the Studio
// page at rtsai.net to read them (CORS, cross-origin resource policy) and a year of caching (nothing ever changes).
let added = 0;
for (const f of unique.values()) {
  const to = join(site, f.key);
  if (existsSync(to)) continue;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(f.path, to);
  added++;
}
writeFileSync(join(site, "_headers"), [
  "/*", "  Access-Control-Allow-Origin: *", "  Cross-Origin-Resource-Policy: cross-origin", "  X-Content-Type-Options: nosniff",
  "/a/*", "  Cache-Control: public, max-age=31536000, immutable",
  "/s/*", "  Cache-Control: public, max-age=31536000, immutable", "",
].join("\n"));
writeFileSync(join(site, "index.html"), "<!doctype html><title>RTS AI Studio art</title><p>Art for <a href=\"https://rtsai.net/faction-studio\">rtsai.net/faction-studio</a>.</p>\n");
log(`${added} new art files, ${unique.size - added} already in the site`);

// 4. Rosters pointing at the hosted files, then the snapshot index.
const rewrite = (v: unknown): unknown => {
  if (typeof v === "string") { const f = files.get(v); return f ? `${cdn}/${f.key}` : v; }
  if (Array.isArray(v)) return v.map(rewrite);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x)]));
  return v;
};
const publishedAt = new Date().toISOString(), id = publishedAt.replace(/[:.]/g, "-");
const writeJson = (name: string, body: unknown) => {
  const key = `s/${id}/${name}`;
  mkdirSync(join(site, "s", id), { recursive: true });
  writeFileSync(join(site, key), JSON.stringify(body));
  return `${cdn}/${key}`;
};
const rosterUrls: Record<string, string> = {};
for (const [mode, payload] of Object.entries(rosters)) rosterUrls[mode] = writeJson(`roster-${mode.replace(":", "-")}.json`, rewrite(payload));
const state = readState(join(web, ".cache", "shared-studio-empty-workspace"));
// The original units' voices and effects for the Faction viewer, one list per faction.
let soundIndex: { notice: string; encoder: string; factions: Record<string, string> } | undefined;
if (sounds) {
  const built = await buildSoundSnapshot({ modRoot: base.modRoot, originals: base, site, cdn, log });
  soundIndex = { notice: EA_NOTICE, encoder: SOUND_ENCODER_LABEL, factions: Object.fromEntries(Object.entries(built.factions).map(([id, payload]) => [id, writeJson(`sounds-${id}.json`, payload)])) };
  log(`sounds: ${built.stats.clips} original clips (${(built.stats.bytes / 1048576).toFixed(1)} MB, ${built.stats.added} new) for ${built.stats.units} units; ${built.stats.missing.length} not in the game files${built.stats.missing.length ? `: ${built.stats.missing.slice(0, 8).join(" ")}` : ""}`);
}
const index = writeJson("index.json", { publishedAt, rosters: rosterUrls, mods, state, ...(soundIndex ? { sounds: soundIndex } : {}) });

// 5. Deploy, then record the snapshot for the site.
if (deploy) {
  log(`deploying ${site} to Cloudflare Pages project ${project}`);
  execFileSync("npx", ["--yes", "wrangler@4", "pages", "deploy", site, "--project-name", project, "--branch", "main", "--commit-dirty=true"], { stdio: "inherit", shell: process.platform === "win32" });
}
const counts = Object.fromEntries(Object.entries(rosters).map(([mode, r]) => [mode, Object.keys((r as { stock: object }).stock).length]));
writeFileSync(join(web, "data", "studio-snapshot.json"), `${JSON.stringify({ index, publishedAt, files: unique.size, units: counts }, null, 2)}\n`);
log(deploy ? `published ${index}` : `site written to ${site}; deploy it, then push data/studio-snapshot.json`);
