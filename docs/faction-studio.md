# Faction Studio — local only

Start this worktree with `npm run dev -- --port 3461`, then open `/art/review`.

On Windows, if the worker/RSC development transport times out, use the same Studio component's local client preview:

```powershell
$env:RTSAI_ARTLAB_NODE_DEV='1'
npx vite --port 3461
```

This serve-only option mounts the existing ReviewApp and uses the same loopback API. It does not load the site's
authentication layout or alter production configuration. The normal Vinext page remains available without the flag.
Measured limitation on this machine: worker/RSC requests timed out, and the Node preview still intermittently
stalls while loading client modules. Both mode overviews were inspected when loaded; final Classic screenshot
shows 159/159 recordings, while the RA2 screenshot was captured at 160/166 before the final six completed.
The loopback API reports the final 166/166 and 159/159 counts. Do not treat preview reliability as a passed gate.

The mode selector reads canonical RTSAI-Mod for RA2 and canonical OpenRA's default World War III experience
for Classic. Selectable factions and complete rosters come from merged game rules, not a parallel catalog.
Classic supports Fluent attributes and its TD SHP compression in the same sprite worker. Its uneven facing
ranges and body quantization follow the engine, tested at all 1024 angles. Cache identity includes
the actual render specification, so a shared actor ID cannot reuse art from the other mode.

Art retains existing review/compare tools. Actions exposes building construction, damaged sprites and actor
sequences plus configured deployment, flight, support and weapon facts. Arena runs actual OpenRA combat in a
disposable local map through RTSAI-Art/tools/studio_duel.py. It records sampled health, movement, damage and
falling wreck positions. Rendering effects and animation timing remain illustrative. Individual encounters are
evidence about that scenario, not a balance verdict. The six-row notebook survives reloads and server restarts.

The Arena supports one actor type per side, 1–6 actors, distance, veterancy, condition deployment and a temporary
red-team health override. Each side chooses an actual faction that can build its actor. It supplies off-field
power and expanded vision on land, water or a straight coastline according to the selected actors. Mixed teams,
varied terrain, aircraft rearming bases and comprehensive balancing remain follow-up work.
Starting separation is measured in map columns, not world cells; RA2 isometric columns span √2 world cells.
The runner explicitly disables Classic companion autostart and preserves exact actor rule-key case.

Rebuild shows all 24 faction rosters, 325 distinct buildable actors and 98 buildings/defenses across both modes.
Its queue tracks eight distinct gates with evidence; existing assets do not count as completed replacement art.
Native smoke recording progress is separate, excludes stale actor/runner evidence and never approves balance.
Recursive supporting-actor, weapon and image contracts are recorded in sibling Art/rebuild/dependencies.json.
Original references are read-only; replacement candidates and notes can be reviewed in either mode. Classic
candidates/reviews live under Art/modes/classic; RA2's existing workspace stays at Art/units and Art/review.json.
Multi-file building sprites require declared sequence-to-file mappings rather than reusing the first SHP.

All original files remain under ignored `.cache` paths. Original, owned-mod and encounter routes are loopback
development routes returning 404 in production. Owned mod copies have a separate cache directory; original-data
build exclusion checks cover RA2 and Classic filenames and hashes. Forge public provenance requires a bound
local Art source path and commit plus matching bytes. Qilin's approved local pilot settings are synced into the
authored public art data, with no original data included.

Measured validation: content, typecheck, production build and 127 tests pass; ESLint passes. Six Forge checks
pass using the bundled Python. CPU/SwiftShader performance records 0% idle, no tasks over 50 ms and at most one
WebGL context, but fails several response budgets (maximum faction input-to-paint 400 ms). Do not claim a fully
passed performance gate. No real GPU/model job was started while another session held its claim.

See sibling `RTSAI-Art/docs/studio.md` for measured native encounter results, asset gaps and the prepared five-
faction building brief. The ten-concept generation plan has spent $0 and still requires a current-session cap.
Current building art is placeholder; no new building sequence or release art has been approved.
