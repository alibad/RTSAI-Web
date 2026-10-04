import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader, SiteFooter } from "../../components/SiteChrome";
import { CatalogImage, ModeNav, ReleaseCallout } from "../../components/ContentGuide";
import { CompleteRoster } from "../../components/CompleteRoster";
import { categoryLabels, factionById, resolveMode, rosterActors, rosterFactionById, rosters, unitLabel, unitsForFaction } from "../../../lib/game-content";
type Props = { params: Promise<{ factionId: string }>; searchParams: Promise<{ mode?: string | string[] }> };
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const id = (await params).factionId;
  const mode = resolveMode((await searchParams).mode);
  const faction = factionById(id);
  const roster = rosterFactionById(id, mode) ?? rosterFactionById(id, mode === "ra2" ? "ra" : "ra2");
  return { title: roster ? `${roster.name} | RTS AI` : "Faction not found", description: faction?.tagline ?? `Explore the ${roster?.name ?? ""} units, buildings and defenses.`, alternates: { canonical: roster ? `/factions/${id}${rosterFactionById(id, "ra2") ? "" : "?mode=ra"}` : "/factions" } };
}
export default async function FactionPage({ params, searchParams }: Props) {
  const id = (await params).factionId;
  const mode = resolveMode((await searchParams).mode);
  const faction = factionById(id);
  const roster = rosterFactionById(id, mode);
  const other = rosterFactionById(id, mode === "ra2" ? "ra" : "ra2");
  if (!roster && !other) notFound();
  const name = roster?.name ?? other!.name;
  const signatures = faction ? unitsForFaction(faction.id, mode) : [];
  const actors = roster ? rosterActors(roster) : [];
  return <><SiteHeader /><main id="main-content" className="catalog-page">
    <Link className="catalog-back" href={`/factions?mode=${mode}`}>← All factions</Link>
    <header className={`dossier-hero ${faction ? "" : "is-text-only"}`}><div><span className="eyebrow">{faction?.title ?? `${roster?.side ?? other?.side} / Original faction`}</span><h1>{name}</h1>{faction && <h2>{faction.tagline}</h2>}<p>{faction?.story ?? `Explore the complete ${name} build roster, from infantry and vehicles to production buildings and base defenses.`}</p></div>{faction && <CatalogImage id={faction.heroAssetId} priority />}</header>
    <ModeNav mode={mode} path={`/factions/${id}`} />
    {roster ? <>
      <div className="faction-roster-summary">{Object.entries(categoryLabels).map(([category, label]) => { const count = actors.filter(a => a.category === category).length; return count ? <span key={category}><b>{count}</b> {label.toLowerCase()}</span> : null; })}</div>
      {faction && <><p className="catalog-caption">{mode === "ra2" ? "Concept art and Classic production images show the faction’s identity; they are not screenshots of RA2 gameplay." : "Modern faction art and rules on the Classic battlefield."}</p>
      <section className="doctrine-grid" aria-label="How this faction plays"><article><span className="section-number">APPROACH</span><h2>How to play</h2><p>{faction.playstyle}</p></article><article><span className="section-number">ADVANTAGE</span><h2>Strengths</h2><p>{faction.strengths}</p></article><article><span className="section-number">COUNTERPLAY</span><h2>Know the limits</h2><p>{faction.counterplay}</p></article></section>
      <section className="roster-section"><div className="roster-heading"><div><span className="section-number">START HERE</span><h2>Signature units</h2></div><p>A few highlights before the full roster.</p></div><div className="unit-grid">{signatures.map(unit => <Link className="unit-card" href={`/units/${unit.id}?mode=${mode}`} key={unit.id}><CatalogImage id={unit.assetIds[0]} portrait /><div><span className="section-number">{unitLabel(unit, mode).role}</span><h3>{unitLabel(unit, mode).name}</h3><p>{unit.story}</p><b>Explore unit →</b></div></Link>)}</div></section></>}
      <CompleteRoster faction={roster} mode={mode} />
      {faction ? <ReleaseCallout faction={faction} mode={mode} /> : <aside className="catalog-release"><div><span className="section-number">Development roster</span><h2>Check the release before you play.</h2><p>This guide describes the current rules. Public download coverage is listed separately.</p></div><Link className="primary-action" href={`/download?faction=${id}&mode=${mode}`}>Release details →</Link></aside>}
      <details className="catalog-provenance"><summary>About this guide</summary><p>Names, categories and costs are measured from the game rules. Modern faction strategies are editorial guidance, and balance is still being refined.</p><p>{mode === "ra2" ? "Red Alert 2" : "Classic"} rule revision: <code>{rosters.sources[mode].commit.slice(0, 12)}</code>. Artwork is labeled by its source and game mode.</p></details>
    </> : <section className="catalog-unavailable"><h2>No roster in this mode.</h2><p>{name} is available in the {other!.mode === "ra" ? "Classic" : "Red Alert 2"} development roster.</p><Link href={`/factions/${id}?mode=${other!.mode}`}>View that roster →</Link></section>}
  </main><SiteFooter /></>;
}