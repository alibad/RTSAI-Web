# Encounter playground

Local Studio: http://127.0.0.1:3461/art/review?faction=china&unit=r2qilin&slot=model&mode=ra2&view=arena

The encounter uses one searchable visual palette and one battlefield. Select a team and faction, search by name or role, then drag a card onto the field or click it to add. Drag a placed actor, use arrow keys to nudge it, duplicate/remove it, or choose a move destination. Each team supports up to six independently placed actors from one actual faction roster. Orders are engage, move then engage, and hold/defend. Hold uses native Defend stance; it permits automatic firing without pursuit. Deployable actors can start deployed.

Run encounter submits the complete placement plan to a disposable headless OpenRA map. Both Classic and RA2 use their local native engine. Playback is a recording, not an interactive game loop. Edit setup returns to the unsimulated editor; notebook buttons restore previous recordings.

## Evidence boundaries

| Data | Evidence |
|---|---|
| Actor position, altitude, health, body and turret yaw | Measured every five engine ticks |
| Weapon launches and muzzle source/target coordinates | Measured at native attack callbacks |
| Supported projectile paths and beam endpoints | Measured every engine tick through read-only diagnostic fields |
| Sprite effect image, sequence and frame | Measured every engine tick; rendered from private local SHP/palette files |
| Motion between samples | Inferred interpolation; health/membership retain recorded steps |
| Muzzle flash, fallback beam style, projectile points, wreck appearance and body animation phase | Illustrative/inferred |
| Outcome/balance of the full game | Not established by one flat-map fight |

`RTSAI-Art/tools/StudioRecorder.cs` compiles against each exact local engine into the ignored Web cache. The disposable mod adds its observer traits. No canonical engine or mod rules are edited. Projectiles lacking exposed position/sprite fields remain unsupported; a launch observation alone is not proof of complete visual parity. The recorder inspects fields without changing game state.

The local map has expanded visibility and off-field power. Naval encounters use water or a straight coastline, with placement and destination terrain validation. Mixed land/naval actors on one team require a separate scenario. Aircraft have no service base. No AI service/model/API is used.

## Verification, 4 October 2026

Measured on the final runner:

| Local run | Samples | Launches | Visual observations |
|---|---:|---:|---:|
| Classic: two heavy tanks vs light tank, move and hold | 69 | 9 | 203 |
| RA2: two independently placed Qilins vs Rhino | 85 | 12 | 288 |
| RA2: Harrier vs Patriot, hold | 66 | 4 | 2,332 |
| RA2: Prism Tank vs Rhino | 58 | 4 | 127 |

The aircraft run records wreck descent and native ground removal at tick 266. The Prism run records 28 LaserZap endpoint observations. These counts measure observations, not distinct effects or balance quality.

`node scripts/check-encounter.mjs` verifies search, HTML drag/drop, pointer relocation, keyboard placement, move destinations, duplication/removal, searchable faction selection, an actual engine submission, native effect loading, replay, and returning to setup. Its screenshots substitute wholly authored synthetic sprites, cameos and palettes before navigation. Original EA pixels stay local and are never included in those screenshots.

Targeted tests cover both map projections, mixed actor indices, visual lifetimes, turret interpolation, ownership/deployment/order validation and the production 404 guard. Existing building layers remain covered. The new `/api/art-review/visual` endpoint and all original file routes are private development-only; production tests also check that no original asset content reaches the build.
