import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "../components/SiteChrome";
import { ModeNav } from "../components/ContentGuide";
import { FactionCard } from "../components/FactionCard";
import { dossierForRoster, factions, resolveMode, rosterFactions, rosters } from "../../lib/game-content";

export const metadata: Metadata = { title: "Factions | RTS AI", description: "Explore every faction in Red Alert 2 and Classic: modern factions, original sides, units, buildings and defenses.", alternates: { canonical: "/factions" } };

export default async function FactionsPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  const mode = resolveMode((await searchParams).mode);
  const all = rosterFactions(mode);
  const modern = all.filter(f => dossierForRoster(f)).sort((a, b) => factions.indexOf(dossierForRoster(a)!) - factions.indexOf(dossierForRoster(b)!));
  const groups = [{ name: "Modern factions", description: `${modern.length} distinct identities, with their own strategies and counters.`, factions: modern }, ...["Allies", "Soviet"].map(side => ({ name: side === "Soviet" ? "Soviets" : side, description: "The original factions, alongside the modern forces.", factions: all.filter(f => !dossierForRoster(f) && f.side.startsWith(side)) }))];
  const uniqueActors = rosters.actors.filter(a => a.mode === mode);
  const buildings = uniqueActors.filter(a => a.category === "structure" || a.category === "defense").length;
  return <><SiteHeader /><main id="main-content" className="catalog-page faction-directory">
    <header className="catalog-intro"><span className="eyebrow">THE FACTIONS</span><h1>Choose your side.</h1><p>Meet the modern forces and the original factions. Explore their units, buildings and defenses in each game.</p></header>
    <ModeNav mode={mode} path="/factions" />
    <div className="directory-summary"><div><b>{all.length}</b><span>factions</span></div><div><b>{uniqueActors.length - buildings}</b><span>unique units</span></div><div><b>{buildings}</b><span>buildings & defenses</span></div><p>{mode === "ra2" ? "RA2 is in development. Its first public release is still to come." : "Current Classic development rosters. The public alpha contains the earlier Red Sea slice."}<Link href={`/download?mode=${mode}`}>Check release availability →</Link></p></div>
    {groups.filter(g => g.factions.length).map(group => <section className="faction-group" aria-label={group.name} key={group.name}><div className="faction-group-heading"><div><h2>{group.name}</h2><p>{group.description}</p></div><span>{group.factions.length} factions</span></div><div className="faction-tile-grid">{group.factions.map(f => <FactionCard faction={f} key={f.id} />)}</div></section>)}
    <p className="directory-footnote">Names and rosters are checked against the game rules. Shared units are counted once in the totals. {factions.filter(f => f.variants[mode].status === "implemented").length} modern factions have detailed dossiers. Art and balance are being refined.</p>
  </main><SiteFooter /></>;
}
