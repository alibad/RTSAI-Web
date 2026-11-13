# Faction Studio layout and encounter verification — 2026-10-04

Local preview: http://127.0.0.1:3461/art/review. Implementation stays in the existing Art Lab worktree. No deployment, remote push, paid generation or game balance edits.

## Measured

- Unit studio combines game artwork, authored sequence controls, body/turret facing and configured behavior. Encounter is the other workspace; former actions/rebuild links land in Unit studio.
- All 16 RA2 flags decoded locally in the browser. Tests cover all 17 faction IDs across both modes, including Classic's Ukraine. Sources and local-only limitations: studio-flags.md.
- Classic Qilin body facing changed to 0 while turret aim changed independently to 512 through the visible sliders. A building with one authored view has disabled rotation and an explicit fixed-view description.
- Browser widths 377 and 760 match document/main widths. The mobile encounter field is 340px tall; its timeline and event controls precede the inspector. Desktop layout was reviewed at 1440×900. Temporary viewport overrides were cleared.
- Typecheck, ESLint and production build passed. Full tests: 127 passed, 3 failed, 130 total. Replay tests cover position interpolation, yaw wrapping, discrete health/deaths, altitude-aware bounds and local flags.

Native engine encounters, one actor per side, rookie, 100% initial health:

| Mode | Match | Gap | Damage events | Destruction | End survivors red/blue |
| --- | --- | --- | --- | --- | --- |
| RA2 | Qilin / Bastion | 12 map columns | 74 | Qilin at 43.6s | 0 / 1 |
| Classic | Qilin / Bastion | 12 map columns | 39 | Bastion at 15.4s | 1 / 0 |
| RA2 | Apache / Skyshield | 4 map columns | 18 | Apache at 19.2s | 0 / 1 |
| RA2 | Skyspear / Skyshield | 12 map columns | 0 | None in 60s | 1 / 1 |

Apache final recorder verification: local job `1d525d2f-c459-49ec-94b5-92ff6d03190b`; RA2 engine `5523a9907fad1cd388d4cc9759441c0736ba8583`. Seven wreck samples have Z 2728, 2298, 1868, 1438, 1008, 578, 148. One removal event at tick 515 (20.6s), Z -24. Fresh Lua actor wrappers must be compared by actor equality rather than used as table keys; the repeat run confirmed one callback instead of seven.

## Inferred and limits

Combat runs in the local OpenRA engine. Browser position/yaw interpolation smooths five-tick samples; health and deaths remain discrete observations. Turret aim is reconstructed from targets. Hit flashes, tracers, explosion rings, smoke, animation timing and darkened living artwork used for wrecks are illustrative. Exact engine projectile/effect rendering, full maps, service bases and balance conclusions are outside this verification. Infantry death sequence previews use authored art but do not identify the native damage-specific death sequence.

The three failing tests expose the stale public art manifest for Israel/Lebanon and the missing bound publication provenance for their 113 mod art files. The sync guard refused those files; it was not bypassed. Local Studio reads their current native rosters. Shared faction catalog and project-owned gallery/cameo renders were refreshed separately. Nothing was published.

Performance traces were truncated by the browser event buffer; they are not a complete performance-budget sign-off. Paused views render on demand; only playing encounters schedule animation frames. No new GPU/model job was launched.

Reviewed screenshots and raw run/test/build logs are in ignored `.cache/qa-studio` and `.cache/studio-jobs`. Final shareable screenshots crop out all original EA art. Art review decisions were not changed.
