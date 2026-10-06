import Link from "next/link";
import { categoryLabels, rosterActors, units, type GameMode, type RosterFaction } from "../../lib/game-content";
import { artActorFor, categoryOrder, unitStats, viewerHref, VIEWER_READY } from "../../lib/faction-art";
import { Cameo, CategoryIcon, StatBars, UnitRender } from "./FactionVisuals";

type Actor = ReturnType<typeof rosterActors>[number];
const cost = (actor: Actor) => (actor.cost === null ? null : `$${actor.cost.toLocaleString("en")}`);
const roles = (actor: Actor) => actor.roles.slice(0, 2).map(r => r.replaceAll("-", " "));

/**
 * The faction's whole build roster by category. Its own units are cards with their art and stats; units shared
 * with the original sides are named only (their art is the original game's, which this site never shows).
 */
export function CompleteRoster({ faction, mode, catalogFactionId }: { faction: RosterFaction; mode: GameMode; catalogFactionId?: string }) {
  const actors = rosterActors(faction);
  const own = new Map(actors.map(a => [a.key, artActorFor(a, faction)]));
  const ownCount = [...own.values()].filter(Boolean).length;
  return <section className="faction-roster" aria-labelledby="complete-roster-title">
    <div className="roster-heading"><div><span className="section-number">THE FORCE</span><h2 id="complete-roster-title">Units, buildings & defenses</h2></div>
      <p>{actors.length} entries in the {mode === "ra2" ? "Red Alert 2" : "Classic"} rules{ownCount ? `, ${ownCount} unique to ${faction.name}` : ""}.{mode === "ra" && ownCount ? " Pictured with the Red Alert 2 models." : ""}</p></div>
    {categoryOrder.map(category => {
      const entries = actors.filter(a => a.category === category);
      if (!entries.length) return null;
      const cards = entries.filter(a => own.get(a.key));
      const shared = entries.filter(a => !own.get(a.key));
      return <div className="roster-category-block" key={category}>
        <h3 className="roster-category-title"><CategoryIcon category={category} size={18} />{categoryLabels[category]}<span>{entries.length}</span></h3>
        {cards.length > 0 && <ul className="roster-cards">{cards.map(actor => {
          const art = own.get(actor.key)!;
          const dossier = units.find(u => u.variants[mode]?.actorId.toLowerCase() === actor.id.toLowerCase());
          const href = dossier ? `/units/${dossier.id}?mode=${mode}` : VIEWER_READY && catalogFactionId ? viewerHref(catalogFactionId, art) : null;
          const body = <>
            <div className="roster-card-stage"><UnitRender actorId={art} alt="" sizes="(min-width: 1100px) 240px, (min-width: 640px) 30vw, 46vw" /><Cameo actorId={art} alt="" /></div>
            <div className="roster-card-copy">
              <h4>{actor.name}</h4>
              <div className="roster-card-tags">{cost(actor) && <span className="cost-chip">{cost(actor)}</span>}{roles(actor).map(r => <span key={r}>{r}</span>)}</div>
              <StatBars stats={unitStats(actor)} compact />
            </div>
          </>;
          return <li key={actor.key} className="roster-card">{href ? <Link href={href} aria-label={`${actor.name}: ${dossier ? "unit dossier" : "open in the Faction viewer"}`}>{body}</Link> : <div>{body}</div>}</li>;
        })}</ul>}
        {shared.length > 0 && <div className="shared-units"><span>{cards.length ? "Shared" : ""}</span><ul>{shared.map(actor => {
          const dossier = units.find(u => u.variants[mode]?.actorId.toLowerCase() === actor.id.toLowerCase());
          const label = <>{actor.name}{cost(actor) && <small>{cost(actor)}</small>}</>;
          return <li key={actor.key}>{dossier ? <Link href={`/units/${dossier.id}?mode=${mode}`}>{label}</Link> : label}</li>;
        })}</ul></div>}
      </div>;
    })}
    <p className="directory-footnote">Costs and stats come from this mode’s rules; bars compare units of the same kind. Country bonuses and upgrades can change play. These are development rosters, not a promise of public release coverage.</p>
  </section>;
}
