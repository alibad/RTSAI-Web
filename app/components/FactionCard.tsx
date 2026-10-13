import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { categoryLabels, dossierForRoster, rosterActors, rosterHref, type RosterFaction } from "../../lib/game-content";
import { artActorFor, categoryOrder } from "../../lib/faction-art";
import { Cameo, CountChips, FactionFlag, LineupImage } from "./FactionVisuals";
import { OriginalCameos } from "./OriginalCameos";
import "../factions/factions.css";

const sideAccent = (side: string) => (side === "Allies" ? "#85afcc" : "#ce8779");

/** Category counts for chips: buildings and defenses together, as the game's build tabs show them. */
export function rosterCounts(faction: RosterFaction) {
  const actors = rosterActors(faction);
  return [
    ...(["infantry", "vehicle", "aircraft", "ship"] as const).map(category => ({ category, label: categoryLabels[category], count: actors.filter(a => a.category === category).length })),
    { category: "structure", label: "Base", count: actors.filter(a => a.category === "structure" || a.category === "defense").length },
  ];
}

/** The faction's own units with art, in build-tab order: the thumbnail strip. */
export function signatureActors(faction: RosterFaction, limit = 8) {
  const order = (key: string) => faction.actors.indexOf(key);
  const actors = rosterActors(faction).sort((a, b) => order(a.key) - order(b.key));
  const withArt = categoryOrder.flatMap(category => actors.filter(a => a.category === category).map(a => ({ actor: a, art: artActorFor(a, faction) })).filter(x => x.art));
  // One of each category first, then fill, so the strip shows the breadth of the force; shown in build-tab order.
  const first = categoryOrder.map(c => withArt.find(x => x.actor.category === c)).filter(Boolean) as typeof withArt;
  const picked = new Set([...first, ...withArt.filter(x => !first.includes(x))].slice(0, limit));
  return withArt.filter(x => picked.has(x));
}

/** One unit of each kind first, then fill: the strip shows the breadth of the force, in build-tab order. */
function breadth(faction: RosterFaction, limit: number) {
  const order = (key: string) => faction.actors.indexOf(key);
  const actors = rosterActors(faction).sort((a, b) => order(a.key) - order(b.key));
  const byCategory = categoryOrder.flatMap(c => actors.filter(a => a.category === c));
  const first = categoryOrder.map(c => byCategory.find(a => a.category === c)).filter(Boolean) as typeof byCategory;
  const picked = new Set([...first, ...byCategory.filter(a => !first.includes(a))].slice(0, limit));
  return byCategory.filter(a => picked.has(a));
}

export function FactionCard({ faction, compact = false, featured = false }: { faction: RosterFaction; compact?: boolean; featured?: boolean }) {
  const dossier = dossierForRoster(faction);
  const accent = dossier?.accent ?? sideAccent(faction.side);
  const style = { "--faction-accent": accent } as CSSProperties;
  if (!dossier) {
    // Original countries: Westwood's art, from the Faction Studio's published snapshot (EA's notice is on the page).
    const counts = rosterCounts(faction);
    return <Link href={rosterHref(faction)} className="faction-tile is-original" style={style}>
      <div className="faction-original-head">
        <FactionFlag factionId={faction.id} name={faction.name} accent={accent} size="md" />
        <div><h3>{faction.name}</h3><span>{faction.side} · {counts.reduce((n, c) => n + c.count, 0)} units and buildings</span></div>
        <ArrowUpRight size={16} aria-hidden="true" />
      </div>
      {!compact && <OriginalCameos ids={breadth(faction, 5).map(a => a.id)} />}
      {!compact && <CountChips counts={counts} />}
    </Link>;
  }
  const strip = compact ? [] : signatureActors(faction, featured ? 10 : 7);
  return <Link href={rosterHref(faction)} className={`faction-tile is-modern ${compact ? "is-compact" : ""} ${featured ? "is-featured" : ""}`} style={style}>
    <div className="faction-tile-stage">
      <LineupImage factionId={dossier.id} alt={`${dossier.name} units`} sizes={featured ? "(min-width: 1000px) 760px, 100vw" : "(min-width: 1000px) 580px, (min-width: 700px) 50vw, 100vw"} priority={featured} />
    </div>
    <div className="faction-tile-body">
      <div className="faction-tile-name">
        <FactionFlag factionId={dossier.id} name={dossier.name} accent={accent} size="md" />
        <div><h3>{dossier.name}</h3><span>{dossier.title}</span></div>
        <ArrowUpRight className="faction-tile-arrow" size={18} aria-hidden="true" />
      </div>
      <p>{dossier.tagline}</p>
      {strip.length > 0 && <div className="cameo-strip" aria-hidden="true">{strip.map(x => <Cameo key={x.actor.key} actorId={x.art!} alt="" />)}</div>}
      {!compact && <CountChips counts={rosterCounts(faction)} />}
    </div>
  </Link>;
}
