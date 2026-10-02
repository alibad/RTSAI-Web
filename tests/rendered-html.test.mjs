import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`https://rtsai.net${pathname}`, { headers: { accept: "text/html", host: "rtsai.net" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders a focused homepage: the RA2 mod promise, three pillars, factions, and an honest download path", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>RTS AI/);
  assert.match(html, /rel="canonical" href="https:\/\/rtsai\.net\/?"/);
  assert.match(html, /name="robots" content="index, follow/);
  assert.match(html, /property="og:image" content="https:\/\/rtsai\.net\/social-card\.png"/);
  assert.match(html, /href="\/manifest\.webmanifest"/);
  assert.match(html, /\/brand\/rtsai-mark-64\.png/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"SoftwareApplication"/);
  assert.match(html, /"VideoGame"/);
  assert.match(html, /Your battlefield/);
  assert.match(html, /A Red Alert 2 mod for OpenRA/);
  assert.match(html, /Download (?:<!-- -->)?0\.1\.0-alpha\.13/);
  assert.match(html, /WHAT YOU GET/);
  assert.match(html, /Five modern nations/);
  assert.match(html, /An AI co-commander/);
  assert.match(html, /Red Alert 2 on OpenRA/);
  assert.match(html, /Türkiye/);
  assert.match(html, /Interactive AI companion preview/);
  assert.match(html, /Red Sea 2026/);
  assert.match(html, /AUTO when you say so/);
  assert.match(html, /href="\/companion"/);
  assert.match(html, /href="\/factions"/);
  assert.match(html, /href="\/download"/);
  // Parked surfaces leave the story and the navigation.
  assert.doesNotMatch(html, /href="\/(?:studio|capabilities|platform)/);
  assert.doesNotMatch(html, /Earth to battlefield|Earth studio|Capability Atlas|TWO CORE EXPERIENCES|Haitian/);
  assert.doesNotMatch(html, /Same seed reproduces the same terrain/);
  assert.doesNotMatch(html, /Optional Local AI Pack/);
  assert.doesNotMatch(html, /Help improve RTS AI/);
  assert.match(html, /href="\/privacy"/);
  assert.doesNotMatch(html, /Map attribution/);
  assert.match(html, /EA has not endorsed and does not support this product/);
  assert.match(html, />Feedback</);
  assert.match(html, /windows-x64-setup\.exe/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/);
});

test("renders companion and download routes; parked routes stay reachable but unindexed", async () => {
  const [companion, studio, platform, capabilityAtlas, download] = await Promise.all([
    render("/companion").then((response) => response.text()),
    render("/studio").then((response) => response.text()),
    render("/platform").then((response) => response.text()),
    render("/capabilities").then((response) => response.text()),
    render("/download").then((response) => response.text()),
  ]);

  assert.match(companion, /AI GAME COMPANION/);
  assert.match(companion, /Helpful enough to speak/);
  assert.match(companion, /AI layer/);
  assert.doesNotMatch(companion, /href="\/capabilities/);
  for (const parked of [studio, platform, capabilityAtlas]) assert.match(parked, /name="robots" content="noindex, follow"/);
  assert.match(studio, /EARTH TO BATTLEFIELD/);
  assert.match(studio, /Mission studio/);
  assert.match(studio, /Point anywhere/);
  assert.match(studio, /Earth footprint/);
  assert.match(studio, /Variation seed/);
  assert.match(studio, /Same seed reproduces the same terrain/);
  assert.match(studio, /Reroll/);
  assert.match(studio, /Read geometry/);
  assert.match(studio, /Build terrain/);
  assert.match(studio, /A visible translation, not a magic button/);
  assert.match(studio, /href="\/capabilities#map-validation"/);
  assert.match(platform, /THE PRODUCT PLAN/);
  assert.match(platform, /Discover \+ launch/);
  assert.match(platform, /New theatres \+ mods/);
  assert.match(platform, /Agents that play \+ learn/);
  assert.match(platform, /PLATFORM DEPTH/);
  assert.match(platform, /href="\/capabilities#headless-commander"/);
  assert.match(capabilityAtlas, /CAPABILITY ATLAS/);
  assert.match(capabilityAtlas, /Search voice, local models, maps, agents/);
  assert.match(capabilityAtlas, /Adaptive battlefield briefings/);
  assert.match(capabilityAtlas, /Passability \+ connectivity validation/);
  assert.match(capabilityAtlas, /Red Sea 2026 campaign/);
  assert.match(capabilityAtlas, /Iran distributed-denial faction/);
  assert.match(capabilityAtlas, /Türkiye combined-arms faction/);
  assert.match(capabilityAtlas, /China networked-force faction/);
  assert.match(capabilityAtlas, /Headless autonomous commander/);
  assert.match(capabilityAtlas, /Provider-neutral AI routing/);
  assert.match(capabilityAtlas, /Verified Windows release/);
  assert.match(capabilityAtlas, /Product boundary/);
  assert.match(capabilityAtlas, /Playable now/);
  assert.match(capabilityAtlas, /Research track/);
  assert.match(capabilityAtlas, /THE BUILD ARCHIVE/);
  assert.match(capabilityAtlas, /See the factions/);
  assert.match(capabilityAtlas, /216<\/b> optimized visual artifacts/);
  assert.match(capabilityAtlas, /Red Sea 2026 key art/);
  assert.match(capabilityAtlas, /Türkiye/);
  assert.match(capabilityAtlas, /China/);
  assert.match(capabilityAtlas, /Open public manifest/);
  assert.doesNotMatch(capabilityAtlas, /BeTenshi/i);
  assert.match(download, /Locally built and smoke-tested/);
  assert.match(download, /Download Windows setup/);
  assert.match(download, /data-analytics-event="game-download"/);
  assert.match(download, /Portable ZIP/);
  assert.match(download, /Apple silicon/);
  assert.match(download, /signed and notarized disk image/);
  assert.doesNotMatch(download, /Signed macOS download pending/);
  assert.match(download, /Install or extract/);
  assert.match(download, /Play-Red-Sea-2026\.cmd/);
  assert.match(download, /Optional Local AI Pack/);
  assert.match(download, /Qwen3-VL/);
  assert.match(download, /PUBLIC BUILDS/);
  assert.match(download, /WINDOWS 0\.1\.0-alpha\.13 \/ MACOS 0\.1\.0-alpha\.13/);
  assert.match(download, /Red Alert 2 and Yuri/);
});

test("faction-to-unit-to-install journey retains mode and refuses unsupported combinations", async () => {
  const directory = await (await render("/factions?mode=ra2")).text();
  assert.match(directory, /5(?:<!-- -->)? faction variants/);
  const defaultDirectory = await (await render("/factions")).text();
  assert.match(defaultDirectory, /\/factions\/china\?mode=ra2/);
  assert.match(directory, /\/factions\/china\?mode=ra2/);
  assert.match(directory, /\/factions\/yemen\?mode=ra2/);
  assert.doesNotMatch(directory, /Coming to Red Alert 2/);
  const dossier = await (await render("/factions/china?mode=ra2")).text();
  assert.match(dossier, /\/units\/cnqilin\?mode=ra2/);
  assert.match(dossier, /not screenshots of RA2 gameplay/);
  const unit = await (await render("/units/cnqilin?mode=ra2")).text();
  assert.match(unit, /<code>r2qilin<\/code>/);
  assert.match(unit, /<h1>Qilin Battle Tank<\/h1>/);
  assert.match(unit, /\/download\?faction=china&amp;mode=ra2/);
  const classic = await (await render("/units/cnqilin?mode=ra")).text();
  assert.match(classic, /<code>CNQILIN<\/code>/);
  assert.match(classic, /<h1>Qilin Main Battle Tank<\/h1>/);
  const yemen = await (await render("/factions/yemen?mode=ra2")).text();
  assert.match(yemen, /\/units\/tech\?mode=ra2/);
  assert.doesNotMatch(yemen, /No roster in this mode yet/);
  const saudiUnit = await (await render("/units/sang?mode=ra2")).text();
  assert.match(saudiUnit, /<code>r2sang<\/code>/);
  assert.match(saudiUnit, /<h1>Saudi National Guard<\/h1>/);
  const download = await (await render("/download?faction=china&mode=ra2")).text();
  assert.match(download, /China \/ Red Alert 2/);
  assert.match(download, /not the newer local dual-mode build/);
  assert.match(download, /v0\.1\.0-alpha\.13/);
  assert.doesNotMatch(download, /href="[^"]*windows-dual/);
  for (const path of ["/factions/nonexistent", "/units/nonexistent"]) {
    const response = await render(path);
    assert.equal(response.status, 404, path);
  }
});

test("keeps account identity out of Analytics event parameters", async () => {
  const analytics = await readFile(new URL("../lib/firebase-client.ts", import.meta.url), "utf8");
  const auth = await readFile(new URL("../app/components/AuthProvider.tsx", import.meta.url), "utf8");
  const authDialog = await readFile(new URL("../app/components/AuthDialog.tsx", import.meta.url), "utf8");
  const accountNav = await readFile(new URL("../app/components/AccountNav.tsx", import.meta.url), "utf8");
  const missionStudio = await readFile(new URL("../app/components/MissionStudio.tsx", import.meta.url), "utf8");
  const privacy = await readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");
  const feedback = await readFile(new URL("../app/components/FeedbackPanel.tsx", import.meta.url), "utf8");

  assert.match(analytics, /setUserId\(analytics, uid\)/);
  assert.doesNotMatch(analytics, /setUserId\(analytics,.*displayName/);
  assert.doesNotMatch(analytics, /setUserId\(analytics,.*email/);
  assert.doesNotMatch(auth, /rtsai-analytics-consent/);
  assert.match(authDialog, /GoogleAuthProvider/);
  assert.match(authDialog, /signInWithPopup/);
  assert.match(authDialog, /Sign up with Google/);
  assert.match(accountNav, /Sign in/);
  assert.match(accountNav, /user\.photoURL/);
  assert.match(accountNav, /providerData\.find/);
  assert.match(accountNav, /referrerPolicy="no-referrer"/);
  assert.match(accountNav, /accountInitials/);
  assert.match(missionStudio, /Account required for AI work/);
  assert.match(privacy, /do not send your name, email/);
  assert.match(privacy, /Written feedback and diagnostics are never sent to Google Analytics/);
  assert.doesNotMatch(feedback, /trackAnalyticsEvent|feedback_submitted/);
  assert.match(feedback, /Select page element/);
  assert.match(feedback, /getConsoleLogs/);
  assert.match(feedback, /getNetworkLogs/);
});

test("ships crawl, install, and brand assets", async () => {
  const robots = await readFile(new URL("../app/robots.ts", import.meta.url), "utf8");
  const sitemap = await readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../app/manifest.ts", import.meta.url), "utf8");
  const favicon = await readFile(new URL("../public/favicon.ico", import.meta.url));
  const socialCard = await readFile(new URL("../public/social-card.png", import.meta.url));
  const googleLogo = await readFile(new URL("../public/brand/google-g.png", import.meta.url));
  const redSeaKeyArt = await readFile(new URL("../public/red-sea-2026-key-art.webp", import.meta.url));

  assert.match(robots, /sitemap: "https:\/\/rtsai\.net\/sitemap\.xml"/);
  assert.match(sitemap, /url: "https:\/\/rtsai\.net\/"/);
  assert.doesNotMatch(sitemap, /rtsai\.net\/(?:capabilities|platform|studio)"/);
  assert.match(manifest, /short_name: "RTS AI"/);
  assert.match(manifest, /purpose: "maskable"/);
  assert.ok(favicon.byteLength > 1000);
  assert.ok(socialCard.byteLength > 10_000);
  assert.ok(googleLogo.byteLength > 500);
  assert.ok(redSeaKeyArt.byteLength > 100_000);
});

test("ships a real browser-side OpenRA package compiler", async () => {
  const source = await readFile(new URL("../lib/oramap.ts", import.meta.url), "utf8");
  assert.match(source, /MapFormat: 12/);
  assert.match(source, /Tileset: TEMPERAT/);
  assert.match(source, /map\.bin/);
  assert.match(source, /openra-ai-manifest\.json/);
  assert.match(source, /zipSync/);
  assert.match(source, /spawn/);
  assert.match(source, /\/api\/earth-features/);
});

test("serves committed native Windows and macOS release assets", async () => {
  const source = await readFile(new URL("../lib/release.ts", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../data/openra-ai-release.json", import.meta.url), "utf8"));
  const page = await readFile(new URL("../app/download/page.tsx", import.meta.url), "utf8");
  assert.match(manifest.windows.installerUrl, /windows-x64-setup\.exe$/);
  assert.match(manifest.macos.assets[0].url, /macos-arm64\.dmg$/);
  assert.match(manifest.windows.installerChecksumUrl, /setup\.exe\.sha256$/);
  assert.match(manifest.windows.aiPackUrl, /AI-Pack-/);
  assert.match(manifest.windows.aiPackChecksumUrl, /\.zip\.sha256$/);
  assert.equal(manifest.windows.version, "0.1.0-alpha.13");
  assert.equal(manifest.windows.authenticode, "unsigned");
  assert.match(source, /openra-ai-release\.json/);
  assert.doesNotMatch(source, /api\.github\.com|fetch\(/);
  assert.match(page, /No placeholder download/);
});

test("keeps site metadata on the RA2 mod while the parked platform page still builds", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/platform/page.tsx", import.meta.url), "utf8");
  const plan = await readFile(new URL("../lib/product-plan.ts", import.meta.url), "utf8");

  assert.match(layout, /Red Alert 2 with an AI Co-Commander/);
  assert.doesNotMatch(layout, /Earth mission|autonomous game agent/);
  assert.doesNotMatch(layout, /Red Sea 2026/);
  assert.match(plan, /export const productLayers/);
  assert.match(plan, /export const currentShowcase/);
  assert.match(page, /productLayers\.map/);
  assert.match(page, /currentShowcase\.title/);
  assert.doesNotMatch(page, /Saudi Arabia and Yemen join/);
});
