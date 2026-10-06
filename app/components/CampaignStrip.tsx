import { BookOpen, Users } from "lucide-react";
import { campaignsForFaction } from "../../lib/faction-campaigns";
import type { GameMode } from "../../lib/game-content";

/** Read-only: the campaigns played as this faction. Editing stays in the admin-only Campaign studio. */
export function CampaignStrip({ factionId, mode }: { factionId: string; mode: GameMode }) {
  const campaigns = campaignsForFaction(factionId, mode);
  if (!campaigns.length) return null;
  return <section className="campaign-strip" aria-labelledby="faction-campaigns-title">
    <div className="roster-heading"><div><span className="section-number">CAMPAIGNS</span><h2 id="faction-campaigns-title">Play the story</h2></div></div>
    {campaigns.map(c => {
      const chapters = c.missions;
      return <article key={c.id} className="campaign-card">
        <header>
          <div><span className="campaign-tag">Fictional campaign</span><h3>{c.title}</h3><p>{c.setting}</p></div>
          <ul className="count-chips"><li><BookOpen size={14} aria-hidden="true" /><b>{chapters.length}</b><span>chapters</span></li><li><Users size={14} aria-hidden="true" /><b>{c.characters.length}</b><span>characters</span></li></ul>
        </header>
        <p className="campaign-synopsis">{c.synopsis}</p>
        <ol className="campaign-chapters">{chapters.map((m, i) => <li key={m.id} className={m.id === c.start ? "is-start" : undefined}><b>{String(i + 1).padStart(2, "0")}</b><strong>{m.title}</strong><span>{m.location}</span></li>)}</ol>
        <ul className="campaign-cast">{c.characters.map(p => <li key={p.id}><span aria-hidden="true">{p.name.slice(0, 1)}</span><div><b>{p.name}</b><small>{p.role}</small></div></li>)}</ul>
      </article>;
    })}
  </section>;
}
