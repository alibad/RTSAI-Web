# Shared Faction Studio

`rtsai.net/faction-studio` is the Faction Studio for everyone: the same app screen as the owner's local Studio, read-only.
It shows RTS AI's factions, the original countries with Westwood's art, and every mod of the mod library (Romanov's
Vengeance, Combined Arms, Cameo, Generals Alpha, RA+, Shattered Paradise, OpenHV, OpenRA Red Alert 2), with credits.
Decisions, drafts, uploads and native encounters stay in the owner's local Studio.

## How it works

The local Studio reads game files on the owner's machine (RTSAI-Mod, the mod checkouts in `../OpenRA-Upstreams`, the
player's own RA2 / Yuri's Revenge / Red Alert files). The shared Studio cannot, so the owner publishes a snapshot:

```
node --import tsx scripts/publish-studio.ts --dry-run   # resolve and count
node --import tsx scripts/publish-studio.ts             # upload what is new, write data/studio-snapshot.json
```

The script resolves every roster, uploads each art file once to the public Vercel Blob store `rtsai-studio-art` under its
content hash (`studio/a/<sha>.<ext>`), uploads the rosters pointing at those files (`studio/s/<time>/`), and records the
snapshot's index in `data/studio-snapshot.json`. Commit and push that file: the site deploys with the new snapshot.
`BLOB_READ_WRITE_TOKEN` comes from `vercel env pull` (`.env.local`, never committed).

In the browser, `lib/art-lab/studio-snapshot.ts` answers the Studio API's reads from the snapshot and refuses every
write; the Studio runs with `shared` (no review board, decisions, history, sounds or native encounters).

## Rights

Command & Conquer art is shown free and non-commercially under EA's Command & Conquer Franchise Modding Guidelines
(Revision 2, 2025), with EA's notice on the page, in the site footer and in the root `NOTICE`. No C&C music is
published: the snapshot holds sprites, models, palettes and icons only. Other mods' art belongs to their authors and is
credited beside each unit with a link to the project. EA's licence is revocable: removing the snapshot is deleting the
`studio/` prefix from the Blob store and setting `data/studio-snapshot.json` back to `{ "index": null }`.
