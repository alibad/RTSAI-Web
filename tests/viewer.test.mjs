import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

// The viewer is members-only (SignInGate): with Firebase configured the server renders only the gate, because sign-in
// is known in the browser. These checks read the viewer itself, so they need a build without NEXT_PUBLIC_FIREBASE_*.
async function render(pathname) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://rtsai.net${pathname}`, { headers: { accept: "text/html", host: "rtsai.net" }, redirect: "manual" }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}
const adminBuild = process.env.RTSAI_ADMIN === "1";
// What only the admin build may show: the Studio, History, candidates and the dev API.
const adminOnly = /Open in the Studio|Historical|History<\/summary>|candidate|\/api\/art-review/;

test("the Faction viewer: every modern faction, its units drawn from the game's art, doctrine and campaigns", async () => {
  for (const id of ["china", "iran", "turkey", "saudi-arabia", "yemen", "israel", "hezbollah"]) {
    const response = await render(`/viewer/${id}`);
    assert.equal(response.status, 200, id);
    const html = await response.text();
    assert.doesNotMatch(html, /signin-gate/, "build without NEXT_PUBLIC_FIREBASE_* to test the viewer's content (it is members-only)");
    assert.match(html, /Faction viewer/);
    assert.match(html, /Campaigns/, `${id} surfaces campaigns`);
    assert.match(html, /\/faction-art\/cameos\/r2[a-z0-9]+\.[0-9a-f]{12}\.png/, `${id} lists its units by their approved cameos`);
    if (!adminBuild) assert.doesNotMatch(html, adminOnly, `${id} carries no admin material`);
  }
  const china = await (await render("/viewer/china")).text();
  assert.match(china, /Qilin Battle Tank/);
  assert.match(china, /Shared units/, "the original units the faction builds are listed");
  assert.match(china, /Engineer/);
  assert.match(china, /No campaign is written for China yet/, "an honest empty state");
  assert.match(china, /Between the Lines/, "the campaigns that exist are listed, read-only");
  assert.match(china, /<link rel="canonical" href="https:\/\/rtsai\.net\/viewer\/china"/);
});

test("the Faction viewer carries each faction's narrative: its own voice, its rivals' views with the framing, no flavour", async () => {
  const html = (await (await render("/viewer/hezbollah")).text()).replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
  assert.match(html, /Patience is our armor\./, "the motto, in the faction's voice");
  assert.match(html, /In their own words/);
  assert.match(html, /Through their rivals’ eyes/);
  assert.match(html, /href="\/viewer\/israel"/, "each rival links to its own viewer");
  assert.match(html, /In-world perspectives in a fictional game conflict/, "the framing note sits with the rival views");
  // Loading lines and audio-team notes are game-only: neither in the page nor in any client chunk.
  assert.doesNotMatch(html, /voiceIdeas|"loading":/);
  const dir = new URL("../dist/client/_next/static/chunks/", import.meta.url);
  for (const chunk of readdirSync(dir)) assert.doesNotMatch(readFileSync(new URL(chunk, dir), "utf8"), /voiceIdeas/, `${chunk} carries no flavour`);
});

