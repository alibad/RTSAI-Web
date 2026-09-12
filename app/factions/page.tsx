import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader, SiteFooter } from "../components/SiteChrome";
import { CatalogImage, ModeNav } from "../components/ContentGuide";
import { factions, modes, resolveMode, availability } from "../../lib/game-content";
export const metadata: Metadata = { title: "Explore the factions | RTS AI", description: "Discover five modern factions, their stories, signature units, and Classic and Red Alert 2 variants.", alternates: { canonical: "/factions" } };
export default async function FactionsPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  const mode = resolveMode((await searchParams).mode);
  const active = factions.filter(faction => faction.variants[mode].status === "implemented");
  const unavailable = factions.filter(faction => faction.variants[mode].status !== "implemented");
  return <><SiteHeader /><main id="main-content" className="catalog-page"><header className="catalog-intro"><span className="eyebrow">FACTION FIELD GUIDE</span><h1>Find your side.<br /><em>Know your strength.</em></h1><p>Five identities. Different ways to fight. Explore the story, meet the units, then see where you can play.</p></header><ModeNav mode={mode} path="/factions" />
    <div className="catalog-mode-note"><p>{modes.find(item => item.id === mode)?.description}</p><span>{active.length} faction variants in source · release status shown below</span></div>
    <section className="catalog-grid" aria-label={`${mode === "ra" ? "Classic" : "Red Alert 2"} factions`}>{active.map((faction, i) => <Link className="catalog-card" href={`/factions/${faction.id}?mode=${mode}`} key={faction.id} style={{ "--faction-accent": faction.accent } as CSSProperties}><CatalogImage id={faction.heroAssetId} priority={i < 2} /><div className="catalog-card-copy"><span className="section-number">{faction.title}</span><h2>{faction.name}</h2><p>{faction.tagline}</p><small>{availability(faction, mode)}</small><b>Meet the faction <ArrowRight size={16} /></b></div></Link>)}</section>
    {unavailable.length > 0 && <section className="catalog-unavailable"><h2>Still on the Classic battlefield.</h2><p>These factions have no current RA2 implementation. Their identities and Classic dossiers are still here.</p><div>{unavailable.map(faction => <Link key={faction.id} href={`/factions/${faction.id}?mode=ra`}>{faction.name} · Classic <ArrowRight size={16} /></Link>)}</div></section>}
    <section className="catalog-note"><h2>One identity, two implementations.</h2><p>Classic and RA2 are game modes. World War III and the RA2 modern-faction pack select content within those modes. The story and unit identities are shared; the engine owns each mode’s mechanics and balance.</p><p>These are fictional game factions, not claims about real-world forces. This guide highlights signature units, not every build-menu entry.</p><Link href="/capabilities#build-archive">Explore the development art archive <ArrowRight size={15} /></Link></section>
  </main><SiteFooter /></>;
}
