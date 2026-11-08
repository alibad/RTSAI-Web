# RTS AI web

Private product website for [rtsai.net](https://rtsai.net). It markets and
distributes OpenRA AI while keeping the game engine and downloadable binaries
in the public [`alibad/OpenRA-AI`](https://github.com/alibad/OpenRA-AI)
repository.

Players can:

- download the newest published Windows build and its SHA-256 checksum;
- install the optional Qwen3-VL, Whisper, and Kokoro Local AI Pack;
- ask the companion for advice, confirm safe game actions, or explicitly enable AUTO command;
- search or select a point on an OpenStreetMap basemap;
- choose the Earth footprint and OpenRA battlefield size;
- translate live nearby roads and waterways into a validated Red Alert `.oramap`;
- share a complete mission setup with a copyable URL and generate new seeded variations;
- create a Firebase-backed commander profile before generating or downloading a new mission;
- use privacy-safe product analytics that associate events with a pseudonymous account ID instead of a name or email;
- send authenticated, private product feedback with a searchable receipt ID and optional usefulness rating.

The product is one thing: a Red Alert 2 mod for OpenRA with five modern
nations and an AI co-commander (see `../RTSAI-Mod/docs/roadmap.md`). The public
navigation is Factions and Download. The Earth studio, Capability Atlas and
platform plan are parked: still reachable for existing links, but `noindex`,
out of the sitemap and unlinked.

The homepage also includes an interactive companion preview so visitors can
understand the pause, ask, and alert-priority experience before downloading the
game.

## Run locally

Use Node.js 22 (minimum 22.22.0) and npm 11.19.x. `.nvmrc` and `.node-version`
pin local development to Node 22.22.0, `engines` accepts compatible Node 22 patch
releases, and `packageManager` pins npm 11.19.1.

Vercel uses the same npm version through the committed `installCommand`; Node
22 otherwise defaults to npm 10 in Vercel's build image.

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000`. Location search and Earth feature acquisition are
proxied through the site's `/api/geocode` and `/api/earth-features` routes, so
the browser never needs to call public map services directly. No API key is
required for the website's map generator.

Copy `.env.example` to `.env.local` and fill in the public Firebase web-app
configuration. Email/password authentication must be enabled in Firebase and
`localhost`, `127.0.0.1`, `rtsai.net`, and any preview hostname must be listed as
authorized domains. Firebase's web configuration is public routing metadata;
never put Admin SDK credentials or service-account keys in `NEXT_PUBLIC_*`
variables.

Browsing, map exploration, and public game downloads remain open. Mission
compilation and companion interactions require a signed-in account. Google
Analytics is enabled automatically. It uses the Firebase UID and deliberately excludes names, email addresses, search text,
mission text, and exact coordinates.

The mission UI sends the current Firebase ID token to `/api/earth-features`.
That endpoint verifies the token signature, audience, and issuer against
Google's published Firebase keys before it requests Earth geometry. The client
gate is therefore backed by an API authorization boundary.

The global Feedback button uses the same signed-in identity. It is the feedback
skill's Full mode, shared with the browser game at `/play`: a screenshot of the
tab (the browser's own screen capture) marked up in a canvas annotator, voice
notes (MediaRecorder) and dictation into the text boxes, file attachments
(images, video, audio, text; 10 MB each), a selected page element and, only when
the player enables them, bounded browser, console, and network diagnostics. It
never captures page HTML, form values, request bodies, headers, or URL queries.

`/api/feedback` validates the Firebase ID token and sanitizes the full payload.
It creates a private issue through an installed GitHub App and queues a complete
admin alert through the existing Firebase `mail` collection and official Trigger
Email extension. Firebase mail is the durable fallback: feedback is still
delivered when GitHub is temporarily unavailable, and the private issue link is
included whenever synchronization succeeds. Written feedback and diagnostic
content never enter Google Analytics.

Copy the server-only feedback variables from `.env.example` into the hosting
environment:

- Email goes through rtsai-net itself: each message is a document in its `mail`
  collection, sent over SMTP by our own function on rtsai-net (`functions/`,
  `sendMail`, which replaced the Trigger Email extension: Firebase Extensions
  shut down in March 2027). The SMTP password lives only in its Secret Manager
  secret. `firestore.rules` accepts mail to the team group only.
- `MAIL_GROUP` is that group (`rtsai@googlegroups.com`): feedback, event notices
  and spend alerts all go there, its searchable archive of every event.
- `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and
  `GITHUB_APP_PRIVATE_KEY` authenticate the GitHub App. Its installation needs
  metadata read access and issue read/write access to `GITHUB_REPO_OWNER` /
  `GITHUB_REPO_NAME`: the private Human Quest feedback inbox
  (`alibad/humanquest-feedback`), shared by every app and split by label, so
  each RTS AI report is labelled `app:rtsai`. Reports never go to this
  repository, whose code is public. Personal access tokens are not supported.

Files never pass through `/api/feedback`. The signed-in browser writes them
straight into Firestore (`app/components/feedback/report-files.ts`):
`feedbackReports/<report id>` holds the owner and time, `chunks/` the bytes in
documents of at most 900 KiB (10 MB, so 12 chunks, per file) and `files/` one
record per file, written last. `firestore.rules` lets the reporter create
those, never change them, and only for 30 minutes; only team admins (a document
at `admins/<uid>`, created in the Firebase console) can read them, in the
`/feedback/<report id>` viewer that the issue and the mail alert link. The
project is on the free Spark plan (no Storage bucket, no charges): a report is a
few dozen writes against 20K a day and its bytes count toward 1 GiB stored.
`/api/feedback` receives only the report id and each file's id, name, type and
size. Deploy the rules with `firebase deploy --only firestore:rules --project
rtsai-net`; `node tools/firestore-rules-test.mjs` checks them on the emulators.
The browser game at `/play` runs the same flow from copies of
`app/components/feedback/` and `useFeedbackDictation.tsx` (RTSAI-WebGame
`web/src/ui/feedback/`); change both together.

Validate the production build with:

```powershell
npm run lint
npm test
```

`npm test` first checks that the committed faction snapshot matches the sibling
`../OpenRA-AI` catalog (so it needs that checkout and its `.venv`), then type-checks the full project, builds the production worker, verifies
the rendered product surface and share-link parser, checks the API validation
boundary, and compiles a deterministic OpenRA map fixture.

## Release boundary

The site reads download metadata only from the committed
`data/openra-ai-release.json` manifest, so public rendering never waits on the
GitHub Releases API. Do not commit game ZIPs here. Game packages, checksums,
source, and GPL obligations remain in the public game repository.

After a release is fully published and its platform signatures have been
verified, update the committed manifest explicitly:

```powershell
npm run sync:release -- v0.1.0-alpha.14 --verification=path/to/verification.json
npm test
```

The sync command requires exact-artifact verification evidence, not a signing flag.
Its schema is documented in `docs/faction-install-milestone.md`. It checks release
commits, acceptance results, artifact sizes, published checksums and GitHub digests
when available. Windows signing must come from the signature check; Mac assets
require successful signing, notarization and stapling evidence. A Windows-only
release preserves the previous Mac download instead of implying version parity.

The RTS AI mod (the Red Alert 2 mod in `alibad/RTSAI-Mod`) has its own
committed manifest, `data/rtsai-mod-release.json`. While it is unpublished the
download page shows "coming soon" and renders no mod links. After a GitHub
release is published, fill it with `npm run sync:mod-release -- v0.2.0-alpha.1`
(see `docs/launch-checklist.md`).

## Shared faction guide

Author stories and signature-unit identities in `OpenRA-AI/catalog/factions.json`.
The product packagers validate actor references and include the same catalog bytes.
The website consumes a committed generated snapshot, not an independent authored copy.

```powershell
npm run sync:content
npm run check:content
npm test
```

The sync defaults to sibling `../OpenRA-AI` and canonical `../OpenRA` checkouts.
Use `--product=...`, `--engine=...` and `CATALOG_PYTHON` to override development paths.
Ordinary web builds use the snapshot and do not require a game checkout or Python.
`/factions`, `/factions/[id]` and `/units/[id]` preserve the `ra`/`ra2` mode in links.
Release coverage is separately pinned in `data/release-content.json`; catalog presence
alone must never be advertised as a public download. Unknown coverage fails closed.

Download links carry provider-neutral event attributes for the configured
Firebase analytics layer.

## Faction Art Lab

`/art` is an internal review tool (`noindex`, not in the sitemap or navigation)
that shows every modern-faction sprite, voxel model and cameo as the game draws
them. The public RA2 faction and unit pages embed the same viewers.

```powershell
npm run sync:art     # resolve ../RTSAI-Mod, copy provenance-checked files to public/art-lab
npm run check:art    # fail if the committed copy is stale
```

- The sync resolves rules, sequences and model sequences with OpenRA's MiniYaml
  semantics (`lib/art-lab/miniyaml.ts`) and writes `data/art-lab.json`.
- It copies only files recorded in `mods/rtsai/modern-factions/ART-PROVENANCE.json`
  whose bytes match the recorded SHA-256; anything else fails the sync, so no
  RA2 game data is published.
- The Israel and Hezbollah packs are not in that record yet. `data/levant-art-binding.json`
  (`node --import tsx scripts/bind-levant-provenance.mjs`) binds each of their files by
  checkable evidence: the generator's own hash in `levant-art-provenance.json`, a
  byte-identical re-run of `OpenRA-AI scripts/build-levant-art.py` in a temporary
  sandbox, or byte identity with a file ART-PROVENANCE.json already records. The sync
  re-checks every binding against the mod before the same guard runs; unbound files
  still fail it.
- Decoders (`lib/art-lab/{vxl,hva,shp,pal}.ts`) and the voxel transform chain
  (`voxel-math.ts`, `raster.ts`) follow the engine. three.js loads only when a
  voxel viewer scrolls into view.
- Every unit page, the faction quick-view drawer and the public unit pages use
  one viewer: In-game / 3D orbit / Exploded with a shared toolbar (facing and
  auto-spin, house colour, scale, ground, map light, turret, shadow).
- Review mode (`/art/review`, `npm run dev` only) reads the Art Forge's local
  `../RTSAI-Art` workspace (override with `RTSAI_ART_DIR`) through a Vite
  dev-server API. Each unit has three slots (battlefield model, build icon,
  concept art); per slot the owner picks one candidate to use in game, keeps the
  current asset, or rejects candidates, and comments for the Forge. Decisions
  are written to `review.json` as version 2 per actor:
  `{ version: 2, status, slots: { model|icon|concept: { chosen: id|"current"|null, rejected: [], at } }, comments: [{ at, slot, candidate, view, text, author }], log: [...] }`;
  version-1 entries are migrated when read and fields the Forge adds are kept.
  Nothing reaches the mod until a separate export step. Production builds
  contain neither the tab, the UI nor the API.
- Sound desk (`npm run sound-desk`, then http://localhost:3470/viewer/china?desk=1;
  also the local app's admin viewer): the admin Faction viewer's switch in the top
  bar turns the details column into a desk for the seven modern factions. A unit
  shows every sound slot (voice lines, each weapon's fire and impact, death,
  deploy and movement); the faction overview shows the announcer (each Speech
  notification, its clip and words). Each slot A/Bs the current sound against a
  pick from the bake-off (never its RA2 references), the mod's own sounds or the
  CC0 library, fires weapon picks in the stage's Attack demo, says lines again
  with the faction's own voice (`tools/sound-desk-voice.py`, OpenRA-AI's
  generators; GPU etiquette via `AI\logs\gpu-claim.txt`/`gpu-yield.txt`), and
  decides with U / N / R. Shared (stand-ins many units fire, e.g. `igiat1a–c`)
  and By size (death explosions by unit size) decide many slots at once.
  Decisions go to `RTSAI-Art/sound-review.json` through the dev-only
  `/api/sound-review` (`lib/sound-desk/`), retakes to `RTSAI-Art/sounds/`;
  RTSAI-Mod's `tools/apply-sound-decisions.py` applies them to the mod on a
  branch. Public builds stub the desk out (`vite.config.ts`).

## UI kit (shadcn/ui)

Dropdowns, pickers, popovers and menus use [shadcn/ui](https://ui.shadcn.com) on Base UI (the `base-nova` style;
`components.json`), copied into `app/components/ui/` and themed with the site palette in `app/components/ui/kit.css`
(dark panel tokens with the gold accent; `.ui-paper` for light surfaces). `lib/utils.ts` holds `cn` (clsx +
tailwind-merge). Add more with `npx shadcn@latest add <name>`, then keep imports relative (the standalone Studio build
also resolves `@/`).

- `OptionSelect` (`ui/fields.tsx`): a short fixed list. `SearchSelect`: a long list with search (actors, factions);
  options take `description`, `leading` (e.g. `<Swatch color>`) and `group`. Both keep the value type (string or
  number) and work inside a wrapping `<label>` or with `aria-label`.
- `Select`, `Combobox`, `Popover`, `DropdownMenu`, `Command`: the shadcn primitives, for anything the two fields do not cover.
- Popups portal to `<body>` above dialogs (`--z-popover`) and never lock page scroll (`modal={false}`). On a light
  surface pass `contentClassName="ui-paper"` (or `className` on a primitive's content).
- Triggers are buttons: a surface whose CSS styles every `button` (for example `.workshop button`) styles the closed
  field with `:is([data-slot=select-trigger],[data-slot=combobox-trigger])` (see `app/workshop/workshop.css`).
- A hand-written dialog that closes on Escape checks `kitPopupOpen()` (`ui/layers.ts`) first.
- The standalone Studio (`scripts/art-lab-preview.ts`) compiles Tailwind's theme and utility layers for
  `app/components/ui` only; a Studio file that adds its own Tailwind classes adds an `@source` line there.

## Workshop unit art

The Workshop battlefield draws actors with their in-game art (`lib/unit-art/`, `lib/workshop-units.ts`): a worker
resolves each actor's art and rasterizes frames with the Art Lab's decoders and renderers (`raster.ts` for voxels,
`sprite-compose.ts` for SHP rigs, `fire.ts` for muzzle flashes); frames are packed into a `SpriteAtlas` and drawn as
instances (`drawInstances` for Canvas 2D; `packInstances` gives a WebGL instanced draw the same data). On rtsai.net only
the committed `public/art-lab` art is used and original RA2 units are drawn as markers. In the local app (the Studio
API answers on the same origin) the art is what the local game plays: preview-mod candidates, the main mod, and
original units from the private cache. `?authored=1` forces the public art for shareable screenshots.

## Deployment

The production site is hosted by Vercel at `rtsai.net` and `www.rtsai.net`.
The GitHub repository's `main` branch is the production branch, and Vercel's
native Git integration deploys it automatically. Runtime values and analytics
credentials belong in Vercel environment settings, never in source control.

There are no GitHub Actions or separate hosted release workflows in this
repository.
