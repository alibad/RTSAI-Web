import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "../components/SiteChrome";
import { ModeNav } from "../components/ContentGuide";
import { FactionCard } from "../components/FactionCard";
import { FactionFlag } from "../components/FactionVisuals";
import { CLASSIC_ADDON, dossierForRoster, factions, modeLabel, resolveMode, rosterFactions, rosterHref, rosters, standaloneRosters } from "../../lib/game-content";
import { getModRelease, isPublished, macInstaller } from "../../lib/mod-release";
import { EA_NOTICE } from "../../lib/ea-notice";
import "./factions.css";

export const metadata: Metadata = { title: "Factions | RTS AI", description: "Seven real-world factions in one fictional war: their units, buildings, defenses and doctrines. A standalone game with Classic and isometric gameplay; no Red Alert installation required.", alternates: { canonical: "/factions" } };

export default async function FactionsPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  const mode = resolveMode((await searchParams).mode);
  const all = rosterFactions(mode);
  const modern = all.filter(f => dossierForRoster(f)).sort((a, b) => factions.indexOf(dossierForRoster(a)!) - factions.indexOf(dossierForRoster(b)!));
  const originals = ["Allies", "Soviet"].map(side => ({ name: side === "Soviet" ? "Soviets" : side, factions: all.filter(f => !dossierForRoster(f) && f.side.startsWith(side)) })).filter(g => g.factions.length);
  const originalCount = originals.reduce((n, g) => n + g.factions.length, 0);
  // Every playable side in the flag rail: the modern factions, then the original countries.
  const rail = [...modern.map(f => { const d = dossierForRoster(f)!; return { key: f.id, href: rosterHref(f), id: d.id, name: d.name, accent: d.accent }; }),
    ...originals.flatMap(g => g.factions).map(f => ({ key: f.id, href: rosterHref(f), id: f.id, name: f.name, accent: f.side === "Allies" ? "#85afcc" : "#ce8779" }))];
  const uniqueActors = rosters.actors.filter(a => a.mode === mode);
  const buildings = uniqueActors.filter(a => a.category === "structure" || a.category === "defense").length;
  const modRelease = getModRelease();
  const released = isPublished(modRelease) ? modRelease : null;
  const releaseLine = released
    ? `RTS AI ${released.version} is out for Windows${macInstaller(released) ? " and macOS" : ""}, and free to play in your browser at rtsai.net/play.`
    : "RTS AI is in development and free to play in your browser now at rtsai.net/play. The Windows download is coming soon.";
  return <><SiteHeader /><main id="main-content" className="catalog-page faction-directory">
    <header className="factions-intro">
      <div><span className="eyebrow">THE FACTIONS</span><h1>Choose your side.</h1></div>
      <nav className="flag-rail" aria-label="Jump to a faction">{rail.map(f =>
        <Link key={f.key} href={f.href} style={{ "--faction-accent": f.accent } as CSSProperties} title={f.name}><FactionFlag factionId={f.id} name={f.name} accent={f.accent} size="md" eager /><span>{f.name}</span></Link>)}</nav>
    </header>
    <ModeNav mode={mode} path="/factions" />
    <ul className="directory-stats" aria-label="Roster totals">
      <li><b>{modern.length + originalCount}</b><span>factions</span></li>
      {originalCount > 0 && <li><b>{originalCount}</b><span>original countries</span></li>}
      <li><b>{uniqueActors.length - buildings}</b><span>unique units</span></li>
      <li><b>{buildings}</b><span>buildings & defenses</span></li>
      <li className="directory-release">Every unit’s art, the original countries’ and other OpenRA mods’ included: <Link href="/faction-studio">open the Faction Studio →</Link></li>
      <li className="directory-release">{mode === "ra2" ? releaseLine : standaloneRosters ? "Standalone Classic passed local integration checks and awaits publication. This roster reflects the accepted local standalone rules." : "Standalone Classic passed local integration checks and awaits publication. This catalog describes historical Classic rules; its current standalone roster refresh is pending."} <Link href={`/download?mode=${mode}`}>Release status →</Link></li>
    </ul>
    <section className="faction-group" aria-label="Modern factions">
      <div className="faction-group-heading"><h2>{mode === "ra2" ? "The seven factions" : `Modern factions · ${modeLabel(mode)}`}</h2><span>{modern.length} factions</span></div>
      <div className="faction-feature-grid">{modern.map((f, i) => <FactionCard faction={f} key={f.id} featured={i === 0} />)}</div>
    </section>
    {originals.length > 0 && <section className="faction-group classic-addon" aria-label={CLASSIC_ADDON}>
      <div className="faction-group-heading"><div><h2>The original countries</h2><p>Red Alert 2’s nine countries, playable in the browser game alongside the modern factions, in Westwood’s original art. No Red Alert installation is required. {EA_NOTICE}</p></div><span>{originalCount} countries</span></div>
      {originals.map(group => <div className="classic-addon-side" aria-label={group.name} key={group.name}><h3>{group.name}</h3><div className="faction-original-grid">{group.factions.map(f => <FactionCard faction={f} key={f.id} />)}</div></div>)}
    </section>}
    <p className="directory-footnote">Names and rosters come from the generated catalog snapshot. {standaloneRosters ? "Both rosters reflect the locally accepted standalone rules; this does not certify public availability." : "Classic entries describe historical rules, not the newly integrated standalone profile."} Shared units are counted once in the totals. {factions.filter(f => f.variants[mode].status === "implemented").length} modern factions have detailed dossiers. Balance is still being refined. National flags: flag-icons (MIT).</p>
  </main><SiteFooter /></>;
}
