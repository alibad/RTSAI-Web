// Mounted only by the serve-only Node Art Lab preview in vite.config.ts.
import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
const UnitEditor = lazy(() => import("../../components/art/review/UnitEditor").then(m => ({ default: m.UnitEditor })));
import { ReviewApp } from "../../components/art/ReviewApp";
import { artFactionById, artLab, renderSpec, spriteWithUrls } from "../../../lib/art-lab/manifest";
import { roleLabel } from "../../../lib/art-lab/labels";
import { unitById, unitLabel } from "../../../lib/game-content";
import "../../globals.css";

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
createRoot(document.getElementById("art-lab-root")!).render(new URLSearchParams(location.search).get('view') === 'edit'
  ? <Suspense fallback={<p>Opening unit editor…</p>}><UnitEditor /></Suspense> : <ReviewApp units={units} tints={artLab.render.mapTints} />);
