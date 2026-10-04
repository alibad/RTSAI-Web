# Website faction guide

The live pages lead with RTS AI's five modern nations. `/factions` also lists
every original country in the selected mode, with full build rosters including
buildings and defenses. RA2 is the default; Classic is a separate mode.

`data/factions.generated.json` is the only runtime naming source. Run
`npm run sync:content` to update it. The sync validates the curated shared
`OpenRA-AI/catalog/factions.json`, then copies text facts from
`RTSAI-Art/rebuild/catalog.json`. It refuses an export whose source commit
differs from the current Mod/Classic checkout, unresolved actors, uncommitted
game rules or invalid roster references. Refresh the Art Lab rule export when
changing either game's rules before syncing the site.

The website imports only names, roles, categories, costs and roster links from
the rule export. No commercial images, palettes, models or local asset paths
are imported. Original factions use text cards. Modern art retains explicit
Concept/Classic labels; Classic art does not prove RA2 appearance.

Current development rosters are separate from public release coverage. The
curated five modern dossiers retain the release-manifest checks. Original
countries are labeled development roster; no unverified public coverage is
inferred for them. The release page keeps the RA2 mod and previous Classic
alpha separate. Planned RA2 installer choices are collapsed until publication.

Verify with `npm run lint` and `npm test`. The rendered journey test visits
every faction in both modes and checks that every buildable entry is visible.
Development and verification remain local; publishing requires owner approval.
