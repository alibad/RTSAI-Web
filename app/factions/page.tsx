import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "../components/SiteChrome";
import { ModeNav } from "../components/ContentGuide";
import { FactionCard } from "../components/FactionCard";
import { FactionFlag } from "../components/FactionVisuals";
import { dossierForRoster, factions, resolveMode, rosterFactions, rosterHref, rosters } from "../../lib/game-content";
import "./factions.css";

export const metadata: Metadata = { title: "Factions | RTS AI", description: "Explore every faction in Red Alert 2 and Classic: modern factions, original sides, units, buildings and defenses.", alternates: { canonical: "/factions" } };

export default async function FactionsPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  const mode = resolveMode((await searchParams).mode);
  const all = rosterFactions(mode);
  const modern = all.filter(f => dossierForRoster(f)).sort((a, b) => factions.indexOf(dossierForRoster(a)!) - factions.indexOf(dossierForRoster(b)!));
  const originals = ["Allies", "Soviet"].map(side => ({ name: side === "Soviet" ? "Soviets" : side, factions: all.filter(f => !dossierForRoster(f) && f.side.startsWith(side)) })).filter(g => g.factions.length);
  const uniqueActors = rosters.actors.filter(a => a.mode === mode);
  const buildings = uniqueActors.filter(a => a.category === "structure" || a.category === "defense").length;
  return <><SiteHeader /><main id="main-content" className="catalog-page faction-directory">
    <header className="factions-intro">
      <div><span className="eyebrow">THE FACTIONS</span><h1>Choose your side.</h1></div>
      <nav className="flag-rail" aria-label="Jump to a modern faction">{modern.map(f => {
        const d = dossierForRoster(f)!;
        return <Link key={f.id} href={rosterHref(f)} style={{ "--faction-accent": d.accent } as CSSProperties} title={d.name}><FactionFlag factionId={d.id} name={d.name} accent={d.accent} size="md" eager /><span>{d.name}</span></Link>;
      })}</nav>
    </header>
    <ModeNav mode={mode} path="/factions" />
    <ul className="directory-stats" aria-label="Roster totals">
      <li><b>{all.length}</b><span>factions</span></li>
      <li><b>{uniqueActors.length - buildings}</b><span>unique units</span></li>
      <li><b>{buildings}</b><span>buildings & defenses</span></li>
      <li className="directory-release">{mode === "ra2" ? "RA2 is in development. Its first public release is still to come." : "Current Classic development rosters. The public alpha contains the earlier Red Sea slice."} <Link href={`/download?mode=${mode}`}>Check release availability →</Link></li>
    </ul>
    <section className="faction-group" aria-label="Modern factions">
      <div className="faction-group-heading"><h2>Modern factions</h2><span>{modern.length} factions</span></div>
      <div className="faction-feature-grid">{modern.map((f, i) => <FactionCard faction={f} key={f.id} featured={i === 0} />)}</div>
    </section>
    {originals.map(group => <section className="faction-group" aria-label={group.name} key={group.name}>
      <div className="faction-group-heading"><h2>{group.name}</h2><span>Original factions · {group.factions.length}</span></div>
      <div className="faction-original-grid">{group.factions.map(f => <FactionCard faction={f} key={f.id} />)}</div>
    </section>)}
    <p className="directory-footnote">Names and rosters are checked against the game rules. Shared units are counted once in the totals. {factions.filter(f => f.variants[mode].status === "implemented").length} modern factions have detailed dossiers. Balance is still being refined. National flags: flag-icons (MIT).</p>
  </main><SiteFooter /></>;
}
