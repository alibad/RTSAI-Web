import type { CSSProperties } from "react";
import { factions } from "../../lib/game-content";
import { LineupImage } from "./FactionVisuals";
import "../home.css";

/** The seven faction lineups side by side, the project's own unit art (public/faction-art). Decorative. */
export function FrontLine({ priority = 0 }: { priority?: number }) {
  const modern = factions.filter(f => f.variants.ra2.status === "implemented");
  return <div className="home-frontline" aria-hidden="true">{modern.map((f, i) =>
    <div key={f.id} className="home-frontline-unit" style={{ "--i": i } as CSSProperties}><LineupImage factionId={f.id} alt="" sizes="(min-width: 1000px) 520px, 70vw" priority={i < priority} /></div>)}</div>;
}
