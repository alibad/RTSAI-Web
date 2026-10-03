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

test("the Faction Art Lab renders and is never indexed", async () => {
  const pages = {
    "/art": [/Faction Art Lab/, /Five-faction comparison/, /href="\/art\/saudi"/],
    "/art/china": [/Qilin Battle Tank/, /Build-palette cameos/, /model sequence “rotor”/],
    "/art/iran/r2karrar": [/Karrar Battle Tank/, /How the parts come together/, /Generator source/, /github\.com\/alibad\/OpenRA-AI\/blob\/[0-9a-f]{40}\/scripts\//, /Give feedback on this unit|art-viewer/],
    "/art/china/r2cnrifle": [/SHP sprite/, /china-art\/r2cnrifle\.shp/],
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

test("Review mode and its API do not exist in the production build", async () => {
  assert.equal((await render("/art/review")).status, 404);
  assert.notEqual((await render("/api/art-review/state")).status, 200);
  const artLab = await (await render("/art")).text();
  assert.doesNotMatch(artLab, /href="\/art\/review"/, "no Review tab in production");
  const chunks = readdirSync(new URL("../dist/client/_next/static/chunks/", import.meta.url));
  for (const chunk of chunks) {
    const source = readFileSync(new URL(`../dist/client/_next/static/chunks/${chunk}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /Use this in game|Nothing ships until export|Note for the Forge|renderInGameAsync|\/api\/art-review/, `${chunk} carries no review code`);
  }
});

test("the Art Lab stays out of the sitemap and is not linked from live pages", async () => {
  const sitemap = await (await render("/sitemap.xml")).text();
  assert.doesNotMatch(sitemap, /\/art\b/);
  for (const path of ["/", "/factions", "/factions/china?mode=ra2", "/units/cnqilin?mode=ra2", "/download"]) {
    const html = await (await render(path)).text();
    assert.doesNotMatch(html, /href="\/art[/"]/, `${path} does not link the internal Art Lab`);
  }
});

test("public faction and unit pages embed the shared viewers; three.js loads only on demand", async () => {
  const faction = await (await render("/factions/china?mode=ra2")).text();
  assert.match(faction, /The full roster at in-game scale/);
  assert.match(faction, /not a release announcement/);
  const unit = await (await render("/units/cnqilin?mode=ra2")).text();
  assert.match(unit, /IN GAME · RED ALERT 2/);
  const classic = await (await render("/units/cnqilin?mode=ra")).text();
  assert.doesNotMatch(classic, /IN GAME · RED ALERT 2/, "Classic mode keeps its own art");
  for (const html of [faction, unit, await (await render("/")).text()]) assert.doesNotMatch(html, /voxel-three/, "three.js is not preloaded");
  const chunks = new URL("../dist/client/_next/static/chunks/", import.meta.url);
  for (const chunk of readdirSync(chunks)) {
    if (chunk.startsWith("voxel-three")) continue;
    const source = readFileSync(new URL(chunk, chunks), "utf8");
    assert.doesNotMatch(source, /WebGLRenderer/, `${chunk} does not bundle three.js`);
    for (const m of source.matchAll(/voxel-three-[\w-]+\.js/g)) {
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
  const originals = existsSync(cache) ? readdirSync(cache) : [];
  const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
  const originalHashes = new Set(originals.map(name => hash(join(cache, name))));
  const names = new Set(originals.map(n => n.toLowerCase()));
  for (const path of built) {
    const base = basename(path).toLowerCase();
    assert.ok(!names.has(base), `${path} has the name of an original RA2 file`);
    assert.ok(!originalHashes.has(hash(path)), `${path} is byte-identical to an original RA2 file`);
    if (/\.(js|mjs|css|html|json)$/.test(path)) assert.doesNotMatch(readFileSync(path, "utf8"), /ra2-originals|\/api\/art-review\/ra2\//, `${path} references the originals cache or route`);
  }
});
