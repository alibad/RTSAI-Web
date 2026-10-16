# Main publication verification — 16 October 2026

The owner explicitly requested every product repository on main, categorized commits and a push, then confirmed that RTSAI-Web main should deploy rtsai.net. Publication uses the existing Vercel Git integration. It does not manually redeploy, change hosting settings, replace the separately accepted local game or release rtsai.net/play.

The reviewed website source tip is 527cbb2d320db31f35a2bc9b786af23f9ff277bb. Existing preservation/policy, Studio/Sound Desk, and local game launcher commits remain separate. This documentation-only commit records validation before one main push. The cross-repository categorized index is RTSAI-Mod/docs/main-publication-20261016.md.

## Passed

- TypeScript typecheck.
- ESLint: zero errors, five existing img-element warnings.
- Normal application production build.
- Vercel/Nitro production build using the configured vercel-build command, VERCEL=1 and NITRO_PRESET=vercel.
- Three focused Sound Desk model/API/public-stub tests.
- Public-build admin-tool exclusion, Art Lab 404, faction page/public-art boundaries and catalog relationship checks in the full suite.
- Separately, RTSAI-WebGame launcher/readiness regression groups passed; its source push does not deploy the browser game.

## Full-suite limits

The complete website test command is **not green**: 326 tests, 303 passed, 18 failed, five skipped. Failures were retained and not bypassed:

- Art Lab generated metadata and Earth terrain source hash differ from the current sibling mod; one roster test expects 16 combined countries but reads nine from the selected source setup. Existing public snapshots are preserved.
- Two test modules import CSS directly through the Node/tsx test loader and fail with unknown .css extension.
- Three integration tests require Firebase emulator services on localhost:9099, which are not running.
- A symlink boundary fixture cannot create its Windows symlink (EPERM).
- Rendered Workshop/companion/viewer assertions do not all match the configured build, including the viewer tests' documented requirement for a build without NEXT_PUBLIC_FIREBASE settings. No application environment, authentication, permission or provenance guard was changed to make these pass.

These results are not a claim of complete website acceptance or exhaustive gameplay validation. Publication logs are preserved at C:/Users/Admin/Code/hq/games/artifacts/desktop-three-games-design-20261016/publication-web-*.log. Deployment readiness/commit identity and live routes are checked after the Git push; those external results remain in the publication evidence folder to avoid a second deployment-triggering documentation push.
