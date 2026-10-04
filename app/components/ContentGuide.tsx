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
  return <aside className="catalog-release" aria-label="Play this faction"><div><span className="section-number">{status}</span><h2>{status === "In public Windows release" ? "Ready for the battlefield." : "Follow the release."}</h2><p>{status === "Not in this mode" ? "There is no roster for this faction in this mode yet." : status === "In public Windows release" ? `This faction is verified in the public ${mode === "ra2" ? "RTS AI mod" : "Classic Red Sea alpha"} for Windows. See the installation details before you download.` : "This faction is in development. Check the release page for the build you can download today."}</p></div><Link className="primary-action" href={downloadHref(faction.id, mode)}>Release details <ArrowRight size={17} /></Link></aside>;
}
