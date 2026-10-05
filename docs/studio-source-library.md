# Studio source library

The local Studio identifies current model/sprite and icon origins separately. Exact SHA-256 matches against the installed mod's ART-PROVENANCE.json establish creation-record evidence; they do not establish a legal redistribution license. Original artwork resolves from local game data and stays in private ignored caches. Unrecorded mod artwork stays unverified, including files in the historical `owned/` cache folder.

Sources lists the current loaded roster and four researched external project references. Those references contain no imported factions, assets or native recordings. The existing art publication guard is unchanged.

## Import work still needed

1. Register a specific local pack and revision, with source URL, author credits, dependency requirements and artwork license/permission evidence. Never execute downloaded mod scripts during discovery.
2. Discover its actual faction/actor roster through a read-only adapter. Namespace identities as `pack:revision:faction:actor`; identical actor names across packs must not collide. Preserve shared actors rather than duplicating their ownership per country. Do not invent countries absent from the source roster.
3. Resolve SHP/VXL/HVA, palettes and action sequences into a private pack cache. Attach per-file credits and inheritance/modification records. Keep code, original game data and contributed artwork rights separate.
4. Report preview coverage and missing assets explicitly. Add the compatible engine/version and required custom traits before offering native encounters. Original RA2/Ares/Phobos INI behavior requires a separate implementation; it cannot be treated as measured OpenRA behavior.
5. Verify each pack locally, and show separately: cataloged, previewable, playable, encounter-tested, redistribution-approved. Obtain explicit publishing authorization before any export or deployment.

This provides a path to a broad mod library, not a claim that every historical mod is discoverable, obtainable, compatible or licensed for reuse. No external mod assets have been downloaded by this change.
