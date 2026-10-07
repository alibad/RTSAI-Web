# Faction art on the public pages

`/factions`, `/factions/[factionId]` and `/units/[unitId]` are built around images. Every image is the project's own art or an MIT-licensed national flag. `npm run sync:faction-art` (`scripts/export-faction-art.py`) writes them to `public/faction-art/`.

## What ships

| Folder | Content | Source |
|---|---|---|
| `units/` | 3D render of each modern unit (480 and 240 px, AVIF + WebP) | The 480x384 Blender render behind the unit's installed build-menu cameo (RTSAI-Art `tools/cameo_render.py`). The script checks that its Lanczos reduction equals the committed `render-x4.png`, then fades the frame edge so cut ground shadows end softly. |
| `cameos/` | The 60x48 build-menu cameo with its name bar | The installed art (`mods/rtsai/art-preview/icons/`), copied unchanged |
| `sprites/` | One animation strip per unit: vehicles, ships and aircraft turn, infantry run, buildings build up | The installed SHP and PAL files, decoded with OpenRA's frame layout, turret offsets and player-colour remap (lobby red `F21818`) |
| `lineups/` | One hero composite per modern faction (1440 and 720 px) | That faction's unit renders, arranged back to front |
| `flags/` | National flags, plus the Hezbollah flag | National: lipis/flag-icons v7.3.2, 4x3 SVGs, MIT (`flags/LICENSE.txt`). Hezbollah: non-free; see below. |

`data/faction-art.json` is the slim manifest the pages read through `lib/faction-art.ts`. `data/faction-art-provenance.json` lists every output with its size, SHA-256 and source files (repository paths with their SHA-256s). Neither file is served. `npm run check:faction-art` verifies the outputs against that record and reports sources that have changed since.

`tests/faction-art.test.mjs` fails on any of these:

- a file under `public/faction-art/` that isn't recorded;
- a hash mismatch;
- a source outside RTSAI-Art, the mod's own art or the flag-icons copy;
- a modern unit with no art.

## Rules

- **No EA art.** Original factions (America, Russia and so on) show their national flag and their unit names as text. Shared original units on a modern faction's page are named, never pictured.
- **Every faction shows its flag, Hezbollah included** (owner decision, 7 October 2026; see the next section). The original Hezbollah emblem (`FactionEmblem`, a ridge line over a firing slit) stays in the code, retired (`retiredEmblems`), in case it is needed again. To hide a flag, list the faction in `NO_FLAG` in the exporter and re-run it; the pages then fall back to the emblem.
- **No admin material.** Public pages show no review state, candidate names or version history. Provenance stays in `data/`.
- **Names come from the catalog.** Card titles are roster names (`npm run sync:content`), never hand-written.

## The Hezbollah flag: owner decision and known risks

On 7 October 2026 the owner decided that Hezbollah shows its real flag on the public pages: `/factions`, the faction and unit pages, the Faction viewer and the Workshop pickers. It appears wherever the other factions show theirs ("Hezbollah definitely has a flag. it is already used"). The owner accepted the risks below. This note records them; it is not legal advice.

**Source and licence.**
- The file is the Studio's copy (`app/components/art/review/flags.ts`), downloaded on 4 October 2026 from https://upload.wikimedia.org/wikipedia/en/0/08/Flag_of_Hezbollah.svg.
- The exporter removes editor metadata only; the drawing is unchanged.
- Wikipedia hosts the file locally as a **non-free logo** under US fair use. The copyright is believed to belong to an organisation subject to US sanctions. No free licence applies, unlike the MIT national flags.
- `data/faction-art-provenance.json` records it as `organisation flag` with this licence note.

**Known risks.**
- **Display bans.**
  - Germany banned Hezbollah's activity in April 2020, and showing its symbols publicly is an offence under the Associations Act.
  - Austria added Hezbollah symbols to its Symbols Act in 2019.
  - In the UK, Hezbollah is a proscribed organisation. Displaying an article in a way that arouses reasonable suspicion of support is an offence (Terrorism Act 2000, s.13).
  - Other countries that list Hezbollah as a terrorist organisation may restrict its symbols too.
  - The site is served worldwide, including to these countries.
- **Platform policies.** Policies on dangerous or designated organisations may treat the flag as a violation wherever the site or its media appears. This covers social networks (for example Meta, YouTube, X, TikTok, Discord), app and game stores, ad networks and payment providers. Moderation can remove posts or screenshots, limit reach or refuse ads, whatever the game context.
- **Copyright and sanctions.** Publishing non-free artwork outside fair-use commentary has no licence behind it. The rights holder is also sanctioned.
- **Hosting.** The hosting provider's acceptable-use terms could be invoked if the content is reported.

**How to reverse it.**
1. Add `"hezbollah"` to `NO_FLAG` in `scripts/export-faction-art.py`.
2. Run `npm run sync:faction-art`.
3. Remove the faction from `retiredEmblems` in `app/components/FactionVisuals.tsx`.

The pages then show the original emblem again.

## Identity and Rivals' view

Faction pages have two narrative sections: **Identity** (motto, three keywords and the faction's story in its own in-game voice) and **Rivals' view** (each rival's propaganda or grievance, labelled with that rival's flag and name, plus the catalog's in-world framing note).
- Both read the shared catalog through `lib/faction-narrative.ts`: `faction.identity`, `faction.rivalViews[]` and `catalog.narrative.framing`.
- Each section stays hidden until its fields exist.
- `faction.flavour` (loading-screen lines and voice ideas) is never shown on the website.
- The Faction viewer should read the same module.

## Performance

- Images carry their intrinsic `width` and `height`, so nothing shifts as they load.
- Renders and lineups use `<picture>` with AVIF first and a WebP fallback, plus `srcset`/`sizes`.
- Only the faction or unit hero image loads eagerly, with `fetchpriority="high"`. Everything else is lazy.
- Sprites animate with one CSS `steps()` transform on a single strip. The animation stops under `prefers-reduced-motion`.
- `/faction-art/*` is served with immutable caching (`public/_headers` and the Vercel route rules in `vite.config.ts`).

## Faction viewer

Unit cards and heroes link to the Studio's public Faction viewer at `/viewer/<catalogFactionId>[/<actorId>]` through `viewerHref()`. The links appear once `VIEWER_READY` is on in `lib/faction-art.ts`.

Campaigns on faction pages come from `lib/faction-campaigns.ts`, the read-only source the viewer shares.
