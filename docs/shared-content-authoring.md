# Shared unit editing in Faction Studio

The local Faction Studio now edits the selected unit in its own inspector at
`/art/review`. Choose Classic or RA2, a faction, and a unit. The Gameplay
Modification panel shows inherited and modified cost, health and movement speed.
Unsupported traits stay disabled. Art, sounds, reviews and source rules are
preserved. The former Engineer-only page remains a historical pilot, not the
primary editing workflow.

Edits are mode-specific: an RA2 unit's modification reaches its RA2 desktop and
web targets. It does not implicitly change Classic. The reviewed registry covers
392 units including the preserved modern faction profiles. Most Classic units
currently have only a desktop binding. The explicitly reviewed Classic Engineer
also binds to the older browser adapter; this is not complete Classic parity.
The affected-target disclosure shows each target's actual actor and values.

Save modification writes `RTSAI-Mod/content/unit-modifications.json`, preserves
both revisions, checks conflicts and compiles four separate overlay files. Drafts
survive unit switches within this browser session. Restore removes this unit's
new overrides and inherits the existing game and earlier modifications, including
the previous 625-credit shared Engineer pilot. It does not erase that earlier work.

Build & test locally creates a fresh artifact directory, validates merged desktop
rules, packs both web modes, refreshes sprite sheets, and builds the current
committed web interface. An unchanged verified WASM simulation can be reused;
when simulation code changes, the browser runtime is rebuilt and integrity checked.
Preview status distinguishes not built, building, failed, outdated and up to date.
Launch desktop and Web game appear for the current saved revision. Running matches
retain their rules. No builds, commits, pushes or deployments happen on Save.

The initial integrated demonstration is reversible: Classic Engineer costs 650;
RA2 Engineer costs 700, has 100 HP and speed 66. All four engine targets were
checked. Real native and WASM matches trained Engineers at their respective prices.
Evidence lives under `../artifacts/unit-studio-proof-20261016`.

Regenerate reviewed actor bindings after changing baseline rules with
`node --import tsx scripts/sync-unit-bindings.ts`, then compile with the mod's
`python tools/unit-content.py compile`. The local preview refreshes the public
viewer's generated stat snapshot for its local web build; publishing remains a
separate operation. Weapon editing and AI generation are deferred.

## Original shared-cost pilot

The canonical content source and compiled gameplay overlays live in sibling
RTSAI-Mod. This website supplies the authenticated editor at `/studio/content` in
local/admin builds. The public Studio remains read-only; the editor page and its
filesystem API return 404 in the normal production build.

The first operation edits one shared entity's build cost. Saving checks a base
revision, compiles all four reviewed bindings, and preserves the prior source.
It does not build, install or publish a game. The native and actual WASM acceptance
evidence is described in `RTSAI-Mod/docs/shared-content-pilot.md`.

## Access

The owner chose local administration without a sign-in on 16 October 2026.
Run `npm run preview:art`, then open
`http://127.0.0.1:3461/art/review` and select a unit.
No account, Firebase configuration or admin environment flags are required for
this local gateway. It binds only to 127.0.0.1 and treats access from this machine
as owner access. Other local programs/users with access to this machine can also
act as owner; this is not a multi-user security boundary.

The gateway checks the actual loopback peer, exact host/origin and cross-site
request metadata. A same-origin bootstrap with a custom header obtains an
in-memory, per-launch capability, required for content reads and writes. No CORS
access is granted, and the editor cannot be embedded in another site's frame.
Restarting Studio invalidates its capabilities. No capability enters a URL,
public snapshot or persistent account configuration.

The separate website development editor retains verified Firebase UID
allowlisting (`RTSAI_STUDIO_ADMIN_UIDS`, `RTSAI_STUDIO_LOCAL_WRITES=1`). It is
optional. `RTSAI_ADMIN=1` only enables its page, never write authorization.
The normal production website's editor and filesystem API still return 404.
The local-owner handler is mounted only by the local Node gateway.

The editor currently saves to canonical local Git-backed files. Durable cloud
drafts, private uploaded assets, remote builds and online publishing are not part
of this increment. No Firebase collections, rules or deployed roles were changed.

## Viewer exports

`node scripts/sync-shared-content.mjs` snapshots the checked compiled metadata into
`data/shared-content.generated.json`. `--check` rejects a stale viewer snapshot.
The existing RA2 viewer uses the explicit shared actor binding for the pilot cost;
other actor facts stay unchanged. The browser game's `tools/sync-viewer.mjs`
refreshes that snapshot before exporting its existing viewer data. Classic's full
public viewer export is still separate work; the editor shows all four bindings.

## Validation

Seven focused Node tests cover authorization, foreign origins, invalid payloads,
conflict handling, local-owner capability/peer/host protection, the real Python compiler/store round trip, restore-to-inherit,
mode-specific viewer bindings and the unchanged public read-only boundary.
TypeScript, targeted ESLint and the production build pass. Local production HTTP
checks confirm public Studio 200, editor and editing API 404 (including POST),
with canonical source bytes unchanged.

The older rendered viewer HTTP suite was also attempted: seven content tests
failed against its sign-in-required server and one admin test skipped. Its fixture
expects an unauthenticated build. Authentication was not weakened to satisfy it;
this is not a claim that the full website suite passed.
