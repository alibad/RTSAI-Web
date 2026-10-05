import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader, SiteFooter } from "../../components/SiteChrome";
import { CatalogImage, ModeNav, ReleaseCallout } from "../../components/ContentGuide";
import { factionById, resolveMode, unitById, unitLabel, mediaById } from "../../../lib/game-content";
import { UnitInGameArt } from "../../components/InGameArt";
type Props = { params: Promise<{ unitId: string }>; searchParams: Promise<{ mode?: string | string[] }> };
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const unit = unitById((await params).unitId);
  const mode = resolveMode((await searchParams).mode);
  return { title: unit ? `${unitLabel(unit, mode).name} | RTS AI` : "Unit not found", description: unit ? unitLabel(unit, mode).description : undefined, alternates: { canonical: unit ? `/units/${unit.id}` : "/factions" } };
}
export default async function UnitPage({ params, searchParams }: Props) {
  const unit = unitById((await params).unitId);
  if (!unit) notFound();
  const faction = factionById(unit.factionId)!;
  const mode = resolveMode((await searchParams).mode);
  const variant = unit.variants[mode];
  const label = unitLabel(unit, mode);
  const artwork = mediaById(unit.assetIds[0]);
  const authored = artwork && "nativeApproval" in artwork && artwork.nativeApproval === "pending";
  return <><SiteHeader /><main id="main-content" className="catalog-page"><Link className="catalog-back" href={`/factions/${faction.id}?mode=${mode}`}>← {faction.name} faction</Link>
    <header className="dossier-hero unit-hero"><div><span className="eyebrow">{faction.name} / {label.role}</span><h1>{label.name}</h1><p>{label.description}</p></div><CatalogImage id={unit.assetIds[0]} portrait priority /></header>
    <ModeNav mode={mode} path={`/units/${unit.id}`} />
    {variant ? <><section className="doctrine-grid"><article><span className="section-number">FIELD ROLE</span><h2>{label.role}</h2><p>{unit.strengths}</p></article><article><span className="section-number">COUNTERPLAY</span><h2>Know the limits</h2><p>{unit.counterplay}</p></article><article><span className="section-number">BATTLEFIELD</span><h2>{mode === "ra" ? "Classic" : "Red Alert 2"}</h2><p>Each mode has its own rules and balance. Explore this faction’s full force for units, buildings and costs.</p><Link className="text-action" href={`/factions/${faction.id}?mode=${mode}#complete-roster-title`}>Full faction roster →</Link></article></section>
    {mode === "ra2" && <UnitInGameArt catalogUnitId={unit.id} />}
    <section className="unit-appearance"><div><span className="section-number">ART REFERENCE</span><h2>From portrait to battlefield.</h2><p>{authored ? "Original authored source render and production cameo. Native animation packages exist in both modes; visual approval is pending." : "The portrait and directional sprite sheet show the existing Classic artwork. Faction art is being rebuilt and refined."}</p>{!authored && mode === "ra2" && <p>RA2 uses its own rendering and actor definition; the viewer above draws the RA2 model. This Classic sheet is reference material, not proof of the RA2 appearance.</p>}</div><CatalogImage id={unit.assetIds[1]} /></section>
    <details className="catalog-provenance"><summary>Inspect the gameplay source</summary><p>Editorial ID: <code>{unit.id}</code> · actor: <code>{variant.actorId}</code></p><p><code>{variant.rulesPath}</code></p><p>Catalog actor links are checked against source definitions. This is not a complete resolved-rule or balance simulation.</p></details></> : <section className="catalog-unavailable"><h2>No Red Alert 2 variant.</h2><p>This unit belongs to the Classic roster only.</p><Link href={`/units/${unit.id}?mode=ra`}>View Classic implementation →</Link></section>}
    <ReleaseCallout faction={faction} mode={mode} />
  </main><SiteFooter /></>;
}
