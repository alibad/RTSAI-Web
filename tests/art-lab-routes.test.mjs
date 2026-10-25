import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://rtsai.net${pathname}`, { headers: { accept: "text/html", host: "rtsai.net" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

const noindex = /name="robots" content="noindex, nofollow"/;

// The Art Lab shows provenance internals: admin builds only (RTSAI_ADMIN=1 npm test); players use the Faction viewer.
const adminBuild = process.env.RTSAI_ADMIN === "1";

test("public builds leave the Art Lab out: every page answers 404", { skip: adminBuild }, async () => {
  for (const path of ["/art", "/art/china", "/art/iran/r2karrar", "/art/china/r2cnrifle"]) assert.equal((await render(path)).status, 404, path);
});

test("the Faction Art Lab renders and is never indexed", { skip: !adminBuild }, async () => {
  const pages = {
    "/art": [/Faction Art Lab/, /Five-faction comparison/, /href="\/art\/saudi"/],
    "/art/china": [/Qilin Battle Tank/, /Build-palette cameos/],
    // Promoted art: a prerendered sprite rendered from the unit's 3D model, credited to its RTSAI-Art candidate.
    "/art/iran/r2karrar": [/Karrar Battle Tank/, /SHP sprite/, /vehicles\/r2karrar\.shp/, /3D model <code>units\/r2karrar\/candidates\/[^<]+\.glb<\/code>/, /Give feedback on this unit|art-viewer/],
    "/art/china/r2cnrifle": [/SHP sprite/, /infantry\/r2cnrifle\.shp/],
  };
  for (const [path, patterns] of Object.entries(pages)) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, noindex, `${path} is noindex`);
    for (const pattern of patterns) assert.match(html, pattern, `${path} shows ${pattern}`);
  }
  assert.equal((await render("/art/china/r2karrar")).status, 404, "an actor under the wrong faction is not found");
});

test("the local Studio route and its API stay out of production; the shared Studio reads the published snapshot", async () => {
  // Admin builds 404 (the local Studio serves the path itself); public builds send only the owner's card naming the art
  // workspace review needs (lib/admin.ts), never the review data.
  const review = await render("/art/review");
  if (adminBuild) assert.equal(review.status, 404);
  else assert.doesNotMatch(await review.text(), /r2karrar|r2cnrifle|mapTints/, "no review data in a public build");
  assert.notEqual((await render("/api/art-review/state")).status, 200);
  for (const path of ["/api/art-review/roster?mode=classic", "/api/art-review/classic/e1.shp", "/api/art-review/mod/example.pal", "/api/art-review/duel", "/api/art-review/visual?mode=ra2&image=explosion&sequence=medium_clsn&palette=effect"]) assert.notEqual((await render(path)).status, 200, path);
  const artLab = await (await render("/art")).text();
  assert.doesNotMatch(artLab, /href="\/art\/review"/, "no Review tab in production");
  // Everyone can open the Faction Studio read-only: RTS AI's factions, the original countries and the mod library.
  const shared = await render("/faction-studio");
  assert.equal(shared.status, 200);
  const html = await shared.text();
  assert.match(html, /EA has not endorsed and does not support this product\./, "EA's modding-guideline notice is shown");
  const snapshot = JSON.parse(readFileSync(new URL("../data/studio-snapshot.json", import.meta.url), "utf8"));
  if (snapshot.index) assert.match(snapshot.index, /^https:\/\/rtsai-studio\.pages\.dev\/s\//, "the snapshot is hosted (Cloudflare Pages), not read from local files");
});

test("the Art Lab stays out of the sitemap and is not linked from live pages", async () => {
  const sitemap = await (await render("/sitemap.xml")).text();
  assert.doesNotMatch(sitemap, /\/art\b/);
  for (const path of ["/", "/factions", "/factions/china?mode=ra2", "/units/cnqilin?mode=ra2", "/download"]) {
    const html = await (await render(path)).text();
    assert.doesNotMatch(html, /href="\/art[/"]/, `${path} does not link the internal Art Lab`);
  }
});

test("public faction and unit pages show the project's own art as images; three.js loads only on demand", async () => {
  const faction = await (await render("/factions/china?mode=ra2")).text();
  assert.match(faction, /\/faction-art\/units\/r2qilin-480\.[0-9a-f]{12}\.avif/);
  assert.match(faction, /\/faction-art\/cameos\/r2qilin\.[0-9a-f]{12}\.png/);
  const unit = await (await render("/units/cnqilin?mode=ra2")).text();
  assert.match(unit, /\/faction-art\/sprites\/r2qilin\.[0-9a-f]{12}\.webp/, "the in-game sprite animates on the unit page");
  assert.match(unit, /fetchpriority="high"/i, "the unit render is the page's priority image");
  for (const html of [faction, unit, await (await render("/")).text()]) assert.doesNotMatch(html, /voxel-three/, "three.js is not preloaded");
  const chunks = new URL("../dist/client/_next/static/chunks/", import.meta.url);
  for (const chunk of readdirSync(chunks)) {
    if (chunk.startsWith("voxel-three")) continue;
    const source = readFileSync(new URL(chunk, chunks), "utf8");
    assert.doesNotMatch(source, /WebGLRenderer/, `${chunk} does not bundle three.js`);
    // The voxel engine (the Faction viewer's renderer) may import three.js statically: it is itself only ever loaded
    // on demand, which the same rule checks for every chunk that names it.
    const lazy = chunk.startsWith("voxel-engine") ? /voxel-engine-[\w-]+\.js/g : /voxel-(?:three|engine)-[\w-]+\.js/g;
    for (const m of source.matchAll(lazy)) {
      const before = source.slice(Math.max(0, m.index - 20), m.index);
      assert.ok(/(import\([`"]\.\/|_next\/static\/chunks\/)$/.test(before), `${chunk} loads three.js dynamically only`);
    }
  }
});

// Original RA2 files (EA copyright) live only in the gitignored .cache/ and are served only by the dev API.
test("no original RA2 file reaches the production build (by name or by content)", async () => {
  assert.equal((await render("/api/art-review/roster")).status === 200, false, "the roster API does not exist in production");
  assert.equal((await render("/api/art-review/ra2/gi.shp")).status === 200, false);
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  const walk = dir => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
  const built = walk(dist);
  const cache = fileURLToPath(new URL("../.cache/ra2-originals/files/", import.meta.url));
  const classicCache = fileURLToPath(new URL("../.cache/classic-originals/files/", import.meta.url));
  const originals = existsSync(cache) ? readdirSync(cache) : [];
  const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
  const originalHashes = new Set(originals.map(name => hash(join(cache, name))));
  const names = new Set(originals.map(n => n.toLowerCase()));
  for (const name of existsSync(classicCache) ? readdirSync(classicCache) : []) { names.add(name.toLowerCase()); originalHashes.add(hash(join(classicCache, name))); }
  for (const path of built) {
    const base = basename(path).toLowerCase();
    assert.ok(!names.has(base), `${path} has the name of an original RA2 file`);
    assert.ok(!originalHashes.has(hash(path)), `${path} is byte-identical to an original RA2 file`);
    if (/\.(js|mjs|css|html|json)$/.test(path)) assert.doesNotMatch(readFileSync(path, "utf8"), /ra2-originals|\/api\/art-review\/ra2\//, `${path} references the originals cache or route`);
  }
});
