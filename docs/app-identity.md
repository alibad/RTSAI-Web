# RTS AI app identities — Command Red

The owner selected Theme 2, Command Red, on 23 October 2026:

| App | Approved icon | Desktop entry |
|---|---|---|
| Native game | Desktop variation 2, Head-on command | RTS AI |
| Local Faction Studio | Studio variation 5, Graphic tank & pen | Faction Studio |
| Website | Website variation 3, Flat compass | RTS AI Website |
| Browser game | Web Game variation 1, Armored advance | RTS AI Web Game |

The website and game remain separate app identities. The local Studio manifest keeps its existing `/art/review` id. The game uses the stable `/play/` id, even when served from a versioned accepted-build URL. The website retains `/`. Studio is local at 127.0.0.1:3450; 3451 serves the local website. Public `/faction-studio` remains a read-only gallery.

## Approved artwork

`RTSAI-Mod/packaging/artwork/command-red/` preserves the four exact selected square masters and provenance. `python RTSAI-Mod/tools/export-app-icons.py` creates all PNG, Apple, maskable, favicon and Windows ICO sizes and copies each identity into its own canonical app paths. It does not regenerate or repaint the selected artwork.

The maskable variants keep all artwork within the safe circle. Versioned manifest icon URLs request the new files without changing app identities. The Studio manifest and HTML use `public/brand/faction-studio/`, not the website icons.

## Desktop entries

Run `RTSAI-Mod/tools/install-app-shortcuts.ps1` to install all four approved-icon shortcuts on Desktop and in Start Menu / RTS AI. Existing shortcuts and the installed native ICO are backed up under `%LOCALAPPDATA%/RTSAI/app-shortcuts/backups/`. An existing installed Chrome Studio app retains its app ID.

Website and Studio use `RTSAI-Web/scripts/launch-app.ps1`, which starts missing local servers without killing another listener. The game keeps its verified local-build launcher and opens a dedicated Chrome/Edge app window by default. Use `-BrowserTab` for an ordinary browser tab. These desktop app-mode entries are distinct from browser-managed PWA installation: source manifest updates take effect in installed PWAs when the browser refreshes their metadata.

The native game process uses the approved icon through the branded `RTSAI.exe` built from the canonical OpenRA Windows launcher. Old verified builds remain untouched; builds without the branded executable retain the existing OpenRA entry fallback.

## Delivery

The local Website app entry on port 3451 wraps its built renderer on loopback port 3452. It uses the same verified-content Play redirect as Studio, before the renderer's route normalization. This keeps `/play/` working in the production-style local preview without changing the hosted website or bypassing build verification.

These changes are local until separately authorized for release. Website main deploys production when pushed. Web Game production uses only `RTSAI-WebGame/tools/release-play.mjs`; ordinary source changes and a local UI build do not change rtsai.net/play.
