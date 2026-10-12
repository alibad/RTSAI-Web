import type { Metadata } from "next";
import { artFactionById, artLab, releaseRecord, renderSpec, spriteWithUrls } from "../../lib/art-lab/manifest";
import { roleLabel } from "../../lib/art-lab/labels";
import { unitById, unitLabel } from "../../lib/game-content";
import snapshot from "../../data/studio-snapshot.json";
import { SharedStudio } from "./SharedStudio";

export const metadata: Metadata = {
  title: "Faction Studio | RTS AI",
  description: "Browse every faction's units and art: RTS AI's factions, the original countries and other OpenRA mods.",
  alternates: { canonical: "/faction-studio" },
};

// The shared, read-only Faction Studio: the same app screen as the owner's local Studio, reading the published snapshot
// (scripts/publish-studio.ts) instead of local game files. No marketing header or footer.
export default function FactionStudioPage() {
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
  return <SharedStudio index={(snapshot as { index?: string | null }).index ?? null} units={units} tints={artLab.render.mapTints} />;
}
