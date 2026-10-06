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

// Admin tools render only in an admin build (RTSAI_ADMIN=1 npm test); public builds must answer 404 (lib/admin.ts).
const adminBuild = process.env.RTSAI_ADMIN === "1";

test("public builds leave the admin Workshop tools out: 404, no nav links, not in the sitemap", { skip: adminBuild }, async () => {
  for (const path of ["/workshop/campaigns?mode=ra2", "/workshop/evals?mode=ra"]) assert.equal((await render(path)).status, 404, path);
  const workshop = await (await render("/workshop?mode=ra2")).text();
  assert.doesNotMatch(workshop, /href="\/workshop\/(?:campaigns|evals)/);
  assert.doesNotMatch(workshop, /Campaign studio|AI testing/);
  const sitemap = await (await render("/sitemap.xml")).text();
  assert.doesNotMatch(sitemap, /workshop\/(?:campaigns|evals)/);
});

test("campaign studio renders real editing, local video and fictional civilian starter in both modes", { skip: !adminBuild }, async () => {
  for (const mode of ["ra2", "ra"]) {
    const response = await render(`/workshop/campaigns?mode=${mode}`), html = await response.text();
    assert.equal(response.status, 200); assert.match(html, /<title>Campaign Story Builder/);
    assert.match(html, /Between the Lines/); assert.match(html, /The Last Light/); assert.match(html, /What Remains/);
    assert.match(html, /Generate intro video/); assert.match(html, /Playtest mission/); assert.match(html, /Export campaign/);
    assert.match(html, /no paid AI model is called/); assert.match(html, /Silent motion preview/);
    assert.match(html, /not a verified historical account/); assert.match(html, /Story playthrough/);
    assert.match(html, /aria-label="Undo campaign edit"/); assert.match(html, /Campaign studio/);
    assert.doesNotMatch(html, /â†|Â·|â€“/);
  }
});

test("new faction dossiers show their art, complete rosters and honest release status in both modes", async () => {
  for (const faction of ["israel", "hezbollah"]) for (const mode of ["ra", "ra2"]) {
    const response = await render(`/factions/${faction}?mode=${mode}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Units, buildings &amp; defenses/);
    assert.match(html, /Development · release unconfirmed/);
    assert.match(html, new RegExp(`/faction-art/lineups/${faction}-1440\\.[0-9a-f]{12}\\.avif`));
    assert.ok((html.match(/class="roster-card"/g) ?? []).length >= 16, `${faction}/${mode} shows its own units as cards`);
    assert.match(html, faction === "israel" ? /Coordination Relay/ : /Signal Post/);
    if (faction === "israel") assert.match(html, /src="\/faction-art\/flags\/israel\.[0-9a-f]{12}\.svg"/);
    // Non-state faction: an original emblem, never a flag.
    else { assert.doesNotMatch(html, /\/faction-art\/flags\/hezbollah/); assert.match(html, /Hezbollah faction emblem/); }
  }
  const observer = await (await render('/units/ilobserver?mode=ra')).text();
  assert.match(observer, /light defensive weapon/);
  assert.doesNotMatch(observer, /no direct damage/);
});

test("AI evaluations render both modes, policy controls and separated native evidence",{skip:!adminBuild},async()=>{
  for(const mode of ["ra2","ra"]){const response=await render("/workshop/evals?mode="+mode),html=await response.text();assert.equal(response.status,200);assert.match(html,/<title>AI Behavior Lab/);assert.match(html,/Run comparison/);assert.match(html,/Run native comparison/);assert.match(html,/browser simulator|approximate simulator/);assert.match(html,/Neither is a model-quality evaluation/);assert.match(html,/Native arenas use a fixed separation/);assert.match(html,/Use saved Workshop scene/);assert.match(html,/Export evidence/);assert.doesNotMatch(html,/â†|Â·|â€“/);}
});

test("owner-approved Workshop renders both mode palettes and honest experiment controls", async () => {
  for (const mode of ["ra2", "ra"]) {
    const response=await render("/workshop?mode="+mode),html=await response.text();
    assert.equal(response.status,200);
    assert.match(html,/<title>Map Workshop/);
    assert.match(html,/href="\/workshop"/);
    assert.match(html,/Interactive battlefield/);
    assert.match(html,/Save scene/);assert.match(html,/Load scene/);assert.match(html,/OpenRA map/);
    assert.match(html,/Run battle/);assert.match(html,/Terrain generator/);
    assert.match(html,/Illustrated browser prototype/);assert.match(html,/simplified combat/);
    assert.match(html,/native engine testing/);
    const {rosters}=JSON.parse(await readFile(new URL("../data/factions.generated.json",import.meta.url),"utf8"));
    const faction=rosters.factions.find(f=>f.mode===mode&&f.id==="china");
    for(const key of faction.actors)assert.ok(html.includes(rosters.actors.find(a=>a.key===key).name),key);
    assert.doesNotMatch(html,/href="\/(?:studio|capabilities|platform)/);
  }
});

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
  assert.match(html, /Distinct factions/);
  assert.match(html, /An AI co-commander/);
  assert.match(html, /Red Alert 2 on OpenRA/);
  assert.match(html, /<i>In development<\/i>/, "pillar 3 says In development until the mod manifest is published");
  assert.doesNotMatch(html, /<i>Alpha<\/i>/);
  assert.match(html, /Classic alpha download/);
  assert.match(html, /RA2 in development · Classic alpha available now/);
  assert.match(html, /EXAMPLE SCENARIOS/);
  assert.doesNotMatch(html, /COMPANION \/ LIVE|1\.4s/);
  assert.doesNotMatch(html, /RTSAI-Mod\/releases|Download RTS AI (?:<!-- -->)?\d/);
  assert.match(html, /Türkiye/);
  assert.match(html, /Interactive AI companion preview/);
  assert.doesNotMatch(html, /<video/, "no trailer files, so the hero keeps the CompanionDemo");
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
  const media = JSON.parse(await readFile(new URL("../public/game-media/manifest.json", import.meta.url), "utf8"));
  assert.match(capabilityAtlas, new RegExp(`${media.length}</b> optimized visual artifacts`));
  assert.match(capabilityAtlas, /Red Sea 2026 key art/);
  assert.match(capabilityAtlas, /Türkiye/);
  assert.match(capabilityAtlas, /China/);
  assert.match(capabilityAtlas, /Open public manifest/);
  assert.doesNotMatch(capabilityAtlas, /BeTenshi/i);
  // The previous Classic alpha stays downloadable, as a clearly secondary section.
  assert.match(download, /id="classic-alpha"/);
  assert.match(download, /Previous Classic alpha/);
  assert.match(download, /PREVIOUS CLASSIC ALPHA \/ 0\.1\.0-alpha\.13/);
  assert.match(download, /not Red Alert 2/);
  assert.match(download, /data-analytics-event="game_download"/);
  assert.match(download, /windows-x64-setup\.exe/);
  assert.match(download, /Portable ZIP/);
  assert.match(download, /Apple silicon/);
  assert.match(download, /signed and notarized disk image/);
  assert.match(download, /Classic Local AI Pack/);
});

test("the download page leads with the RA2 requirement and renders no mod links before a published release", async () => {
  const html = await (await render("/download")).text();
  const requirement = String.raw`You need your own Red Alert 2 \(Steam, EA app or disc\)\. The mod imports it on first launch; we never ship EA(?:&#x27;|&#39;|')s files\.`;
  assert.match(html, new RegExp(requirement));
  const order = [
    html.search(new RegExp(requirement)),
    html.indexOf("How should your co-commander think?"),
    html.indexOf("What your PC needs."),
    html.indexOf('id="mod-downloads"'),
    html.indexOf('id="classic-alpha"'),
  ];
  assert.ok(order.every((index) => index > 0), `every section renders: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "requirement, AI choices, requirements, downloads, then the Classic alpha");
  assert.ok(html.indexOf("<main") < order[0], "the requirement is inside the page body, before any download");

  for (const choice of ["Hosted AI + local voice", "Full local AI", "No AI", "~1.8 GB", "Default"]) assert.ok(html.includes(choice), choice);
  for (const requirementText of ["Windows 10 or 11, 64-bit", "8 GB; 16 GB recommended for Full local AI", "Your own Red Alert 2: Steam, EA app or disc"]) assert.ok(html.includes(requirementText), requirementText);
  assert.match(html, /href="\/privacy#ai-co-commander"/);

  // Unpublished: honest "coming soon", no mod links, no unsigned-build note.
  assert.match(html, /Red Alert 2 is in development/);
  assert.match(html, /Mod download not yet published/);
  assert.doesNotMatch(html, /RTSAI-Mod\/releases/);
  assert.doesNotMatch(html, /data-analytics-event="mod_download"/);
  assert.doesNotMatch(html, /not code-signed yet/);
  assert.doesNotMatch(html, /Download RTS AI (?:<!-- -->)?\d/);
  const beforeClassic = html.slice(0, html.indexOf('id="classic-alpha"'));
  assert.doesNotMatch(beforeClassic, /releases\/download/, "nothing above the Classic section links to a download");
});

test("privacy explains the hosted AI co-commander in plain language", async () => {
  const html = await (await render("/privacy")).text();
  assert.match(html, /id="ai-co-commander"/);
  for (const claim of [
    "compact snapshot of the match state",
    "up to two downscaled screenshots",
    "forwards these to Anthropic",
    "Your voice audio is transcribed on your own PC",
    "Audio is never uploaded",
    "anonymous install token",
    "No account is required",
    "IP addresses for rate limiting only",
    "Daily usage counters that expire",
    "AI Off, Local, or External",
    "Vercel",
    "Google Firebase (Cloud Firestore)",
  ]) assert.ok(html.includes(claim), claim);
  assert.match(html, /do not send your name, email/);
  assert.match(html, /Written feedback and diagnostics are never sent to Google Analytics/);
});

test("faction pages are visual and player-facing: flags, project art only, no admin material", async () => {
  const directory = await (await render("/factions?mode=ra2")).text();
  for (const id of ["china", "iran", "turkey", "saudi", "yemen", "israel", "america", "russia"]) assert.match(directory, new RegExp(`/faction-art/flags/${id}\\.[0-9a-f]{12}\\.svg`), `${id} flag`);
  assert.doesNotMatch(directory, /\/faction-art\/flags\/hezbollah/);
  assert.equal((directory.match(/\/faction-art\/lineups\/[a-z-]+-720\.[0-9a-f]{12}\.avif/g) ?? []).length >= 7, true, "every modern card shows its lineup");
  const american = await (await render("/factions/america?mode=ra2")).text();
  assert.doesNotMatch(american, /\/faction-art\/(units|cameos|sprites|lineups)\//, "original factions show flags and text only");
  assert.match(american, /Between the Lines/, "campaigns appear on the faction they are played as");
  assert.doesNotMatch(american, /href="\/workshop\/campaigns/, "no editor link on public pages");
  for (const path of ["/factions?mode=ra2", "/factions/china?mode=ra2", "/factions/hezbollah?mode=ra", "/units/cnqilin?mode=ra2", "/units/hzrifle?mode=ra2"]) {
    const html = await (await render(path)).text();
    assert.doesNotMatch(html, /\b(candidates?|unreviewed|approval pending|visual approval|review status|version history)\b/i, `${path} carries no admin material`);
    assert.doesNotMatch(html, /src="(?!\/)(?!data:)[^"]*\.(png|webp|avif|svg)"/, `${path} loads images only from this site`);
  }
});

test("faction-to-unit-to-install journey retains mode and refuses unsupported combinations", async () => {
  const directory = await (await render("/factions?mode=ra2")).text();
  assert.match(directory, /7(?:<!-- -->)? modern factions have detailed dossiers/);
  const defaultDirectory = await (await render("/factions")).text();
  assert.match(defaultDirectory, /\/factions\/china\?mode=ra2/);
  assert.match(directory, /\/factions\/china\?mode=ra2/);
  assert.match(directory, /\/factions\/yemen\?mode=ra2/);
  assert.doesNotMatch(directory, /Coming to Red Alert 2/);
  const dossier = await (await render("/factions/china?mode=ra2")).text();
  assert.match(dossier, /\/units\/cnqilin\?mode=ra2/);
  assert.match(dossier, /\/faction-art\/lineups\/china-1440\.[0-9a-f]{12}\.avif/);
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
  assert.match(download, /RA2 release not yet certified/);
  assert.match(download, /The Red Alert 2 mod has no public release yet/);
  assert.match(download, /v0\.1\.0-alpha\.13/);
  assert.doesNotMatch(download, /href="[^"]*windows-dual/);
  for (const path of ["/factions/nonexistent", "/units/nonexistent"]) {
    const response = await render(path);
    assert.equal(response.status, 404, path);
  }
});

test("the complete faction guide covers every current country and building without claiming release coverage", async () => {
  const { rosters, catalog } = JSON.parse(await readFile(new URL("../data/factions.generated.json", import.meta.url), "utf8"));
  for (const mode of ["ra2", "ra"]) {
    const directory = await (await render(`/factions?mode=${mode}`)).text();
    const countries = rosters.factions.filter(f => f.mode === mode);
    for (const country of countries) {
      const id = catalog.factions.find(f => f.variants[mode].engineFactionId === country.id)?.id ?? country.id;
      assert.ok(directory.includes(`/factions/${id}?mode=${mode}`), `${mode}/${id} has a directory card`);
      const response = await render(`/factions/${id}?mode=${mode}`);
      assert.equal(response.status, 200, `${mode}/${id}`);
      const html = await response.text();
      assert.match(html, /Units, buildings &amp; defenses/);
      for (const key of country.actors) {
        const actor = rosters.actors.find(a => a.key === key);
        const escapedName = actor.name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;");
        assert.ok(html.includes(escapedName), `${mode}/${id}: ${actor.name} is shown`);
      }
      if (mode === "ra2") assert.doesNotMatch(html, /In public Windows release/);
    }
  }
  const unavailable = await (await render("/factions/ukraine?mode=ra2")).text();
  assert.match(unavailable, /No roster in this mode/);
  assert.match(unavailable, /\/factions\/ukraine\?mode=ra/);
  const stockDownload = await (await render("/download?faction=america&mode=ra2")).text();
  assert.match(stockDownload, /America \/ Red Alert 2/);
  assert.match(stockDownload, /RA2 release not yet certified/);
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
