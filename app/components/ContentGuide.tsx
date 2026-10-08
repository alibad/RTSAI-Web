import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { availability, downloadHref, modeLabels, type Faction, type GameMode } from "../../lib/game-content";

/** Both gameplay modes belong to RTS AI. Catalog ids stay unchanged during the Classic port. */
export function ModeNav({ mode, path }: { mode: GameMode; path: string }) {
  return <nav className="mode-nav" aria-label="Game mode">{(["ra2", "ra"] as const).map(id =>
    <Link key={id} className={modeLabels[id].addOn ? "is-addon" : undefined} href={`${path}?mode=${id}`} aria-current={mode === id ? "page" : undefined}><b>{modeLabels[id].addOn ? `${modeLabels[id].name} add-on` : modeLabels[id].name}</b><span>{modeLabels[id].subtitle}</span></Link>)}</nav>;
}
export function ReleaseCallout({ faction, mode }: { faction: Faction; mode: GameMode }) {
  const status = availability(faction, mode);
  return <aside className="catalog-release" aria-label="Play this faction"><div><span className="section-number">{status}</span><h2>{status === "In public Windows release" ? "Ready for the battlefield." : "Coming to your browser and Windows."}</h2><p>{status === "Not in this mode" ? "There is no roster for this faction in this mode yet." : status === "In public Windows release" ? `This faction is verified in the public ${mode === "ra2" ? "RTS AI release" : "earlier Classic prototype"} for Windows. See the installation details before you download.` : "RTS AI is in development. Check the release page for what you can play today."}</p></div><Link className="primary-action" href={downloadHref(faction.id, mode)}>Release details <ArrowRight size={17} /></Link></aside>;
}
