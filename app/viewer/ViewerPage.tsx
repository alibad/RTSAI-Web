import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "../components/SiteChrome";
import { FactionFlag, LineupImage } from "../components/FactionVisuals";
import { FactionViewer } from "../components/art/viewer/FactionViewer";
import { artFactionByCatalogId } from "../../lib/art-lab/manifest";
import { viewerFaction, viewerFactionLinks } from "../../lib/viewer";
import "../factions/factions.css";

/** Server half of /viewer/<catalogFactionId>[/<actorId>]: the faction's data and its server-drawn marks. */
export function viewerMetadata(factionId: string, actorId: string | null): Metadata {
  const faction = viewerFaction(factionId);
  if (!faction) return { title: "Faction viewer | RTS AI" };
  const unit = actorId ? faction.units.find(u => u.id === actorId) : null;
  const title = unit ? `${unit.name} · ${faction.name} · Faction viewer | RTS AI` : `${faction.name} · Faction viewer | RTS AI`;
  const description = unit ? unit.description || `${unit.name}, ${unit.role}: turn it, play its actions and read its stats.` : `${faction.title}: turn every ${faction.name} unit, play its actions, and read the doctrine and campaigns.`;
  return { title, description, alternates: { canonical: unit ? `/viewer/${faction.id}/${unit.id}` : `/viewer/${faction.id}` } };
}

export function ViewerPage({ factionId, actorId }: { factionId: string; actorId: string | null }) {
  const faction = viewerFaction(factionId);
  if (!faction || (actorId && !faction.units.some(u => u.id === actorId))) notFound();
  const factions = viewerFactionLinks();
  const marks = Object.fromEntries(factions.map(f => [f.id, <FactionFlag key={f.id} factionId={f.id} name={f.name} accent={f.accent} size="sm" eager />]));
  return <>
    <SiteHeader />
    <main id="main-content" className="viewer-page">
      <FactionViewer faction={faction} factions={factions} initial={actorId} marks={marks} artFactionId={artFactionByCatalogId(factionId)?.id ?? factionId}
        lineup={<LineupImage factionId={faction.id} alt={`The ${faction.name} lineup`} sizes="(min-width: 1200px) 760px, 92vw" priority />} />
    </main>
  </>;
}
