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
  (a native candidate made from that GLB), in preview (the reviewed candidate's model bytes matched; an installed
  icon alone does not count), decided (that candidate used or rejected, or "keep current" after it arrived), the
  same rules as the review board. Routes and queued jobs never add up into coverage.
- New candidates written by other tools appear without a reload: a 28-byte fingerprint (candidate folders, meta and
  metrics files, review.json, preview overlay) is polled every 15 s while the tab is visible (`/api/art-review/stamp`);
  the state is fetched, and read on the server, only when it changes. Long generation prompts are left out of the
  state and fetched when their details are opened (`/api/art-review/prompt`).
- Checks show only what the art routes saved beside the candidate, failing checks first, in plain words against the
  named stock family: `metrics.json` (schema `rtsai.voxel-metrics/1`, tools/glb_route.py with the art_metrics.py gate:
  vehicles, ships, aircraft; `familyCalibrated: false` is shown as advisory), older `gate.json`/`meta.gate` summaries,
  `metrics-building.json` (tools/metrics_building.py), `verify.json` (infantry route: structure and
  tools/metrics_infantry.py), plus the recorded format/decode checks. No saved results: "Not measured yet".
  The Studio never derives a pass itself (`lib/art-lab/measurements.ts`).
- 3D-model thumbnails are pre-rendered on the CPU: `npm run thumbs:glb` (Blender Cycles CPU, `.cache/glb-thumbs/`,
  about 0.3 s per model). A thumbnail is served only while the GLB's size and modification time still match.
- Ships are drawn on water; helicopters play their candidate's HVA rotor frames at the rules' TickRate; buildings
  read `-sequence` removals, idle overlays (e.g. a radar dish), damaged/critical states and turret fire; a
  candidate's own `WithIdleOverlay` (with its Offset) and `WithAttackAnimation` traits decide those sequences' roles,
  so an extra sequence never replaces the idle body.
- Spins the local preview copy's rules play count as present and play in the Animations step: drone propellers
  and gunship rotors modelled as HVA sections (`WithVoxelHelicopterBody`, also when the overlay only remaps the
  actor's own rotor sequence) and radars (`WithAnimatedVoxelModel`, riding the turret when it names one). They are
  read from `RTSAI-Mod-wt-art-preview/mods/rtsai/art-preview/*.yaml` and marked "local preview" in Checks.
  Slit-firing bunkers (no turret, `WithAttackAnimation` fire frames) are complete by design.
- Prerendered vehicle sprites (RTSAI-Art glb_prerender.py, `sprite-v6-prerender`) draw from their own
  `openra-snippet.yaml`: 32-facing body (`WithFacingSpriteBody`), turret (`WithSpriteTurret`, Turreted.Offset, aimable
  on the stage), barrel (`WithSpriteBarrel`, placed as the engine does), sprites riding the turret
  (`WithSpriteTurret@x`) and rotor overlays (`WithIdleOverlay` with Offset). A body or turret that loops its frames is
  a spin, named from `meta.sprite.sequences.<seq>.spins` (e.g. `["pusher"]` is a propeller) or the model it replaces.
  Conditional variants (`idle-landed`, `idle-still`, `turret-still`) are their own actions and never drawn over the main
  one; overlays from another image (damage smoke) are ignored. Art installed under any overlay folder
  (e.g. `art-preview/vehicles/`) counts for "In local preview".
- Vehicles, ships and aircraft get a **Fire** action, as the engine plays a shot: the armament's Recoil falls by
  RecoilRecovery each 40 ms tick, a sprite turret (WithSpriteTurret Recoils) or voxel barrel (WithVoxelBarrel) slides
  back along the turret's facing, and the muzzle sequence plays once at the barrel's LocalOffset (barrels take turns).
  Rules come from RTSAI-Mod main for what is in game now and from the local preview copy for candidates, with the
  install agent's `meta.previewInstall.rules` first (`/api/art-review/fire`). Muzzle flashes are original RA2 effect
  art, read only through the private originals cache (`/api/art-review/visual`, extracted on demand, never committed
  or bundled); the authored-only view, or an original that is not cached, draws a magenta-ringed placeholder and says
  "Placeholder flash". Combined sequences (`^WithMachineGunMuzzle`: one `mgun-<facing>.shp` per facing, used by the
  Night Hawk, Pillbox and Sentry Gun) are joined from their pieces. Original units offer Fire too; their rules load
  when Fire is first pressed.
- Every action has a plain-word label from one map (`lib/art-lab/action-labels.ts`): Crawl, Prone fire, Die (alt),
  Lie down, Rotor spin, Propeller, Radar spin, and so on.
- `node scripts/check-actor-animations.mjs --software` (`RTSAI_STUDIO_URL` picks the Studio, default :3461) checks
  the Animations step against current candidates: the action buttons equal the candidate's own actions, play,
  pause and scrub, house recolour, Fire and Die (held last frame), the preview spins, and no page errors.
- A faction switch holds frame rendering for 150 ms so its repaint presents first (software GPUs otherwise spend
  that time on voxel frames); flags are rasterised once in idle time so the faction picker opens quickly.
- `?authored=1` hides original RA2 units and references, for screenshots that may be shared.
- Other keys: J/K next/previous actor, ←/→ versions, I build icon, P next player colour, 0 true size, ? help.

## Review board (one faction, every new unit)

The **Review board** tab (`?view=board&faction=china`) shows each new unit of the chosen faction as a tile:
In game now and New at 1× (2× while hovered or focused), the recorded checks verdict (advisory when the family is
not calibrated), the actions the candidate covers against what the unit uses today, notes, and whether its exact
files are installed in the local preview copy. The tile's candidate is the one the owner chose, else the newest
native candidate that is not rejected. Click a tile (or Enter/O) to open the unit in the asset chain.

- Keys: J/→ next, K/← previous, ↑/↓ row, U use, R reject, C note (Enter saves, Esc cancels), Z undo. U and R
  write the existing `review.json` contract (`choose`/`reject` of that one candidate in the model slot) through
  `/api/art-review/action`, then move to the next undecided unit. Nothing is written without a key press or click.
- Counts are per faction and overall: decided X of N, installed in the preview Y of N, units without a game
  model, plus a list of missing animations.
- **Play the new look** gives the copyable command for the local preview copy of the game
  (`RTSAI-Mod-wt-art-preview\launch-game.cmd` with `Engine.SupportDir` pointing at the OpenRA support folder that
  holds the RA2 content, and `OPENRA_AI_HOST=0` because that worktree has no companion files). It is a local preview;
  RTSAI-Mod changes only after the owner's decisions.
- **Poster PNG** exports one before/after image of the faction (every unit, 1×, landed, south-west facing). It is
  drawn from the new units' committed project art (In game now) and their candidates only: the board never lists
  original RA2 units, and its pictures skip external RA2 overlays.

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
