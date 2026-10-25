import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminGate } from "../../components/AdminGate";
import { ADMIN_BUILD } from "../../../lib/admin";
import { artFactionById, artLab, releaseRecord, renderSpec, spriteWithUrls } from "../../../lib/art-lab/manifest";
import { roleLabel } from "../../../lib/art-lab/labels";
import { unitById, unitLabel } from "../../../lib/game-content";

export const metadata: Metadata = { title: "Review | Faction Art Lab", robots: { index: false, follow: false } };

// Review mode is local-only: dev, and the local app's Studio, which serves this path itself. Production builds
// replace NODE_ENV with "production", which drops the dynamic import of the review UI from the bundle; its API is a
// dev-server plugin. On rtsai.net the owner gets a card naming the art workspace (lib/admin.ts); admin builds 404.
// It is an app screen: no marketing header or footer, only its own slim top bar.
export default async function ReviewPage() {
  if (process.env.NODE_ENV === "production") {
    if (ADMIN_BUILD) notFound();
    return <AdminGate surface="review" />;
  }
  const { ReviewApp } = await import("../../components/art/ReviewApp");
  const units = artLab.factions.flatMap(f => f.actors.map(id => {
    const a = artLab.actors[id];
    const unit = a.catalogUnitId ? unitById(a.catalogUnitId) : undefined;
    return {
      id, factionId: f.id, factionName: artFactionById(f.id)?.name ?? f.id, name: a.name, category: a.category, role: roleLabel(a),
      catalog: unit ? { ...unitLabel(unit, "ra2"), story: unit.story } : null,
      queue: a.queue[0] ?? a.category, order: a.buildPaletteOrder,
      spec: renderSpec(a), sprite: spriteWithUrls(a), previous: releaseRecord(a),
    };
  }));
  return <ReviewApp units={units} tints={artLab.render.mapTints} />;
}
