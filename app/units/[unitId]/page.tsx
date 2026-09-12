import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader, SiteFooter } from "../../components/SiteChrome";
import { CatalogImage, ModeNav, ReleaseCallout } from "../../components/ContentGuide";
import { factionById, resolveMode, unitById } from "../../../lib/game-content";
type Props = { params: Promise<{ unitId: string }>; searchParams: Promise<{ mode?: string | string[] }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const unit = unitById((await params).unitId);
  return { title: unit ? `${unit.name} | RTS AI` : "Unit not found", description: unit?.story, alternates: { canonical: unit ? `/units/${unit.id}` : "/factions" } };
}
export default async function UnitPage({ params, searchParams }: Props) {
  const unit = unitById((await params).unitId);
  if (!unit) notFound();
  const faction = factionById(unit.factionId)!;
  const mode = resolveMode((await searchParams).mode);
  const variant = unit.variants[mode];
  return <><SiteHeader /><main id="main-content" className="catalog-page"><Link className="catalog-back" href={`/factions/${faction.id}?mode=${mode}`}>← {faction.name} faction</Link>
    <header className="dossier-hero unit-hero"><div><span className="eyebrow">{faction.name} / {unit.role}</span><h1>{unit.name}</h1><p>{unit.story}</p></div><CatalogImage id={unit.assetIds[0]} portrait priority /></header>
    <ModeNav mode={mode} path={`/units/${unit.id}`} />
    {variant ? <><section className="doctrine-grid"><article><span className="section-number">FIELD ROLE</span><h2>{unit.role}</h2><p>{unit.strengths}</p></article><article><span className="section-number">COUNTERPLAY</span><h2>Know the limits</h2><p>{unit.counterplay}</p></article><article><span className="section-number">THIS IMPLEMENTATION</span><h2>{mode === "ra" ? "Classic" : "Red Alert 2"}</h2><p>Game actor: <code>{variant.actorId}</code>. Exact costs, prerequisites and weapon behavior are defined by this mode’s engine rules.</p></article></section>
    <section className="unit-appearance"><div><span className="section-number">FROM PORTRAIT TO PLAY</span><h2>Same unit. Purpose-built art.</h2><p>The production portrait identifies the unit in the build menu; the directional sprite sheet shows its Classic battlefield frames. These are different derivatives of the same unit identity.</p>{mode === "ra2" && <p>RA2 uses its own rendering and actor definition. This Classic sheet is reference material, not proof of the RA2 appearance.</p>}</div><CatalogImage id={unit.assetIds[1]} /></section>
    <details className="catalog-provenance"><summary>Inspect the gameplay source</summary><p>Editorial ID: <code>{unit.id}</code> · actor: <code>{variant.actorId}</code></p><p><code>{variant.rulesPath}</code></p><p>Catalog actor links are checked against source definitions. This is not a complete resolved-rule or balance simulation.</p></details></> : <section className="catalog-unavailable"><h2>No Red Alert 2 variant.</h2><p>This unit belongs to the Classic roster only.</p><Link href={`/units/${unit.id}?mode=ra`}>View Classic implementation →</Link></section>}
    <ReleaseCallout faction={faction} mode={mode} />
  </main><SiteFooter /></>;
}
