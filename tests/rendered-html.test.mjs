import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The committed RTS AI release manifest: published, it drives download links and faction release claims.
const modRelease = JSON.parse(await readFile(new URL("../data/rtsai-mod-release.json", import.meta.url), "utf8"));
const claimedByRelease = (id) => modRelease.published && modRelease.ra2FactionIds.includes(id);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
    assert.match(html, mode === "ra2" && claimedByRelease(faction) ? /In public Windows release/ : /Development · release unconfirmed/);
    assert.match(html, new RegExp(`/faction-art/lineups/${faction}-1440\\.[0-9a-f]{12}\\.avif`));
    assert.ok((html.match(/class="roster-card"/g) ?? []).length >= 16, `${faction}/${mode} shows its own units as cards`);
    assert.match(html, faction === "israel" ? /Coordination Relay/ : /Signal Post/);
    if (faction === "israel") assert.match(html, /src="\/faction-art\/flags\/israel\.[0-9a-f]{12}\.svg"/);
    // Owner decision (2026-10-07): Hezbollah shows its own flag like every other faction; its original emblem is retired.
    else { assert.match(html, /src="\/faction-art\/flags\/hezbollah\.[0-9a-f]{12}\.svg"/); assert.doesNotMatch(html, /faction emblem|class="faction-emblem"/); }
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
    assert.match(html,/Browser prototype/);assert.match(html,/illustrated terrain/);assert.match(html,/simplified combat/);
    assert.match(html,/native engine testing/);
    const {rosters}=JSON.parse(await readFile(new URL("../data/factions.generated.json",import.meta.url),"utf8"));
    const faction=rosters.factions.find(f=>f.mode===mode&&f.id==="china");
    for(const key of faction.actors)assert.ok(html.includes(rosters.actors.find(a=>a.key===key).name),key);
    assert.doesNotMatch(html,/href="\/(?:studio|capabilities|platform)/);
  }
});

