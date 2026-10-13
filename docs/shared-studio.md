# Shared Faction Studio

`rtsai.net/faction-studio` is the Faction Studio for everyone: the same app screen as the owner's local Studio, read-only.
It shows RTS AI's factions, the original countries with Westwood's art, and every mod of the mod library (Romanov's
Vengeance, Combined Arms, Cameo, Generals Alpha, RA+, Shattered Paradise, OpenHV, OpenRA Red Alert 2), with credits.
Decisions, drafts, uploads and native encounters stay in the owner's local Studio.

## How it works

The local Studio reads game files on the owner's machine (RTSAI-Mod, the mod checkouts in `../OpenRA-Upstreams`, the
player's own RA2 / Yuri's Revenge / Red Alert files). The shared Studio cannot, so the owner publishes a snapshot:

```
node --import tsx scripts/publish-studio.ts --dry-run    # resolve and count
node --import tsx scripts/publish-studio.ts              # write the static site, deploy it, write data/studio-snapshot.json
node --import tsx scripts/publish-studio.ts --no-deploy  # write the static site only
```

The script resolves every roster and writes a static site in `.cache/studio-cdn` (kept between publishes): each art file
once under its content hash (`a/<sha>.<ext>`) and the snapshot's rosters and index (`s/<time>/`), with headers that let
rtsai.net read them (CORS, cross-origin resource policy) and cache them for a year. It deploys the site to the Cloudflare
Pages project `rtsai-studio` (https://rtsai-studio.pages.dev) and records the snapshot's index in
`data/studio-snapshot.json`. Commit and push that file: the site deploys with the new snapshot. Deploying needs
`npx wrangler login` once on the publishing machine.

Why Cloudflare: it is free with no transfer cap, and it serves from Doha. Measured from Qatar on 13 October 2026, an art
file took about 4 ms there, against about 95 ms from Vercel Blob (Mumbai) and Firebase Hosting (Marseille). The art
moved off Vercel Blob that day; the owner wants the minimum of Vercel features.

In the browser, `lib/art-lab/studio-snapshot.ts` answers the Studio API's reads from the snapshot and refuses every
write; the Studio runs with `shared` (no review board, decisions, history, sounds or native encounters).

## Rights

Command & Conquer art is shown free and non-commercially under EA's Command & Conquer Franchise Modding Guidelines
(Revision 2, 2025), with EA's notice on the page, in the site footer and in the root `NOTICE`. No C&C music is
published: the snapshot holds sprites, models, palettes and icons only. Other mods' art belongs to their authors and is
credited beside each unit with a link to the project. EA's licence is revocable: removing the snapshot is deleting the
`rtsai-studio` Pages project's deployments and setting `data/studio-snapshot.json` back to `{ "index": null }`.
