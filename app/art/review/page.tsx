import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArtLabChrome } from "../ArtLabChrome";
import { artFactionById, artLab, renderSpec, spriteWithUrls } from "../../../lib/art-lab/manifest";
import { roleLabel } from "../../../lib/art-lab/labels";
import { unitById, unitLabel } from "../../../lib/game-content";

export const metadata: Metadata = { title: "Review | Faction Art Lab", robots: { index: false, follow: false } };

// Review mode is local-only. Production builds replace NODE_ENV with "production", which turns this into a
// plain 404 and drops the dynamic import of the review UI from the bundle; its API is a dev-server plugin.
export default async function ReviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const { ReviewApp } = await import("../../components/art/ReviewApp");
  const units = artLab.factions.flatMap(f => f.actors.map(id => {
    const a = artLab.actors[id];
    const unit = a.catalogUnitId ? unitById(a.catalogUnitId) : undefined;
    return {
      id, factionId: f.id, factionName: artFactionById(f.id)?.name ?? f.id, name: a.name, category: a.category, role: roleLabel(a),
      catalog: unit ? { ...unitLabel(unit, "ra2"), story: unit.story } : null,
      queue: a.queue[0] ?? a.category, order: a.buildPaletteOrder,
      spec: renderSpec(a), sprite: spriteWithUrls(a),
    };
  }));
  return (
    <ArtLabChrome active="review">
      <ReviewApp units={units} tints={artLab.render.mapTints} />
    </ArtLabChrome>
  );
}
