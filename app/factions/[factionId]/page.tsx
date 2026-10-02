import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader, SiteFooter } from "../../components/SiteChrome";
import { CatalogImage, ModeNav, ReleaseCallout } from "../../components/ContentGuide";
import { catalog, factionById, resolveMode, unitLabel, unitsForFaction } from "../../../lib/game-content";
type Props = { params: Promise<{ factionId: string }>; searchParams: Promise<{ mode?: string | string[] }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const faction = factionById((await params).factionId);
  return { title: faction ? `${faction.name} — ${faction.title} | RTS AI` : "Faction not found", description: faction?.tagline, alternates: { canonical: faction ? `/factions/${faction.id}` : "/factions" } };
}
export default async function FactionPage({ params, searchParams }: Props) {
  const faction = factionById((await params).factionId);
  if (!faction) notFound();
  const mode = resolveMode((await searchParams).mode);
  const roster = unitsForFaction(faction.id, mode);
  const theatre = catalog.theatres.find(item => item.factionIds.includes(faction.id) && item.mode === mode);
  return <><SiteHeader /><main id="main-content" className="catalog-page">
    <Link className="catalog-back" href={`/factions?mode=${mode}`}>← All factions</Link>
    <header className="dossier-hero"><div><span className="eyebrow">{faction.title}</span><h1>{faction.name}</h1><h2>{faction.tagline}</h2><p>{faction.story}</p></div><CatalogImage id={faction.heroAssetId} priority /></header>
    <ModeNav mode={mode} path={`/factions/${faction.id}`} /><p className="catalog-mode-note">{faction.variants[mode].description}</p>
    {mode === "ra2" && <p className="catalog-caption">The concept art and Classic production images explain the shared identity. They are not screenshots of RA2 gameplay.</p>}
    {roster.length > 0 ? <><section className="doctrine-grid" aria-label="How this faction plays"><article><span className="section-number">YOUR APPROACH</span><h2>How to play</h2><p>{faction.playstyle}</p></article><article><span className="section-number">YOUR ADVANTAGE</span><h2>Strengths</h2><p>{faction.strengths}</p></article><article><span className="section-number">THE OTHER SIDE</span><h2>Counterplay</h2><p>{faction.counterplay}</p></article></section>
    <section className="roster-section"><div className="roster-heading"><div><span className="section-number">MEET YOUR FORCE</span><h2>Signature units</h2></div><p>A curated introduction. Open a unit to inspect its role, art and mode-specific actor.</p></div><div className="unit-grid">{roster.map(unit => <Link className="unit-card" href={`/units/${unit.id}?mode=${mode}`} key={unit.id}><CatalogImage id={unit.assetIds[0]} portrait /><div><span className="section-number">{unitLabel(unit, mode).role}</span><h3>{unitLabel(unit, mode).name}</h3><p>{unit.story}</p><b>Inspect unit →</b></div></Link>)}</div></section></> : <section className="catalog-unavailable"><h2>No roster in this mode yet.</h2><Link href={`/factions/${faction.id}?mode=ra`}>Explore the Classic roster →</Link></section>}
    {theatre && <section className="catalog-note"><span className="section-number">CAMPAIGN THEATRE</span><h2>{theatre.name}</h2><p>One theatre, two factions. Saudi Arabia and Yemen share the setting, not a single combined roster.</p><ul>{theatre.missions.map(mission => <li key={mission}>{mission}</li>)}</ul></section>}
    <ReleaseCallout faction={faction} mode={mode} />
    <details className="catalog-provenance"><summary>Shared content and visual provenance</summary><p>This dossier and packaged metadata come from the same product catalog. Narrative copy is editorial; actor references resolve to the game source. The installed game does not yet display these full dossiers.</p><p>Catalog {catalog.revision}. Art clearance remains a separate release review; a source path is not a redistribution license.</p></details>
  </main><SiteFooter /></>;
}
