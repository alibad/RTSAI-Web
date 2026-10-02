/* Pre-compressed, content-hashed assets retain their manifest dimensions. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { availability, downloadHref, mediaById, modes, type Faction, type GameMode } from "../../lib/game-content";
export function ModeNav({ mode, path }: { mode: GameMode; path: string }) {
  return <nav className="mode-nav" aria-label="Game mode">{[...modes].sort((a, b) => (a.id === "ra2" ? -1 : 0) - (b.id === "ra2" ? -1 : 0)).map(item =>
    <Link key={item.id} href={`${path}?mode=${item.id}`} aria-current={mode === item.id ? "page" : undefined}><b>{item.name}</b><span>{item.subtitle}</span></Link>)}</nav>;
}
export function CatalogImage({ id, portrait = false, priority = false }: { id: string; portrait?: boolean; priority?: boolean }) {
  const asset = mediaById(id);
  if (!asset) return null;
  const label = asset.category === "concept" ? "Concept art" : asset.category === "cameo" ? "Classic · in-game portrait" : asset.category === "unit" ? "Classic · sprite sheet" : "Classic · game evidence";
  return <figure className={`catalog-image ${portrait ? "is-portrait" : ""}`}><img src={asset.src} width={asset.width} height={asset.height} alt={asset.title} loading={priority ? "eager" : "lazy"} /><figcaption>{label}</figcaption></figure>;
}
export function ReleaseCallout({ faction, mode }: { faction: Faction; mode: GameMode }) {
  const status = availability(faction, mode);
  return <aside className="catalog-release" aria-label="Play this faction"><div><span className="section-number">{status}</span><h2>From the dossier to the battlefield.</h2><p>{status === "Not in this mode" ? "This faction does not have an RA2 variant yet. Its Classic guide and release details remain available." : status === "In public Windows release" ? "This faction is documented in the public Windows Red Sea build. Review the installer and AI options before you download." : "This variant exists in development. The public alpha does not certify this selection; a local build is not a public download."}</p></div><Link className="primary-action" href={downloadHref(faction.id, mode)}>Check install options <ArrowRight size={17} /></Link></aside>;
}
