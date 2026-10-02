import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader, SiteFooter } from "../components/SiteChrome";
import { CatalogImage, ModeNav } from "../components/ContentGuide";
import { factions, modes, resolveMode, availability } from "../../lib/game-content";
export const metadata: Metadata = { title: "Explore the factions | RTS AI", description: "Discover five modern nations for Red Alert 2 on OpenRA: their stories, doctrines and signature units.", alternates: { canonical: "/factions" } };
export default async function FactionsPage({ searchParams }: { searchParams: Promise<{ mode?: string | string[] }> }) {
  const mode = resolveMode((await searchParams).mode);
  const active = factions.filter(faction => faction.variants[mode].status === "implemented");
  const unavailable = factions.filter(faction => faction.variants[mode].status !== "implemented");
  return <><SiteHeader /><main id="main-content" className="catalog-page"><header className="catalog-intro"><span className="eyebrow">FACTION FIELD GUIDE</span><h1>Find your side.<br /><em>Know your strength.</em></h1><p>Five identities. Different ways to fight. Explore the story, meet the units, then see where you can play.</p></header><ModeNav mode={mode} path="/factions" />
    <div className="catalog-mode-note"><p>{modes.find(item => item.id === mode)?.description}</p><span>{active.length} faction variants in source · release status shown below</span></div>
    <section className="catalog-grid" aria-label={`${mode === "ra" ? "Classic" : "Red Alert 2"} factions`}>{active.map((faction, i) => <Link className="catalog-card" href={`/factions/${faction.id}?mode=${mode}`} key={faction.id} style={{ "--faction-accent": faction.accent } as CSSProperties}><CatalogImage id={faction.heroAssetId} priority={i < 2} /><div className="catalog-card-copy"><span className="section-number">{faction.title}</span><h2>{faction.name}</h2><p>{faction.tagline}</p><small>{availability(faction, mode)}</small><b>Meet the faction <ArrowRight size={16} /></b></div></Link>)}</section>
    {unavailable.length > 0 && <section className="catalog-unavailable"><h2>Coming to Red Alert 2.</h2><p>Until their RA2 rosters are complete, these dossiers live on the Classic battlefield of the current public alpha.</p><div>{unavailable.map(faction => <Link key={faction.id} href={`/factions/${faction.id}?mode=ra`}>{faction.name} · Classic <ArrowRight size={16} /></Link>)}</div></section>}
    <section className="catalog-note"><h2>One identity in every mode.</h2><p>Red Alert 2 is the main battlefield for RTS AI. Classic holds the current public alpha and the Red Sea 2026 theatre. A faction keeps its story and signature units in both; each mode’s own rules decide mechanics and balance.</p><p>These are fictional game factions, not claims about real-world forces. This guide highlights signature units, not every build-menu entry.</p></section>
  </main><SiteFooter /></>;
}
