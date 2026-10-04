"use client";
import { Building2, Film, Swords, Palette, Library } from "lucide-react";
import { ActorSourceDetails } from "./Sources";
import type { BehaviorFacts } from "../../../../lib/art-lab/behavior";
import { spriteAnimations } from "../../../../lib/art-lab/sprite-anim";
import { setLab, useLab } from "./lab-store";
import type { ReviewUnit } from "./versions";

export function StudioBar({ mode, onMode, surface, onSurface, onSources }: { mode: "ra2" | "classic"; onMode: (m: "ra2" | "classic") => void; surface: "art" | "arena"; onSurface: (s: "art" | "arena") => void; onSources: () => void }) {
  return <header className="studio-bar"><div className="studio-title"><Building2 size={19} /><b>Faction Studio</b><span>LOCAL</span></div><nav className="studio-navigation" aria-label="Studio workspace">{([{ id: "art", label: "Unit studio", Icon: Palette }, { id: "arena", label: "Encounter", Icon: Swords }] as const).map(({ id, label, Icon }) => <button key={id} aria-current={(surface === id || id === "art" && surface !== "arena") ? "page" : undefined} onClick={() => onSurface(id)}><Icon size={16} />{label}</button>)}</nav><button className="lab-ghost studio-sources-trigger" onClick={onSources}><Library size={16}/>Sources</button><select className="studio-mode" aria-label="Game mode" value={mode} onChange={e => onMode(e.target.value as "ra2" | "classic")}><option value="ra2">Red Alert 2</option><option value="classic">Red Alert · Classic</option></select></header>;
}

/** Actions live beside the art they control; unsupported rotations are explained rather than faked. */
export function ActionShelf({ unit, onEncounter }: { unit: ReviewUnit; onEncounter: () => void }) {
  const animation = useLab(s => s.animation);
  const options = spriteAnimations(unit.sprite);
  const facing = useLab(s => s.facing), turret = useLab(s => s.turret);
  const turns = Boolean(unit.spec.voxel) || options.some(a => Math.abs(a.body?.facings ?? 1) > 1);
  const hasTurret = Boolean(unit.sprite?.turret || unit.spec.voxel?.parts.some(p => p.turretOffset !== null));
  return <section className="studio-action-shelf" aria-label="Artwork and behavior"><div className="studio-action-heading"><span>Preview behavior</span><button className="lab-ghost" onClick={onEncounter}><Swords size={14} />Test against another actor</button></div><div className="studio-action-list">{options.map(a => <button key={a.id} aria-pressed={animation === a.id} onClick={() => setLab({ animation: a.id, playing: true, view3d: "off" })}><Film size={13} />{a.label}</button>)}{!options.length && <span className="lab-hint">Voxel model · movement and combat in Encounter</span>}</div><div className="studio-pose-controls">{turns ? <label>Body facing<input aria-label="Body facing" type="range" min={0} max={1023} value={facing} onChange={e => setLab({ facing: Number(e.target.value), spin: false })} /></label> : <span className="lab-hint">Fixed isometric artwork · this building has one authored view.</span>}{hasTurret && <label>Turret aim<input aria-label="Turret aim" type="range" min={-512} max={512} value={turret} onChange={e => setLab({ turret: Number(e.target.value), spin: false })} /></label>}</div><p className="lab-hint">Sequence preview from game artwork. Encounter measures movement, damage and destruction in OpenRA.</p></section>;
}

export function BehaviorPanel({ unit, facts }: { unit: ReviewUnit; facts: BehaviorFacts | null }) {
  const animation = useLab(s => s.animation);
  const options = spriteAnimations(unit.sprite);
  const common = (a: { detail: string }) => /rank-|crate-|invulnerability/.test(a.detail);
  const card = (a: { id: string; label: string; detail: string }) => <div className="studio-behavior" key={a.id}><b>{a.label}</b><p>{a.detail}</p></div>;
  if (!facts) return <aside className="lab-panel studio-facts"><div className="studio-panel-head"><span className="lab-label">ACTOR & BEHAVIOR</span><h2>{unit.name}</h2><p>Loading the actor’s game rules…</p></div></aside>;
  return <aside className="lab-panel studio-facts"><div className="studio-panel-head"><span className="lab-label">ACTOR & BEHAVIOR</span><h2>{unit.name}</h2><p>{unit.category === "defense" ? "Defense structure" : unit.role}</p></div>
    <ActorSourceDetails unit={unit}/><div className="studio-fact-grid"><div><small>Health</small><b>{facts?.health ?? "—"}</b></div><div><small>Armor</small><b>{facts?.armor ?? "—"}</b></div><div><small>Speed</small><b>{facts?.speed ?? "Stationary"}</b></div><div><small>Footprint</small><b>{facts?.footprint ?? "Mobile"}</b></div></div>
    {options.length > 0 && <section><h3>Play an action</h3><div className="studio-action-list">{options.map(a => <button key={a.id} aria-pressed={animation === a.id} onClick={() => setLab({ animation: a.id, playing: true, view3d: "off" })}><Film size={13} />{a.label}</button>)}</div><p className="lab-hint">Art preview · game sprite sequences</p></section>}
    <section><h3>Weapons</h3>{facts?.weapons.length ? facts.weapons.map((w, i) => <div className="studio-weapon" key={`${w.id}-${i}`}><b>{w.id}</b><span>{w.projectile}</span><div><strong>{w.range}</strong> cell range <i>·</i> <strong>{w.reload / 25}s</strong> reload</div><small>{w.burst > 1 ? `${w.burst}-shot burst · ` : ""}{w.damage ?? "Special"} damage {w.minRange >= .01 ? `· ${w.minRange} cell minimum` : ""}</small><small>{w.targets.length ? w.targets.join(" · ") : "Engine default targets"}</small>{w.condition && <small title={w.condition}>When {w.condition.replaceAll("rank-elite", "elite")}</small>}</div>) : <p className="lab-hint">No direct weapon. Explore production, support or transport.</p>}</section>
    <section><h3>What makes it different</h3>{facts?.description && <p className="lab-hint">{facts.description}</p>}{facts?.actions.filter(a => !common(a)).map(card)}{facts?.actions.some(common) && <details><summary>Veterancy, crates & protection</summary>{facts.actions.filter(common).map(card)}</details>}</section>
    <p className="studio-evidence">Configured · read from game rules.<br />Balance is measured in the Arena.</p>
  </aside>;
}
