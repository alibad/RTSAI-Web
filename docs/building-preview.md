# Building preview composition

Local fix, 4 October 2026. The Classic War Factory preview drew only `weap.shp`; its closed roof/door is frame zero of the separate `WithProductionDoorOverlay` sequence. RA2 buildings also lost layers because the viewer picked only the first `WithIdleOverlay` sequence.

The resolver now records each decorative, door and production layer. Review filters conditions against the actor's spawn conditions. The shared sprite renderer composes all enabled layers, applies offsets and draw order, and expands its frame bounds to retain larger overlays. Idle holds doors closed. The Production door preview animates the door over the body, damaged previews use the damaged body/layers, and construction omits completed-building overlays. Activity previews show sequence artwork; native game activity timing remains in OpenRA.

Measured locally from decoded sprites at tick zero (opaque or partially visible pixels; this measures completeness, not art quality):

| Building | Before | After |
| --- | ---: | ---: |
| Classic War Factory | 1,564 | 2,766 |
| RA2 Allied War Factory | 12,814 | 15,445 |
| RA2 Allied Refinery | 8,481 | 11,621 |
| RA2 Soviet War Factory | 15,248 | 17,312 |
| RA2 Soviet Refinery | 9,920 | 11,012 |

Validation: 36 targeted tests, typecheck, affected-file lint, production build and two production privacy checks passed. `node scripts/check-building-preview.mjs` checks the real local Classic factory and RA2 factory/air command layers, then substitutes wholly authored SHP fixtures for screenshot checks. Its screenshots are explicitly synthetic, not captures of game assets. Browser checks reported zero page errors and no interaction tasks exceeding 50 ms; closed factory idle main-thread activity measured 0.05% over two seconds. No qualifying Event Timing entries were emitted, so input latency was not precisely measured.

Original game files and numerical inspection screenshots remain in ignored local caches. No publishing, remote generation or game-rule changes were made. These checks do not establish pixel-perfect parity with an in-game capture for every building. Alternate overlay images/palettes and special activity-driven body traits need separate parity checks.
