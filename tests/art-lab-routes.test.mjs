import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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
    assert.doesNotMatch(source, /How review works|Export chosen assets|\/api\/art-review/, `${chunk} carries no review code`);
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
