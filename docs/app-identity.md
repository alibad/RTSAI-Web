# The three RTS AI apps

| App | What it is | Where it runs | Name on the taskbar |
|---|---|---|---|
| **Desktop game** | The native game (OpenRA), downloaded for Windows or Mac | the player's computer | RTS AI |
| **Web app** | rtsai.net, including the browser game at /play; installable from Chrome | the internet | RTS AI |
| **Faction Studio** | The owner's local admin app: Unit studio, Review board, Encounter, AI Arena, AI testing, Campaign studio | this PC only (127.0.0.1:3450) | Faction Studio |

There is no admin on rtsai.net. Public builds remove the admin tools: their pages answer 404, and their code is
stubbed out of the bundle (`lib/admin.ts`, `vite.config.ts`). rtsai.net/faction-studio is a read-only public gallery,
not the local app.

## Icons

All three apps still share the original compass mark. The owner is designing new ones (23 Oct 2026); locally
generated candidates were rejected. Where each app's icon files live:

- **Desktop game** (RTSAI-Mod): `packaging/artwork/icon_*.png` (16–1024), `packaging/artwork/rtsai.ico`, and
  `mods/rtsai/icon.png` (32 px).
- **Web app:**
  - RTSAI-Web `public/`: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (180),
    `favicon-32.png`, `favicon-64.png`, `favicon.ico`;
  - RTSAI-WebGame `web/public/`: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`.
- **Faction Studio:** the manifest served by `scripts/art-lab-preview.ts` points at the shared web icons. To give it
  its own, add files under `public/brand/faction-studio/` and point the manifest there. Keep the id `/art/review`, so
  the installed app updates in place.

`hq/games/artifacts/app-identity-20261023/tools/icons.py` turns one square image per app into every size above.
