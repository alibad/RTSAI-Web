/**
 * Public-page sections that embed the Art Lab's shared viewers, fed from the same published mod files.
 * Server components: they pass only the small render specs to the client viewers.
 */
import { RosterBoard, type RosterGroup } from "./art/RosterBoard";
import { UnitViewer } from "./art/UnitViewer";
import { artActorByCatalogUnit, artFactionByCatalogId, artLab, categoryLabels, factionActors, renderSpec, spriteWithUrls } from "../../lib/art-lab/manifest";
import { artCategories } from "../../lib/art-lab/types";
import { roleLabel } from "../../lib/art-lab/labels";
import { unitById, unitLabel } from "../../lib/game-content";

const sourceNote = "Drawn in your browser from the RTS AI mod's own art files, with the game's projection, lighting and player colours. The mod is in development; this is not a release announcement.";

export function FactionInGameRoster({ catalogFactionId }: { catalogFactionId: string }) {
  const faction = artFactionByCatalogId(catalogFactionId);
  if (!faction) return null;
  const actors = factionActors(faction.id);
  const groups: RosterGroup[] = artCategories
    .map(category => ({
      id: category, label: categoryLabels[category],
      tiles: actors.filter(a => a.category === category).map(a => {
        const unit = a.catalogUnitId ? unitById(a.catalogUnitId) : undefined;
        return { spec: renderSpec(unit ? { ...a, name: unitLabel(unit, "ra2").name } : a), sprite: spriteWithUrls(a), href: unit ? `/units/${unit.id}?mode=ra2` : null, hrefLabel: "Unit dossier", role: unit ? unitLabel(unit, "ra2").role : roleLabel(a) };
      }),
    }))
    .filter(g => g.tiles.length);
  return (
    <section className="catalog-ingame" aria-label="The roster in game">
      <span className="section-number">ON THE BATTLEFIELD</span>
      <h2 className="art-board-title">The full roster at in-game scale</h2>
      <p className="art-board-note">{sourceNote}</p>
      <RosterBoard groups={groups} tints={artLab.render.mapTints} />
    </section>
  );
}

export function UnitInGameArt({ catalogUnitId }: { catalogUnitId: string }) {
  const actor = artActorByCatalogUnit(catalogUnitId);
  if (!actor) return null;
  const unit = unitById(catalogUnitId);
  const spec = renderSpec(unit ? { ...actor, name: unitLabel(unit, "ra2").name } : actor);
  return (
    <section className="catalog-ingame" aria-label="In game">
      <span className="section-number">IN GAME · RED ALERT 2</span>
      <h2 className="art-board-title">{actor.render === "voxel" ? "Turn it, take it apart" : "Every frame the game draws"}</h2>
      <p className="art-board-note">{sourceNote}</p>
      <UnitViewer spec={spec} sprite={spriteWithUrls(actor)} tints={artLab.render.mapTints} />
    </section>
  );
}
