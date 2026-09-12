# Faction discovery to installation — local milestone

Implemented 12 September 2026. Not a production deployment or new game release.

## Delivered locally

- Five faction identities, with Red Sea modeled as a two-faction theatre.
- Classic has five source implementations; RA2 has China, Iran and Türkiye.
- Twelve curated signature units, with checked per-mode actor references.
- Faction-first navigation, story/doctrine/roster pages, unit details and mode-preserving installation links.
- Existing hashed game-media images reused by ID, with concept/Classic portrait/sprite labels. No generated concept is presented as RA2 gameplay.
- Product-owned JSON is validated and copied into both platform packaging paths. The website snapshot includes the source-byte SHA-256.
- Public Windows Red Sea coverage is pinned to alpha.13 and both commits. Other content is explicitly unconfirmed. Mac availability is not inferred from Windows.
- New release synchronization requires artifact-specific evidence and public checksums; no signing-status command-line shortcut.

This is a guide, not a complete build roster. Engine rules remain authoritative for
balance and executable mechanics. The game does not yet render the full website
dossiers; packaging shared metadata is the first integration boundary, not proof of
an in-game encyclopedia or shared AI narrative consumption.

## Verification evidence schema

`npm run sync:release -- vVERSION --verification=FILE` runs only after the release
has been published with explicit approval. It updates local metadata; it does not
publish or deploy. Do not run it just to see a new version in the UI.

The evidence file must have:

```json
{
  "schemaVersion": 1,
  "version": "VERSION",
  "engineCommit": "40-character release engine commit",
  "productCommit": "40-character release product commit",
  "checks": {
    "cleanInstall": true,
    "upgrade": true,
    "uninstall": true,
    "localAI": true,
    "externalProvider": true,
    "missingRA2": true,
    "secondarySteamLibrary": true
  },
  "artifacts": {
    "EXACT-PUBLISHED-ARTIFACT-NAME": {
      "sha256": "64-character lowercase artifact SHA-256",
      "sizeBytes": 123,
      "authenticode": "unsigned"
    }
  }
}
```

Every Windows ZIP, setup EXE, AI pack and newly published DMG needs an artifact
record. Setup needs `authenticode: verified|unsigned` from actual verification.
Each DMG needs `developerIdSigned`, `notarized` and `stapled`, all true after Apple
tooling verifies them. Keep raw commands/logs with the release evidence; this file
is a checked attestation, not a replacement for executing those commands.

The current public alpha.13 manifest remains unchanged. Existing Mac signing
claims were not re-verified on this Windows host. Do not extrapolate them to a new DMG.

## Acceptance still required before promotion

1. Build a new uniquely versioned package containing the catalog and exact integrated engine/product commits.
2. On a fresh supported Windows environment, install from setup, with no preinstalled .NET or Python. Prove Classic first-run content, mode selection and a match with local AI.
3. Prove owned RA2 import, secondary Steam library discovery, missing content guidance, cancellation/interrupted download and retry. No commercial game archives in our release.
4. Upgrade and uninstall while preserving user saves/settings; test offline, adjacent AI pack and explicit external-provider paths.
5. Verify signatures/digests and licensing for shipped art. Measure minimum hardware and available-disk requirements instead of guessing.
6. Publish only with authorization, then verify public assets and update per-platform release content coverage. Unknown modes/factions remain unconfirmed.
7. Deploy the web app only with authorization. Pushing web `main` deploys Vercel, so local implementation must not silently trigger it.

Art direction still needs a dedicated polish pass: several legacy assets are
production boards or low-resolution portraits. This milestone improves discovery
and provenance; it does not claim a uniformly premium image library or new RA2 captures.

## Local checks

- `npm test`: production build, TypeScript and 31 tests, including rendered mode-preserving routes and 404s.
- `npm run lint` and `npm run check:content`.
- Product `tests/test_content_catalog.py`: graph errors, actor paths, identical staging bytes and packaging hooks.
- Existing Windows setup tests: owned data, secondary libraries, missing content and launch/package contract.
- Interactive browser: RA2 filter → China → Qilin → install guidance → return; Classic switching, keyboard focus and responsive layout checks.

No new setup executable/DMG was built as part of this website/catalog turn. Packaging
hooks were validated by tests and staging; full installer certification remains above.
