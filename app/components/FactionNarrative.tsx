import type { CSSProperties } from "react";
import Link from "next/link";
import { Eye, Flag } from "lucide-react";
import { factionNarrative } from "../../lib/faction-narrative";
import type { Faction, GameMode } from "../../lib/game-content";
import { FactionFlag } from "./FactionVisuals";

/** "Identity" and "Rivals' view" from the catalog; each section renders only when the catalog has its text. */
export function FactionNarrative({ faction, mode }: { faction: Faction; mode: GameMode }) {
  const narrative = factionNarrative(faction);
  if (!narrative) return null;
  const { identity, rivalViews, framing } = narrative;
  return <>
    {identity && <section className="faction-narrative is-identity" aria-labelledby="faction-identity-title">
      <div className="faction-narrative-mark"><Flag size={18} aria-hidden="true" /><span className="section-number">IDENTITY</span></div>
      <h2 id="faction-identity-title">{identity.motto ?? "What they fight for"}</h2>
      {identity.keywords.length > 0 && <ul className="narrative-keywords" aria-label="In three words">{identity.keywords.map(k => <li key={k}>{k}</li>)}</ul>}
      <div className="faction-narrative-body">{identity.story.map((p, i) => <p key={i}>{p}</p>)}</div>
    </section>}
    {rivalViews.length > 0 && <section className="faction-narrative is-rivals" aria-labelledby="faction-rivals-title">
      <div className="faction-narrative-mark"><Eye size={18} aria-hidden="true" /><span className="section-number">RIVALS’ VIEW</span></div>
      <h2 id="faction-rivals-title">Through their enemies’ eyes</h2>
      <div className="rival-views">{rivalViews.map(view => <article key={view.rival.id} className="rival-view" style={{ "--rival-accent": view.rival.accent } as CSSProperties}>
        <Link className="rival-view-by" href={`/factions/${view.rival.id}?mode=${mode}`}><FactionFlag factionId={view.rival.id} name={view.rival.name} accent={view.rival.accent} size="sm" /><span>{view.rival.name}{view.kind ? ` · ${view.kind}` : ""}</span></Link>
        {view.text.map((p, j) => <blockquote key={j}><p>{p}</p></blockquote>)}
      </article>)}</div>
      {framing && <p className="narrative-framing">{framing}</p>}
    </section>}
  </>;
}
