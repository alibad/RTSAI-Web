import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Crosshair, ShieldAlert } from "lucide-react";
import { SiteHeader, SiteFooter } from "../../components/SiteChrome";
import { ModeNav, ReleaseCallout } from "../../components/ContentGuide";
import { Cameo, CategoryIcon, FactionFlag, SpriteLoop, StatBars, UnitRender } from "../../components/FactionVisuals";
import { categoryLabels, factionById, resolveMode, rosters, unitById, unitLabel, unitsForFaction } from "../../../lib/game-content";
import { factionArtActors, unitArt, unitStats, VIEWER_READY, viewerHref } from "../../../lib/faction-art";
import "../../factions/factions.css";

type Props = { params: Promise<{ unitId: string }>; searchParams: Promise<{ mode?: string | string[] }> };
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const unit = unitById((await params).unitId);
  const mode = resolveMode((await searchParams).mode);
  return { title: unit ? `${unitLabel(unit, mode).name} | RTS AI` : "Unit not found", description: unit ? unitLabel(unit, mode).description : undefined, alternates: { canonical: unit ? `/units/${unit.id}` : "/factions" } };
}

const motionLabel = { turntable: "Turning on the spot", run: "On the move", build: "Building up" } as const;

export default async function UnitPage({ params, searchParams }: Props) {
  const unit = unitById((await params).unitId);
  if (!unit) notFound();
  const faction = factionById(unit.factionId)!;
  const mode = resolveMode((await searchParams).mode);
  const variant = unit.variants[mode];
  const label = unitLabel(unit, mode);
  // The art is the unit's Red Alert 2 model in both modes; stats come from the selected mode's rules.
  const artId = unit.variants.ra2?.actorId.toLowerCase() ?? "";
  const art = unitArt(artId);
  const actor = variant && rosters.actors.find(a => a.mode === mode && a.id.toLowerCase() === variant.actorId.toLowerCase());
  const cost = actor?.cost == null ? null : `$${actor.cost.toLocaleString("en")}`;
  // The faction's whole modern roster as a cameo rail: dossier pages where they exist, else the viewer or roster.
  const dossiers = new Map(unitsForFaction(faction.id, mode).map(u => [u.variants.ra2?.actorId.toLowerCase(), u]));
  const siblings = factionArtActors(faction.id).filter(a => a !== artId).map(a => {
    const dossier = dossiers.get(a);
    const roster = rosters.actors.find(r => r.mode === "ra2" && r.id === a);
    return { actor: a, name: dossier ? unitLabel(dossier, mode).name : roster?.name ?? a, href: dossier ? `/units/${dossier.id}?mode=${mode}` : VIEWER_READY ? viewerHref(faction.id, a) : `/factions/${faction.id}?mode=${mode}#complete-roster-title` };
  });
  return <><SiteHeader /><main id="main-content" className="catalog-page unit-page" style={{ "--faction-accent": faction.accent } as CSSProperties}>
    <Link className="catalog-back" href={`/factions/${faction.id}?mode=${mode}`}>← {faction.name} faction</Link>
    <header className="unit-hero">
      <div className="unit-hero-stage">{art ? <UnitRender actorId={artId} alt={`${label.name}, rendered from its game model`} sizes="(min-width: 1000px) 560px, 92vw" priority /> : null}</div>
      <div className="unit-hero-copy">
        <span className="eyebrow unit-eyebrow"><FactionFlag factionId={faction.id} name={faction.name} accent={faction.accent} size="sm" eager />{faction.name} · {label.role}</span>
        <div className="unit-title">{art && <Cameo actorId={artId} alt={`${label.name} build icon`} scale={2} />}<h1>{label.name}</h1></div>
        <p>{label.description}</p>
        <div className="roster-card-tags">{actor && <span className="category-chip"><CategoryIcon category={actor.category} size={14} />{categoryLabels[actor.category]}</span>}{cost && <span className="cost-chip">{cost}</span>}</div>
        {actor && <StatBars stats={unitStats(actor)} />}
        {VIEWER_READY && art && <Link className="primary-action" href={viewerHref(faction.id, artId)}>Open in the Faction viewer →</Link>}
      </div>
    </header>
    <ModeNav mode={mode} path={`/units/${unit.id}`} />
    {variant ? <>
      <section className="unit-field">
        {art?.sprite && <figure className="unit-sprite"><div className="unit-sprite-ground"><SpriteLoop actorId={artId} alt={`${label.name} in game`} scale={art.sprite.frameWidth > 90 ? 2 : 3} /></div><figcaption>{motionLabel[art.sprite.motion]} · in-game sprite</figcaption></figure>}
        <div className="doctrine-cards is-pair">
          <article><Crosshair size={20} aria-hidden="true" /><h2>{label.role}</h2><p>{unit.strengths}</p></article>
          <article><ShieldAlert size={20} aria-hidden="true" /><h2>Know the limits</h2><p>{unit.counterplay}</p></article>
        </div>
      </section>
      {siblings.length > 0 && <nav className="unit-siblings" aria-label={`More ${faction.name} units`}><span className="section-number">MORE FROM {faction.name.toUpperCase()}</span><ul>{siblings.map(s => <li key={s.actor}><Link href={s.href} title={s.name}><Cameo actorId={s.actor} alt={s.name} /></Link></li>)}</ul><Link className="text-action" href={`/factions/${faction.id}?mode=${mode}#complete-roster-title`}>Full faction roster →</Link></nav>}
      <details className="catalog-provenance"><summary>Inspect the gameplay source</summary><p>Editorial ID: <code>{unit.id}</code> · actor: <code>{variant.actorId}</code></p><p><code>{variant.rulesPath}</code></p><p>Stats are read from this mode’s rules; bars compare units of the same kind. Pictures are rendered from the project’s own model of this unit{mode === "ra" ? " for Red Alert 2" : ""}.</p></details>
    </> : <section className="catalog-unavailable"><h2>No Red Alert 2 variant.</h2><p>This unit belongs to the Classic roster only.</p><Link href={`/units/${unit.id}?mode=ra`}>View Classic implementation →</Link></section>}
    <ReleaseCallout faction={faction} mode={mode} />
  </main><SiteFooter /></>;
}
