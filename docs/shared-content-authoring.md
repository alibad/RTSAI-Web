# Shared content authoring pilot

The canonical content source and compiled gameplay overlays live in sibling
RTSAI-Mod. This website supplies the authenticated editor at `/studio/content` in
local/admin builds. The public Studio remains read-only; the editor page and its
filesystem API return 404 in the normal production build.

The first operation edits one shared entity's build cost. Saving checks a base
revision, compiles all four reviewed bindings, and preserves the prior source.
It does not build, install or publish a game. The native and actual WASM acceptance
evidence is described in `RTSAI-Mod/docs/shared-content-pilot.md`.

## Access

- Verify the existing Firebase sign-in ID token on the server.
- Require its UID in server-only `RTSAI_STUDIO_ADMIN_UIDS` (comma-separated).
- Require local non-production execution and `RTSAI_STUDIO_LOCAL_WRITES=1`.
- Refuse foreign origins, unauthenticated callers, non-admins and stale revisions.
- `RTSAI_ADMIN=1` makes the UI available; it does **not** authorize writes.
- An empty admin allowlist denies everyone. The owner must identify the intended
  account; never grant editing to an email asserted by a browser or to all members.

Run the existing website development server with these server settings and its
usual Firebase project configuration. The local app's Studio gateway also mounts
the same protected handler. If using that separate Node gateway, supply the same
`NEXT_PUBLIC_FIREBASE_PROJECT_ID` and admin settings to its process. No token or
administrator UID is embedded in the public snapshot. Do not expose the local
filesystem server as an online authoring backend.

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

Six focused Node tests cover authorization, foreign origins, invalid payloads,
conflict handling, the real Python compiler/store round trip, restore-to-inherit,
mode-specific viewer bindings and the unchanged public read-only boundary.
TypeScript, targeted ESLint and the production build pass. Local production HTTP
checks confirm public Studio 200, editor and editing API 404 (including POST),
with canonical source bytes unchanged.

The older rendered viewer HTTP suite was also attempted: seven content tests
failed against its sign-in-required server and one admin test skipped. Its fixture
expects an unauthenticated build. Authentication was not weakened to satisfy it;
this is not a claim that the full website suite passed.
