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

The product story is organized around the original plan: companion + command,
Earth-to-battlefield creation, and the web + launcher surface that makes both
approachable. New theatre/mod development and autonomous strategy research are
presented as growth tracks. Individual scenarios such as the current Red Sea
2026 vertical slice are evolving proof of that platform rather than its identity.

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

The global Feedback button uses the same signed-in identity. It can attach a
text description of a selected page element and, only when the player enables
them, bounded browser, console, and network diagnostics. It never captures
screenshots, page HTML, form values, request bodies, headers, or URL queries.

`/api/feedback` validates the Firebase ID token and sanitizes the full payload.
It creates a private issue through an installed GitHub App and queues a complete
admin alert through the existing Firebase `mail` collection and official Trigger
Email extension. Firebase mail is the durable fallback: feedback is still
delivered when GitHub is temporarily unavailable, and the private issue link is
included whenever synchronization succeeds. Written feedback and diagnostic
content never enter Google Analytics.

Copy the server-only feedback variables from `.env.example` into the hosting
environment:

- `MAIL_FIREBASE_PROJECT_ID` and `MAIL_FIREBASE_API_KEY` identify the existing
  Firebase mail project. SMTP credentials stay in Firebase Secret Manager.
- `FEEDBACK_ADMIN_EMAIL` receives the alert, while `MAIL_GROUP` receives the
  configured audit copy.
- `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, and
  `GITHUB_APP_PRIVATE_KEY` authenticate the GitHub App. Its installation needs
  metadata read access and issue read/write access to `GITHUB_REPO_OWNER` /
  `GITHUB_REPO_NAME`. Personal access tokens are not supported.

This is deliberately the feedback skill's Core mode: reliable text, selected
element context, and opt-in diagnostics. Media capture should only be added
after a private object-storage backend and retention policy are configured.

Validate the production build with:

```powershell
npm run lint
npm test
```

`npm test` type-checks the full project, builds the production worker, verifies
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

## Deployment

The production site is hosted by Vercel at `rtsai.net` and `www.rtsai.net`.
The GitHub repository's `main` branch is the production branch, and Vercel's
native Git integration deploys it automatically. Runtime values and analytics
credentials belong in Vercel environment settings, never in source control.

There are no GitHub Actions or separate hosted release workflows in this
repository.
