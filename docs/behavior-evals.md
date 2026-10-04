# AI behavior evaluation

The owner approved website AI evaluation and end-to-end behavior experimentation on 4 October 2026. `/workshop/evals` is an application inside the Workshop, linked from the map editor. All development and verification remain local.

## Browser experiments

Both Red Alert 2 and Classic use their complete source-derived actor catalogs. Five presets cover armor, infantry deployment, air interception, defense assault and naval combat. Any actor pair can be selected; invalid terrain placements fail explicitly. A saved Workshop scene can be evaluated without changing its authored terrain or placements.

Scripted policies: advance and engage the nearest eligible target; focus the lowest-health eligible target; hold a firing line; retreat between reloads; deploy supported infantry and defend. These are deterministic behavior policies, not LLM reasoning or hosted companion evaluations. They make no model or provider calls.

Arena comparisons use equal unit counts, paired terrain seeds and alternating west/east starts. Each seed runs twice. The candidate and baseline face the same opponent and identical initial scenes. Authored scenes repeat their fixed initial state; they do not randomize or mirror placements. One to six trials per policy and a 30/60/120 game-second limit are exposed. Cancellation preserves completed trials and discards a partial trial.

Checks require finite positions/non-negative health, observed shots and damage, and accepted commands. An optional blue-victory assertion treats draws/time limits as failures. Draws remain distinct from wins. Score counts a draw as half a win. Win-rate intervals use the 95% Wilson formula. Replays retain snapshots every two seconds plus the initial/final state, with bounded command timelines. JSON exports retain configuration, rule commit, per-trial checks and replay evidence. Recent suite summaries stay in local browser storage.

This simulator approximates source rules: range, armor, cooldown, conditional weapons, rank, deployment, air exits/rearming/falling, terrain and pathing. It does not execute OpenRA, full production/economy, fog, passengers, healing, auras, splash damage, native aircraft physics or arbitrary action traits. Its outcomes cannot certify native game balance.

## Native OpenRA verification

From `RTSAI-Web`, run:

```powershell
python tools/native-eval-server.py
npm run start -- --hostname 127.0.0.1 --port 3460
```

Open `/workshop/evals` on the local website and use **Run native comparison**. The local runner binds only to `127.0.0.1:3462`, accepts browser mutations from an explicit loopback-preview origin allowlist with a custom header, rejects public origins and foreign Host headers, validates actor IDs from the game catalog, bounds requests to 4 KiB and runs one suite at a time. It accepts no scripts, paths, external URLs, shell commands or model settings. Native processes have a 90-second wall-clock limit per trial and can be cancelled from the UI. Shutdown terminates active engine children.

Both installed game engines are supported: `RTSAI-Mod/engine` for RA2, canonical `OpenRA` for Classic. Default content is the machine-local `OpenRA/Support/Content`; `--content` may explicitly name another local content root. Original EA assets are reached through local links and never copied into website public files or returned over HTTP. Map previews are owned, minimal PNGs. Responses contain only numerical results and source provenance, not native screenshots, content, logs or filesystem paths. There is no deployment endpoint.

The runner requires the canonical game commit to match the generated website catalog and no uncommitted mod files. It reuses the existing RA2 balance harness's disposable resource preparation to set the game timestep to 1 ms, links content locally and generates an owned flat arena. Original game rules stay unchanged. Arena-only overlays add telemetry and set fog off / explored on. Native weapons, movement, targeting, damage and health execute in the actual engine. The runner stops its disposable child after a complete numerical telemetry line is flushed, including Classic configurations that otherwise keep the spectator lobby alive.

Native policies support advance, focus and hold. They use native `CanTarget` and `Attack(target, allowMove)`; focus picks the lowest-health target, nearest uses cell distance, and hold disallows movement. Commands change only when the target changes or the actor becomes idle. Kiting and infantry deployment are browser-only because the generic native Lua API lacks the deployment order used by the G.I. trait. Native actor pairs can include ground, air and buildings; naval actors require a ship-versus-ship water arena. Authored scenes currently use browser evaluation and map export rather than the native arena runner.

Native runs use fixed 12-cell horizontal separation, independent clock-seeded engine RNG, equal counts and alternating starts. Browser terrain/seed, replay and checks do not carry over. Each result records per-side original build value, health-weighted survivor value, living units and engine ticks. A limit without elimination is a draw. **Complete** means the requested numerical trials finished, not that a behavior check passed or a faction is balanced. Engine SHA-256 and exact game commit identify the executed build. Reports and logs remain under ignored `.codex-qa/native-evals`; export numerical evidence through the UI.

## Verification

`npm test` includes deterministic trial/replay checks, all five presets in both modes, paired initial state and alternating starts, deployment, stalemate failures, victory assertions, invalid inputs, authored-scene isolation, statistics and server-rendered HTML for both modes. `python -m unittest discover -s tools -p test_native_eval.py -v` checks the native request boundary, map format, response redaction, Host and Origin guards. Native smoke evidence and browser interactions are separate measured end-to-end checks; they are not replaced by mock engine tests.

Measured local verification (4 October 2026): 86 website tests and 4 native-boundary tests passed; lint, TypeScript and production build passed. Website-driven RA2 and Classic suites produced numerical combat results in both engines. The full comparison smoke suite recorded 8 RA2 trials and 4 Classic trials. Saved-scene handoff, browser/native cancellation, replay scrubbing/playback and both evidence downloads were exercised in the browser. Mobile results stay within a 390-pixel viewport after the table-containment fix. Screenshots use owned procedural illustrations only.
