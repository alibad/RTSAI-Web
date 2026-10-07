import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Crosshair, Footprints, ShieldAlert } from "lucide-react";
import { SiteHeader, SiteFooter } from "../../components/SiteChrome";
import { ModeNav, ReleaseCallout } from "../../components/ContentGuide";
import { CompleteRoster } from "../../components/CompleteRoster";
import { CampaignStrip } from "../../components/CampaignStrip";
import { FactionNarrative } from "../../components/FactionNarrative";
import { rosterCounts } from "../../components/FactionCard";
import { CountChips, FactionEmblem, FactionFlag, LineupImage } from "../../components/FactionVisuals";
import { factionById, resolveMode, rosterFactionById, rosters } from "../../../lib/game-content";
import { flagSrc, hasFlag, VIEWER_READY, viewerHref } from "../../../lib/faction-art";
import "../factions.css";

/* The flag wash is a static, pre-sized SVG from public/faction-art/flags. */
/* eslint-disable @next/next/no-img-element */

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
  const side = roster?.side ?? other!.side;
  const accent = faction?.accent ?? (side === "Allies" ? "#85afcc" : "#ce8779");
  return <><SiteHeader /><main id="main-content" className="catalog-page faction-page" style={{ "--faction-accent": accent } as CSSProperties}>
    <Link className="catalog-back" href={`/factions?mode=${mode}`}>← All factions</Link>
    <header className={`faction-hero ${faction ? "" : "is-original"}`}>
      {/* Original factions have no art here: their flag fills the banner. Modern factions lead with their units. */}
      {!faction && flagSrc(id) && <img className="faction-hero-flagwash" src={flagSrc(id)!} width={640} height={480} alt="" aria-hidden="true" loading="lazy" decoding="async" />}
      <div className="faction-hero-copy">
        <div className="faction-hero-marks"><FactionFlag factionId={id} name={name} accent={accent} size="lg" eager />{faction && hasFlag(id) && <FactionEmblem factionId={faction.id} accent={accent} size={72} />}</div>
        <span className="eyebrow">{faction?.title ?? `${side} · Original faction`}</span>
        <h1>{name}</h1>
        {faction ? <p className="faction-hero-tagline">{faction.tagline}</p> : <p className="faction-hero-tagline">The original {side === "Allies" ? "Allied" : "Soviet"} arsenal, as the game builds it.</p>}
        {roster && <CountChips counts={rosterCounts(roster)} />}
        {faction && VIEWER_READY && mode === "ra2" && <Link className="primary-action" href={viewerHref(faction.id)}>Open in the Faction viewer →</Link>}
      </div>
      {faction && <div className="faction-hero-stage"><LineupImage factionId={faction.id} alt={`${faction.name} lineup: infantry, armor, aircraft, ships and defenses`} sizes="(min-width: 1100px) 760px, 100vw" priority /></div>}
    </header>
    <ModeNav mode={mode} path={`/factions/${id}`} />
    {roster ? <>
      {faction && <section className="doctrine-cards" aria-label="How this faction plays">
        <article><Footprints size={20} aria-hidden="true" /><h2>How to play</h2><p>{faction.playstyle}</p></article>
        <article><Crosshair size={20} aria-hidden="true" /><h2>Strengths</h2><p>{faction.strengths}</p></article>
        <article><ShieldAlert size={20} aria-hidden="true" /><h2>Know the limits</h2><p>{faction.counterplay}</p></article>
      </section>}
      {faction && <p className="faction-story">{faction.story}</p>}
      {faction && <FactionNarrative faction={faction} mode={mode} />}
      <CompleteRoster faction={roster} mode={mode} catalogFactionId={faction?.id} />
      <CampaignStrip factionId={roster.id} mode={mode} />
      {faction ? <ReleaseCallout faction={faction} mode={mode} /> : <aside className="catalog-release"><div><span className="section-number">Development roster</span><h2>Check the release before you play.</h2><p>This guide describes the current rules. Public download coverage is listed separately.</p></div><Link className="primary-action" href={`/download?faction=${id}&mode=${mode}`}>Release details →</Link></aside>}
      <details className="catalog-provenance"><summary>About this guide</summary><p>Names, categories, costs and stats are measured from the game rules. Modern faction strategies are editorial guidance, and balance is still being refined.</p><p>{mode === "ra2" ? "Red Alert 2" : "Classic"} rule revision: <code>{rosters.sources[mode].commit.slice(0, 12)}</code>. Unit pictures are rendered from the project’s own 3D models; original factions show their flag and names only. National flags: flag-icons (MIT).</p></details>
    </> : <section className="catalog-unavailable"><h2>No roster in this mode.</h2><p>{name} is available in the {other!.mode === "ra" ? "Classic" : "Red Alert 2"} development roster.</p><Link href={`/factions/${id}?mode=${other!.mode}`}>View that roster →</Link></section>}
  </main><SiteFooter /></>;
}