test("a unit in the viewer: stats, weapons and doctrine; original units are text only", async () => {
  const response = await render("/viewer/china/r2qilin");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Qilin Battle Tank · China · Faction viewer \| RTS AI<\/title>/);
  assert.match(html, /Weapons/);
  assert.match(html, /HP · Heavy/);
  assert.match(html, /Read the full dossier/);
  assert.match(html, /Voice and sound/);
  assert.match(html, /\/faction-audio\/rcn-vehicle-select-zh\.[0-9a-f]{12}\.mp3/, "the unit's own voice lines are published");
  assert.match(html, /装甲平台在线/, "with what they say");
  if (!adminBuild) assert.doesNotMatch(html, adminOnly);
  const engineer = await (await render("/viewer/china/engineer")).text();
  assert.match(engineer, /An (<!-- -->)?Original roster(<!-- -->)? unit, in Westwood’s original art/, "original units are distinguished and drawn with Westwood's art (loaded in the browser)");
  assert.doesNotMatch(engineer.replace(/<script[\s\S]*?<\/script>/g, ""), /Red Alert 2 unit|Red Alert 2 sounds/, "no Red Alert 2 framing in the visible text");
  assert.doesNotMatch(engineer, /\/api\/art-review|ra2\/[a-z]+\.shp/, "no original art is fetched or named");
  for (const path of ["/viewer/china/r2nope", "/viewer/narnia", "/viewer/china/r2karrar"]) assert.equal((await render(path)).status, 404, path);
  const index = await render("/viewer");
  assert.ok([307, 308].includes(index.status), "/viewer opens the first faction");
  assert.match(index.headers.get("location") ?? "", /\/viewer\/china$/);
});

test("the Faction viewer covers the nine original countries, their whole rosters in Westwood's art", async () => {
  const html = (await (await render("/viewer/china")).text()).replace(/&#x27;|&#39;/g, "'");
  for (const id of ["america", "germany", "england", "france", "korea", "cuba", "libya", "iraq", "russia"]) assert.match(html, new RegExp(`href="/viewer/${id}"`), `the faction rail offers ${id}`);
  for (const [id, own] of [["america", "American Airfield"], ["korea", "Strike Fighter"], ["russia", "Arc Tank"], ["iraq", "Area Denial Trooper"]]) {
    const response = await render(`/viewer/${id}`);
    assert.equal(response.status, 200, id);
    const page = (await response.text()).replace(/&#x27;|&#39;/g, "'").replace(/<!-- -->/g, "");
    assert.match(page, /Original country/, `${id} is introduced as an original country`);
    assert.match(page, new RegExp(own), `${id} lists what only it builds`);
    assert.match(page, /EA has not endorsed and does not support this product/, `${id} carries EA's notice`);
    assert.doesNotMatch(page, /Shared units/, `${id} lists its whole roster by build tab, not as shared units`);
    if (!adminBuild) assert.doesNotMatch(page, adminOnly);
  }
  const unit = await render("/viewer/russia/ttnk");
  assert.equal(unit.status, 200);
  assert.match(await unit.text(), /Arc Tank/);
  assert.match(await (await render("/factions/russia?mode=ra2")).text(), /href="\/viewer\/russia"/, "an original country's page opens it in the viewer");
});

test("faction and unit pages link into the viewer, and it is in the sitemap", async () => {
  assert.match(await (await render("/factions/china?mode=ra2")).text(), /href="\/viewer\/china/);
  assert.match(await (await render("/units/cnqilin?mode=ra2")).text(), /href="\/viewer\/china\/r2qilin"/);
  const sitemap = await (await render("/sitemap.xml")).text();
  for (const id of ["china", "saudi-arabia", "hezbollah", "america", "russia"]) assert.match(sitemap, new RegExp(`/viewer/${id}<`));
});

test("public builds carry no admin viewer code", { skip: adminBuild }, () => {
  const dir = new URL("../dist/client/_next/static/chunks/", import.meta.url);
  for (const chunk of readdirSync(dir)) {
    // The shared Faction Studio (/faction-studio) ships its own chunks: it reads the Studio API from the published
    // snapshot (lib/art-lab/studio-snapshot.ts), read-only. The public Faction viewer stays free of admin code.
    if (/^(ReviewApp|SharedStudio|mesh-view)-/.test(chunk)) continue;
    const source = readFileSync(new URL(chunk, dir), "utf8");
    assert.doesNotMatch(source, /Open in the Studio|Historical only|history\.css|\/api\/art-review/, `${chunk} carries no admin viewer code`);
  }
});

test("the admin build adds the Studio link (History loads from the local dev API)", { skip: !adminBuild }, async () => {
  assert.match(await (await render("/viewer/china/r2qilin")).text(), /Open in the Studio/);
});
