# Faction Studio — local only

Start this worktree with `npm run dev -- --port 3461`, then open `/art/review`.

The mode selector reads canonical RTSAI-Mod for RA2 and canonical OpenRA's default World War III experience
for Classic. Selectable factions and complete rosters come from merged game rules, not a parallel catalog.
Classic supports Fluent attributes and its TD SHP compression in the same sprite worker. Cache identity includes
the actual render specification, so a shared actor ID cannot reuse art from the other mode.

Art retains existing review/compare tools. Actions exposes building construction, damaged sprites and actor
sequences plus configured deployment, flight, support and weapon facts. Arena runs actual OpenRA combat in a
disposable local map through RTSAI-Art/tools/studio_duel.py. It records sampled health, movement, damage and
falling wreck positions. Rendering effects and animation timing remain illustrative. Individual encounters are
evidence about that scenario, not a balance verdict. The six-row notebook survives reloads and server restarts.

The Arena supports one actor type per side, 1–6 actors, distance, veterancy, condition deployment and a temporary
red-team health override. It supplies off-field power and expanded vision on flat land. Naval maps, mixed teams,
terrain, aircraft rearming bases and comprehensive balancing remain follow-up work.

All original files remain under ignored `.cache` paths. Original, owned-mod and encounter routes are loopback
development routes returning 404 in production. Owned mod copies have a separate cache directory; original-data
build exclusion checks cover RA2 and Classic filenames and hashes. Forge public provenance requires a bound
local Art source path and commit plus matching bytes. Qilin's approved local pilot settings are synced into the
authored public art data, with no original data included.

Measured validation: content, typecheck, production build and 120 tests pass; ESLint passes. Six Forge checks
pass using the bundled Python. CPU/SwiftShader performance records 0% idle, no tasks over 50 ms and at most one
WebGL context, but fails several response budgets (maximum faction input-to-paint 400 ms). Do not claim a fully
passed performance gate. No real GPU/model job was started while another session held its claim.

See sibling `RTSAI-Art/docs/studio.md` for measured native encounter results, asset gaps and the prepared five-
faction building brief. The ten-concept generation plan has spent $0 and still requires a current-session cap.
Current building art is placeholder; no new building sequence or release art has been approved.