test("renders a focused homepage: the standalone RTS AI promise, real flags, approved art and an honest release path", async () => {
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
  assert.match(html, /"VideoGame"/);
  assert.match(html, /Modern real-time strategy/);
  assert.match(html, /Seven real-world factions\.(?:<br\/>)?/);
  assert.match(html, /One fictional war\./);
  assert.match(html, /Play in your browser/);
  if (modRelease.published) assert.match(html, new RegExp(`Windows <small>${escapeRegExp(modRelease.version)}</small>`), "the Windows platform label shows the release");
  else assert.match(html, /Coming soon/);
  assert.match(html, /Nothing else to install/);
  assert.match(html, /AI co-commander/);
  assert.match(html, /Interactive AI companion preview/);
  assert.doesNotMatch(html, /<video/, "no trailer files, so the co-commander section keeps the CompanionDemo");
  assert.match(html, /AUTO when you say so/);
  for (const id of ["china", "iran", "turkey", "saudi", "yemen", "israel", "hezbollah"]) assert.match(html, new RegExp(`/faction-art/flags/${id}\\.[0-9a-f]{12}\\.svg`), `${id} flag`);
  assert.ok((html.match(/\/faction-art\/lineups\/[a-z-]+-1440\.[0-9a-f]{12}\.avif/g) ?? []).length >= 7, "the front line shows every faction's lineup");
  assert.match(html, /Türkiye/);
  // Standalone: no Red Alert in the headlines or the metadata, and nothing claimed as live or free.
  const head = html.slice(0, html.indexOf("</head>"));
  assert.doesNotMatch(head, /Red Alert|RA2|OpenRA mod/i);
  assert.match(html, /Classic and RA2-inspired modes/);
  assert.doesNotMatch(html, /own Red Alert|required.*Red Alert/i);
  assert.doesNotMatch(html, /isAccessibleForFree|"price"|Free alpha|Free playable|Out now|available now/i);
  // The home page never links release files directly; once a release is out it points to /download.
  assert.doesNotMatch(html, /RTSAI-Mod\/releases|windows-x64-setup\.exe/);
  if (modRelease.published) assert.match(html, new RegExp(`Download RTS AI (?:<!-- -->)?${escapeRegExp(modRelease.version)}`));
  else assert.doesNotMatch(html, /Download RTS AI (?:<!-- -->)?\d/);
  assert.match(html, /href="\/companion"/);
  assert.match(html, /href="\/factions"/);
  assert.match(html, /href="\/download"/);
  // Parked surfaces leave the story and the navigation.
  assert.doesNotMatch(html, /href="\/(?:studio|capabilities|platform)/);
  assert.doesNotMatch(html, /Earth to battlefield|Earth studio|Capability Atlas|TWO CORE EXPERIENCES|Haitian/);
  assert.doesNotMatch(html, /Optional Local AI Pack/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /EA has not endorsed and does not support this product/);
  assert.match(html, />Feedback</);
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
  // The earlier Classic prototype stays downloadable, collapsed and clearly secondary.
  assert.match(download, /id="classic-alpha"/);
  assert.match(download, /Earlier Classic prototype/);
  assert.match(download, /EARLIER PROTOTYPE \/ 0\.1\.0-alpha\.13/);
  assert.match(download, /it is not RTS AI/);
  assert.match(download, /data-analytics-event="game_download"/);
  assert.match(download, /windows-x64-setup\.exe/);
  assert.match(download, /Portable ZIP/);
  assert.match(download, /Apple silicon/);
  assert.match(download, /signed and notarized disk image/);
  assert.match(download, /Classic Local AI Pack/);
});

test("the download page offers the browser and Windows and needs no other game", async () => {
  const html = await (await render("/download")).text();
  assert.match(html, /Play in your browser/);
  assert.match(html, /rtsai\.net\/play/);
  assert.match(html, /Download for Windows/);
  assert.match(html, /Nothing else to install/);
  assert.doesNotMatch(html, /Bring Red Alert 2|We bring the rest|Red Alert 2 required|You need your own Red Alert 2|Steam, EA app or disc/);
  assert.match(html, /No Red Alert installation is required/);
  assert.match(html, /Classic and isometric gameplay remain part of RTS AI/);
  assert.doesNotMatch(html, /Own Red Alert 2\?/);
  assert.match(html, /EA has not endorsed and does not support this product/);
  const aiHeading = modRelease.published && !(modRelease.aiModes ?? []).length ? "No co-commander in this download yet." : "How should your co-commander think?";
  const order = [html.indexOf("Play in your browser"), html.indexOf(aiHeading), html.indexOf("What your PC needs."), html.indexOf('id="mod-downloads"'), html.indexOf('id="classic-alpha"')];
  assert.ok(order.every((index) => index > 0), `every section renders: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "ways to play, AI choices, requirements, downloads, then the earlier prototype");
  assert.doesNotMatch(html, /daily allowance|Hosted AI \+ local voice/);
  for (const requirementText of ["Windows 10 or 11, 64-bit", "RTS AI brings its own art, sound and maps"]) assert.ok(html.includes(requirementText), requirementText);

  if (!modRelease.published) {
    assert.match(html, /<title>Play RTS AI/);
    assert.equal((html.match(/aria-disabled="true">Coming soon</g) ?? []).length, 1, "Windows distribution remains unpublished");
    for (const choice of ["Full local AI", "No AI", "~1.8 GB", "Default"]) assert.ok(html.includes(choice), choice);
    assert.ok(html.includes("8 GB; 16 GB recommended for Full local AI"));
    assert.match(html, /href="\/privacy#ai-co-commander"/);
    // Unpublished: honest "coming soon", no RTS AI links, no unsigned-build note, nothing claimed live.
    assert.match(html, /Windows download not yet published/);
    assert.doesNotMatch(html, /RTSAI-Mod\/releases/);
    assert.doesNotMatch(html, /data-analytics-event="mod_download"/);
    assert.doesNotMatch(html, /not code-signed yet|Out now/i);
    const beforeClassic = html.slice(0, html.indexOf('id="classic-alpha"'));
    assert.doesNotMatch(beforeClassic, /releases\/download/, "nothing above the earlier prototype links to a download");
    return;
  }

  // Published: the Windows button downloads the release's installer, with its size and signing status.
  const installer = modRelease.assets.find((asset) => asset.kind === "installer" && asset.platform === "windows-x64");
  assert.match(html, new RegExp(`<title>Download RTS AI ${modRelease.version.replace(/\./g, "\\.")}`));
  assert.ok(html.includes(`href="${installer.url}"`), "the Windows button links the installer");
  assert.match(html, new RegExp(`Download RTS AI (?:<!-- -->)?${modRelease.version.replace(/\./g, "\\.")}`));
  assert.doesNotMatch(html, /aria-disabled="true">Coming soon</);
  assert.ok(html.includes(modRelease.signed ? "Authenticode signed" : "Unsigned alpha"));
  if (!modRelease.signed) assert.match(html, /not code-signed yet/);
  for (const asset of modRelease.assets) assert.ok(html.includes(asset.sha256), `${asset.name} SHA-256 listed`);
  // Only the co-commander modes the installer really offers are described.
  const aiModes = modRelease.aiModes ?? [];
  assert.equal(html.includes("Hosted AI + local voice"), false);
  assert.equal(html.includes("Full local AI"), aiModes.includes("local"));
  if (!aiModes.length) {
    assert.ok(!html.includes("How should your co-commander think?"));
    assert.ok(html.includes("About 1 GB free"));
  }
  const mac = modRelease.assets.find((asset) => asset.kind === "installer" && asset.platform === "macos");
  assert.equal(html.includes("Download for Mac"), Boolean(mac));
  if (mac) {
    assert.ok(html.includes(`href="${mac.url}"`), "the Mac button links the disk image");
    assert.match(html, /The Mac app is not notarized yet/);
  }
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
  for (const id of ["china", "iran", "turkey", "saudi", "yemen", "israel", "hezbollah", "america", "russia"]) assert.match(directory, new RegExp(`/faction-art/flags/${id}\\.[0-9a-f]{12}\\.svg`), `${id} flag`);
  // Identity and Rivals' view come from the catalog (approved 2026-10-07); flavour lines and voice ideas never ship.
  const { catalog } = JSON.parse(await readFile(new URL("../data/factions.generated.json", import.meta.url), "utf8"));
  const escape = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;");
  for (const f of catalog.factions) {
    const html = await (await render(`/factions/${f.id}?mode=ra2`)).text();
    if (!f.identity) { assert.doesNotMatch(html, /faction-identity-title|faction-rivals-title/, `${f.id} hides empty sections`); continue; }
    assert.ok(html.includes(escape(f.identity.motto)), `${f.id} motto`);
    assert.match(html, /Through their enemies’ eyes/);
    for (const view of f.rivalViews) assert.ok(html.includes(escape(view.text)), `${f.id} view by ${view.rival}`);
    assert.ok(html.includes(escape(catalog.narrative.framing)), `${f.id} framing note`);
    // Loading-screen lines are not shown as such (some quote a rival view, which is shown in its own card).
    assert.doesNotMatch(html, /loading-line|voiceIdeas/);
    assert.equal(f.flavour?.voiceIdeas, undefined, `${f.id}: the snapshot drops the audio team's voice ideas`);
  }
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
  // Both modes belong to RTS AI; the historical original roster stays separate from modern factions.
  assert.match(directory, /<b>RTS AI<\/b>/);
  assert.match(directory, /href="\/factions\?mode=ra"/);
  assert.ok(directory.indexOf("The seven factions") < directory.indexOf('aria-label="Original roster"'), "modern factions lead");
  assert.match(directory, /No Red Alert installation is required\./);
  assert.doesNotMatch(directory, /Own Red Alert 2\?/);
  assert.doesNotMatch(directory.slice(0, directory.indexOf('aria-label="Original roster"')), /Own Red Alert/, "no ownership prerequisite above the original roster");
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
  assert.match(download, /China \/ RTS AI/);
  if (claimedByRelease("china")) {
    assert.match(download, new RegExp(`China is in RTS AI ${escapeRegExp(modRelease.version)}`));
    assert.match(download, /Download the Windows installer above\./);
  } else {
    assert.match(download, /Not released yet|has not been verified in it yet/);
  }
  assert.match(download, /v0\.1\.0-alpha\.13/);
  assert.doesNotMatch(download, /href="[^"]*windows-dual/);
  for (const path of ["/factions/nonexistent", "/units/nonexistent"]) {
    const response = await render(path);
    assert.equal(response.status, 404, path);
  }
});

