# Map Workshop

Owner-approved live subapp, 4 October 2026. Open /workshop from primary
navigation. Development stays local until publication is explicitly approved.

## Editing

The starter contains two opposing teams with units, defenses and buildings.
Open **Terrain generator** to choose a seed, 64/96/128 grid and river, coast,
islands or plains. **Generate empty** replaces the scene; **Undo** restores it.
Earth mode chooses an OpenStreetMap center and imports simplified roads and
water through the existing signed-in API. Procedural maps need no account.
Import failures preserve the scene; fallback terrain is never labeled Earth.

Choose any of the 14 RA2 or 10 Classic faction rosters. Filter by category/name,
select the team, then drag an actor onto the map. Alternatively choose an actor
and click a cell, use **Place by coordinates**, or focus the map and use
arrows/Enter. Ground units need land; ships and naval yards need water. Buildings
reserve their configured footprint. Aircraft may overlap ground units.

Drag a selected actor to reposition while editing. Paint land, water, roads and
ore with single-cell, 3×3 or 5×5 brushes. Painting protects placed actors and
starts. Undo/redo retains 30 edits. Shift-drag or Pan moves the camera. Wheel
zoom, Fit, minimap and isometric/top-down projection support map inspection.

## Experiments and limits

Select an actor and choose Move/Attack, then click a destination/target.
Right-click moves on terrain or attacks an enemy. **Run battle**, **Pause** and
**Step** control a 25-Hz simulation, with 0.5×/1×/2×/4× speed. Automatic engagement
and range rings can be toggled. The inspector exposes health, armor, active
weapons, footprint, rank, team, power, conditions and configured deployment.

Battle movement/damage does not change the authored scene. **Reset battle**
restores placements and editing. Aircraft with ammunition attack, exit, return
to their placement cell and rearm. Destroyed aircraft fall before becoming
wrecks. The readout records shots, damage and deaths.

**Approximation:** direct damage uses configured range/reload/burst, armor and
supported conditional multipliers. Classic and RA2 target aliases are normalized.
Projectiles, approach paths, aircraft service and falling are approximations.
Burst rounds form one damage packet. Aircraft use a notional service cell,
rather than actual pads/fuel/turn physics. Mobile-unit collision, fog, elevation,
water sinking, healing, auras, passengers, transformations, production, economy
and special warheads are not implemented. Native rules remain authoritative.
Experiments do not certify balance or art quality.

Every actor uses original procedural category illustrations. These are tooling
glyphs, not rebuilt game art. No original commercial sprite, voxel, model,
image or palette is transferred.

## Save and export

Authoring autosaves in this browser's local storage. **Save scene** downloads
JSON; **Load scene** validates it against the current catalog. Unknown actors,
invalid factions, overlaps, malformed grids and files over 2 MB are rejected.
The 160-actor limit bounds editing/simulation work.

**OpenRA map** downloads an .oramap ZIP containing format-12 YAML, format-2
terrain/resources, an original terrain PNG, scene JSON and a readme. RA2 uses
isometric CPos/MPos conversion and the canonical rtsai mod; Classic uses ra.
Tile IDs come from installed tilesets. These are flat experimental maps with
initial placements and two starts. Rank, deployment, manual conditions and
battle results remain browser experiments, not native upgrade initializers.

RA2 requires the local RTSAI-Mod build and the owner's own RA2 files. Classic
requires the current OpenRA AI development build; the old public alpha does
not contain the full current catalog.

## Evidence

Measured: content sync validates both source commits and every roster. Snapshot
facts retain configured HP, armor, speed, weapons, actions, target tags and
direct naval-yard water placement. Tests cover all roster placements,
deterministic terrain, invalid imports, blocked paths, deployment, armor/target
legality, automatic starters in both modes, aircraft rearm/falling and native
tile/ore/coordinate round-trips. Rendered tests cover both Workshop modes.

Measured browser checks: actor palette drag/drop, actor repositioning, movement
orders, combat damage/deaths, JSON save/import, keyboard painting, undo/redo,
mode switching, phone coordinate placement and the anonymous Earth account gate.
Browser-downloaded exports pass local OpenRA map load/lint using --check-yaml
for both modes. This is not an in-game playthrough or proof of native combat parity.
Live authenticated Earth import remains unverified in this session.

Screenshots, test logs and exports are ignored under .codex-qa/. Desktop and
phone screenshots were reviewed visually. No push, deployment, paid API call
or local model work was performed.
