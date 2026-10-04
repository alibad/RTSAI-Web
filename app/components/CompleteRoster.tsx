import Link from "next/link";
import { categoryLabels, rosterActors, units, type GameMode, type RosterFaction } from "../../lib/game-content";

export function CompleteRoster({ faction, mode }: { faction: RosterFaction; mode: GameMode }) {
  const actors = rosterActors(faction);
  return <section className="complete-roster" aria-labelledby="complete-roster-title"><div className="roster-heading"><div><span className="section-number">THE COMPLETE FORCE</span><h2 id="complete-roster-title">Units, buildings & defenses</h2></div><p>{actors.length} buildable entries in the current {mode === "ra2" ? "RA2" : "Classic"} rules. Open a category to explore.</p></div>
    {Object.entries(categoryLabels).map(([category, label]) => {
      const entries = actors.filter(a => a.category === category);
      if (!entries.length) return null;
      return <details className="roster-category" key={category} open={category === "structure" || category === "defense"}><summary>{label}<span>{entries.length}</span></summary><div className="roster-table-wrap"><table><caption className="sr-only">{faction.name} {label.toLowerCase()} in {mode === "ra2" ? "Red Alert 2" : "Classic"}</caption><thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Cost</th></tr></thead><tbody>{entries.map(actor => {
        const dossier = units.find(u => u.variants[mode]?.actorId.toLowerCase() === actor.id.toLowerCase());
        return <tr key={actor.key}><th scope="row">{dossier ? <Link href={`/units/${dossier.id}?mode=${mode}`}>{actor.name} →</Link> : actor.name}</th><td>{actor.roles.length ? actor.roles.map(r => r.replaceAll("-", " ")).join(" · ") : "—"}</td><td>{actor.cost === null ? "—" : `$${actor.cost.toLocaleString("en")}`}</td></tr>;
      })}</tbody></table></div></details>;
    })}
    <p className="directory-footnote">Costs come from this mode’s rules. Country bonuses and upgrades can change play; these are development rosters, not a promise of public release coverage.</p>
  </section>;
}
