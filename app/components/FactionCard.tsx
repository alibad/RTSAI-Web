import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight, Shield } from "lucide-react";
import { dossierForRoster, rosterActors, rosterHref, type RosterFaction } from "../../lib/game-content";

export function FactionCard({ faction, compact = false }: { faction: RosterFaction; compact?: boolean }) {
  const dossier = dossierForRoster(faction);
  const actors = rosterActors(faction);
  const buildings = actors.filter(a => a.category === "structure" || a.category === "defense").length;
  const accent = dossier?.accent ?? (faction.side === "Allies" ? "#85afcc" : "#ce8779");
  return <Link href={rosterHref(faction)} className={`faction-tile ${compact ? "is-compact" : ""}`} style={{ "--faction-accent": accent } as CSSProperties}>
    <div className="faction-tile-top"><Shield size={24} aria-hidden="true" /><span>{dossier ? "Modern nation" : faction.side}</span><ArrowUpRight size={17} aria-hidden="true" /></div>
    <h3>{faction.name}</h3>
    {dossier && <p>{dossier.tagline}</p>}
    {!compact && <div className="faction-tile-counts"><span>{actors.length - buildings} units</span><span>{buildings} buildings & defenses</span></div>}
    <span className="faction-tile-link">Explore faction <ArrowUpRight size={14} aria-hidden="true" /></span>
  </Link>;
}
