"use client";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Building2, Check, Clock3, RefreshCw, Users } from "lucide-react";
import { rebuildComplete, type RebuildCampaign } from "../../../../lib/art-lab/rebuild";
import type { ReviewState } from "../../../../lib/art-lab/review";
import { artCategories } from "../../../../lib/art-lab/types";

const names: Record<string, string> = { infantry: "Infantry", vehicle: "Vehicles", aircraft: "Aircraft", ship: "Naval", defense: "Defenses", structure: "Buildings" };
const gates = ["Design", "Model", "Icon", "Actions", "Visual check", "Native encounters", "Balance", "Owner review"];

export function Rebuild({ mode, state, onOpen }: { mode: "ra2" | "classic"; state: ReviewState | null; onOpen: (faction: string, actor: string) => void }) {
  const [campaign, setCampaign] = useState<RebuildCampaign | null>(null), [error, setError] = useState("");
  const [category, setCategory] = useState("all"), [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/art-review/rebuild", { cache: "no-store" }).then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error); if (!cancelled) setCampaign(p); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [mode, revision]);
  const actors = useMemo(() => Object.values(campaign?.actors ?? {}).filter(a => a.mode === mode), [campaign, mode]);
  const filtered = actors.filter(a => (category === "all" || a.category === category) && `${a.name} ${a.roles.join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  const counts = campaign?.modes[mode], factions = campaign?.factions.filter(f => f.mode === mode) ?? [];
  const workspaces = new Map(state?.units.map(u => [u.actor, u]) ?? []);
  const finished = actors.filter(rebuildComplete).length;
  const baseline = campaign?.nativeBaseline?.[mode];
  if (error) return <main id="main-content" className="rebuild"><p className="arena-error">{error}</p></main>;
  if (!counts) return <main id="main-content" className="rebuild"><p className="lab-empty">Loading the rebuild…</p></main>;
  return <main id="main-content" className="rebuild">
    <header className="rebuild-heading"><div><span className="lab-label">FULL FACTION REBUILD</span><h1>Every faction. Every battlefield role.</h1><p>Units, buildings and their actions · shared actors rebuilt once per game mode.{counts.supportingActors ? ` Plus ${counts.supportingActors} supporting actors: wrecks, deployed forms and spawned units.` : ""}</p></div><span className="lab-pill">Measured · current game catalog</span></header>
    <section className="rebuild-stats" aria-label="Rebuild scope"><div><Users size={19} /><b>{counts.factions}</b><span>Faction rosters</span></div><div><b>{counts.actors}</b><span>Distinct actors</span></div><div><Building2 size={19} /><b>{counts.categories.structure + counts.categories.defense}</b><span>Buildings & defenses</span></div><div><Check size={19} /><b>{finished}<small> / {counts.actors}</small></b><span>Rebuilds fully verified</span></div></section>
    <div className="rebuild-section-title"><div><b>Measured · {baseline?.recorded ?? 0} / {counts.actors} native smoke recordings</b><p>One scenario per actor. Art, complete action coverage and balance remain separate checks.{baseline?.failed ? ` ${baseline.failed} recordings failed.` : ""}</p></div><button className="lab-ghost" aria-label="Refresh rebuild progress" onClick={() => setRevision(n => n + 1)}><RefreshCw size={14} /> Refresh</button></div>
    <section className="rebuild-rosters"><div className="rebuild-section-title"><h2>All factions are in scope</h2><p>Measured · columns include shared actors in each roster.</p></div><div className="rebuild-table-wrap"><table><thead><tr><th>Faction</th>{artCategories.map(c => <th key={c}>{names[c]}</th>)}<th>Total</th><th /></tr></thead><tbody>{factions.map(f => <tr key={f.key}><td><b>{f.name}</b><small>{f.side}</small></td>{artCategories.map(c => <td key={c}>{f.categories[c]}</td>)}<td><strong>{f.actors.length}</strong></td><td><button className="lab-ghost" aria-label={`Open ${f.name} roster`} onClick={() => onOpen(f.id, campaign!.actors[f.actors[0]].actor)}>Open <ArrowUpRight size={14} /></button></td></tr>)}</tbody></table></div></section>
    <section className="rebuild-workflow"><h2>What a finished rebuild must pass</h2><div>{gates.map((g, i) => <span key={g}><small>{i + 1}</small>{g}</span>)}</div><p>Inferred · required checks. Existing art and passing numbers alone do not complete a rebuild.</p></section>
    <section><div className="rebuild-section-title"><h2>Actor work queue</h2><span>{filtered.length} actors</span></div><div className="rebuild-filters"><input type="search" aria-label="Search rebuild actors" placeholder="Find an actor or role…" value={search} onChange={e => setSearch(e.target.value)} /><div className="lab-seg"><button aria-pressed={category === "all"} onClick={() => setCategory("all")}>All</button>{artCategories.map(c => <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{names[c]}</button>)}</div></div><div className="rebuild-queue">{filtered.map(a => { const ws = workspaces.get(a.actor); return <button key={a.key} onClick={() => onOpen(a.factions[0], a.actor)}><div className="rebuild-actor-symbol">{a.category === "structure" || a.category === "defense" ? <Building2 size={22} /> : <Users size={22} />}</div><div><b>{a.name}</b><small>{names[a.category]} · {a.factions.length > 1 ? `Shared by ${a.factions.length} factions` : factions.find(f => f.id === a.factions[0])?.name}</small><span><Clock3 size={12} />{ws?.candidates.length ? `${ws.candidates.length} candidates · rebuild checks pending` : "Design pending"}</span></div><ArrowUpRight size={16} /></button>; })}</div></section>
  </main>;
}
