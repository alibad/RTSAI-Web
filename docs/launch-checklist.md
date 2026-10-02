# First mod release: launch checklist

Everything the site needs for the first RTS AI mod release is merged behind two
switches: the Vercel environment and the committed manifest
`data/rtsai-mod-release.json`. Until the manifest is published, the site shows
"First RTS AI mod release coming soon", renders no mod links, and keeps the
Classic alpha as a secondary download.

## 1. Owner: Vercel environment (Production only, names only)

Required. Without all three, every `/api/ai/v1` route answers 503 and no
install tokens are issued:

- `ANTHROPIC_API_KEY` (sensitive)
- `RTSAI_AI_TOKEN_SECRET` (sensitive, at least 32 characters)
- `RTSAI_AI_FIREBASE_SERVICE_ACCOUNT` (sensitive)

Spend alerts at 50% and 80% of the daily cap. These are the existing feedback
mail settings; confirm they are present:

- `MAIL_FIREBASE_PROJECT_ID`
- `MAIL_FIREBASE_API_KEY`
- `FEEDBACK_ADMIN_EMAIL` (or `MAIL_GROUP`; its first address is used)

Optional. When unset, the per-install daily allowance is $0.25 and the global
daily cap is $10:

- `RTSAI_AI_ANON_DAILY_USD`
- `RTSAI_AI_GLOBAL_DAILY_CAP_USD`
- `RTSAI_AI_KILL_SWITCH` (only to pause hosted AI)

Leave the three required secrets out of Preview. All other tunables are listed
in `.env.example`.

## 2. Owner: outside Vercel, before the first push

- Anthropic Console: a workspace with a monthly spend limit, and the API key from it.
- Firestore (Native mode, `(default)` database): a service account with only
  Cloud Datastore User.
- Firestore TTL on field `expireAt` for collection groups `aiUsage`, `aiRate`,
  `aiInstallIps`, `aiSpend` and `aiSpendAlerts`. The privacy page says these
  counters are deleted automatically; that is only true once TTL is on.
- Client security rules deny `aiInstalls`, `aiInstallIps`, `aiUsage`,
  `aiSpend`, `aiRate` and `aiSpendAlerts`.

## 3. Deployer: after the GitHub release of alibad/RTSAI-Mod is published

The release must be public and not a draft, contain a Windows x64 installer
(`.exe`), and publish a SHA-256 for every file (GitHub's asset digest, a
`<file>.sha256`, or a `SHA256SUMS` file). The sync refuses anything else.

```powershell
npm run sync:mod-release -- v0.2.0-alpha.1 --dry-run
# list only the RA2 factions verified in this build
npm run sync:mod-release -- v0.2.0-alpha.1 --factions=china,iran,turkey,saudi-arabia,yemen
# add --signed only on Windows when the installer is Authenticode-signed; the script verifies it
npm run lint
npm test
git add data/rtsai-mod-release.json
git commit
```

Pushing `main` then deploys. Publishing the manifest switches, with no other
code change: the download buttons and file list (with sizes and SHA-256), the
unsigned-installer note when `signed` is false, homepage pillar 3 to "Alpha",
the homepage download calls to action, the structured data, and "In public
Windows release" for exactly the factions passed to `--factions`.

## 4. Optional: the trailer

Add `public/trailer/rtsai-trailer.mp4` and a poster
(`public/trailer/rtsai-trailer-poster.jpg`, `.webp` or `.png`). The homepage
hero switches from the companion demo to the muted, looping trailer at the next
build; it does not autoplay for visitors who prefer reduced motion.
