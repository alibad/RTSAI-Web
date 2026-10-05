# Faction Studio — local only

## The asset chain (one row per actor)

Every new RA2 actor shows its whole art chain above the stage. Click a step or press its number:

| Key | Step | Shows on the stage |
|---|---|---|
| 1 | In game now | What RTSAI-Mod `main` draws today (data/art-lab.json snapshot) |
| 2 | Design | The concept the 3D model was generated from (its `fromConcept`) |
| 3 | 3D model | The generated GLB, orbit/zoom, six player colours, wireframe; the former "3D model drafts" dialog |
| 4 | Game model | The native VXL/HVA or SHP candidate, side by side with In game now, true 1× inset |
| 5 | Animations | The candidate's own actions (stand, idle, run, fire, prone, die; build-up, damaged, turret fire; HVA cycles) with play/pause/scrub |
| 6 | Checks | What the art tools recorded (`qualityGate`, `verify.checks`), never owner approval |
| 7 | Your call | Use / keep current / reject (U, N, R) and notes |

- Opening an actor focuses its newest native candidate (not rejected) when one exists; otherwise In game now.
  `?unit=r2mantis&step=glb&v=voxel-v5-glb` deep-links any step; `models=1` still opens the 3D model step.
- A candidate is never labelled as game art. "In local preview" appears only when the files installed in
  `RTSAI-Mod-wt-art-preview/mods/rtsai/art-preview/` are byte-identical (SHA-256) to that candidate's files
  (`lib/art-lab/preview-server.ts`, dev-only, read-only).
- Voxel candidates that declare `renderLight` are drawn with it and the stage says so ("stock RA2 light");
  sprite candidates read their own `rules`/`sequences` files, so buildings get their make, damaged and turret-fire frames.
- The top-bar counts are per actor over the 122 new RA2 actors: 3D models (new-design GLB present), game models
  (a native candidate made from that GLB), in preview (bytes matched), decided (model slot decided). Routes and
  queued jobs never add up into coverage.
- New candidates written by other tools appear without a reload: a 28-byte fingerprint is polled every 15 s while
  the tab is visible (`/api/art-review/stamp`), and the full state is fetched only when it changes.
- `?authored=1` hides original RA2 units and references, for screenshots that may be shared.
- Other keys: J/K next/previous actor, ←/→ versions, I build icon, P next player colour, 0 true size, ? help.

Start this worktree with `npm run preview:art`, then open `http://127.0.0.1:3461/art/review?view=rebuild`.
It compiles the same standalone Studio client into ignored `.cache/art-lab-client` and serves it with the
same local review API. Bindings are explicitly loopback-only. This avoids the development module transport.
The normal website development command remains `npm run dev -- --port 3461`.

On Windows, if the worker/RSC development transport times out, use the same Studio component's local client preview:

```powershell
$env:RTSAI_ARTLAB_NODE_DEV='1'
npx vite --port 3461
```

This serve-only option mounts the existing ReviewApp and uses the same loopback API. It does not load the site's
authentication layout or alter production configuration. The normal Vinext page remains available without the flag.
Measured limitation on this machine: worker/RSC requests timed out, and the Node development preview still
intermittently stalls while loading client modules. The compiled `preview:art` avoids that transport; its
rebuild API returned in 50 ms and the RA2 overview showed 166/166 recordings. This is not a full GPU/performance pass.
Both mode switches and Classic's saved mode on reload were verified in the compiled preview. Final screenshots
show 166/166 RA2 and 159/159 Classic recordings, with zero fully verified replacement-art rebuilds.

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