test("the complete faction guide covers every current country and building, claiming release coverage only from the manifest", async () => {
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
      if (mode === "ra2") assert.equal(/In public Windows release/.test(html), claimedByRelease(id), `${id}: release claim matches the manifest`);
    }
  }
  const unavailable = await (await render("/factions/ukraine?mode=ra2")).text();
  assert.match(unavailable, /No roster in this mode/);
  assert.match(unavailable, /\/factions\/ukraine\?mode=ra/);
  const stockDownload = await (await render("/download?faction=america&mode=ra2")).text();
  assert.match(stockDownload, /America \/ RTS AI/);
  assert.match(stockDownload, /Not released yet/);
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

test("keeps site metadata on the standalone game while the parked platform page still builds", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/platform/page.tsx", import.meta.url), "utf8");
  const plan = await readFile(new URL("../lib/product-plan.ts", import.meta.url), "utf8");

  assert.match(layout, /Modern Real-Time Strategy with an AI Co-Commander/);
  assert.doesNotMatch(layout, /Red Alert|RA2|OpenRA mod/);
  assert.doesNotMatch(layout, /Earth mission|autonomous game agent/);
  assert.doesNotMatch(layout, /Red Sea 2026/);
  assert.match(plan, /export const productLayers/);
  assert.match(plan, /export const currentShowcase/);
  assert.match(page, /productLayers\.map/);
  assert.match(page, /currentShowcase\.title/);
  assert.doesNotMatch(page, /Saudi Arabia and Yemen join/);
});
