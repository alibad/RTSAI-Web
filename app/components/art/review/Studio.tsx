"use client";
import { Building2, Film, Swords, Palette } from "lucide-react";
import type { BehaviorFacts } from "../../../../lib/art-lab/behavior";
import { spriteAnimations } from "../../../../lib/art-lab/sprite-anim";
import { setLab, useLab } from "./lab-store";
import type { ReviewUnit } from "./versions";

export function StudioBar({ mode, onMode, surface, onSurface }: { mode: "ra2" | "classic"; onMode: (m: "ra2" | "classic") => void; surface: "art" | "actions" | "arena"; onSurface: (s: "art" | "actions" | "arena") => void }) {
  return <div className="studio-bar"><div className="studio-title"><Building2 size={19} /><b>Faction Studio</b><span>LOCAL</span></div><div className="lab-seg" aria-label="Game mode"><button aria-pressed={mode === "ra2"} onClick={() => onMode("ra2")}>Red Alert 2</button><button aria-pressed={mode === "classic"} onClick={() => onMode("classic")}>Red Alert · Classic</button></div><div className="lab-seg" aria-label="Studio workspace">{([{ id: "art", label: "Art", Icon: Palette }, { id: "actions", label: "Actions", Icon: Film }, { id: "arena", label: "Arena", Icon: Swords }] as const).map(({ id, label, Icon }) => <button key={id} aria-pressed={surface === id} onClick={() => onSurface(id)}><Icon size={14} />{label}</button>)}</div></div>;
}

export function BehaviorPanel({ unit, facts }: { unit: ReviewUnit; facts: BehaviorFacts | null }) {
  const animation = useLab(s => s.animation);
  const options = spriteAnimations(unit.sprite);
  const common = (a: { detail: string }) => /rank-|crate-|invulnerability/.test(a.detail);
  const card = (a: { id: string; label: string; detail: string }) => <div className="studio-behavior" key={a.id}><b>{a.label}</b><p>{a.detail}</p></div>;
  return <aside className="lab-panel studio-facts"><div className="studio-panel-head"><span className="lab-label">ACTOR & BEHAVIOR</span><h2>{unit.name}</h2><p>{unit.category === "defense" ? "Defense structure" : unit.role}</p></div>
    <div className="studio-fact-grid"><div><small>Health</small><b>{facts?.health ?? "—"}</b></div><div><small>Armor</small><b>{facts?.armor ?? "—"}</b></div><div><small>Speed</small><b>{facts?.speed ?? "Stationary"}</b></div><div><small>Footprint</small><b>{facts?.footprint ?? "Mobile"}</b></div></div>
    {options.length > 0 && <section><h3>Play an action</h3><div className="studio-action-list">{options.map(a => <button key={a.id} aria-pressed={animation === a.id} onClick={() => setLab({ animation: a.id, playing: true, view3d: "off" })}><Film size={13} />{a.label}</button>)}</div><p className="lab-hint">Art preview · game sprite sequences</p></section>}
    <section><h3>Weapons</h3>{facts?.weapons.length ? facts.weapons.map((w, i) => <div className="studio-weapon" key={`${w.id}-${i}`}><b>{w.id}</b><span>{w.projectile}</span><div><strong>{w.range}</strong> cell range <i>·</i> <strong>{w.reload / 25}s</strong> reload</div><small>{w.burst > 1 ? `${w.burst}-shot burst · ` : ""}{w.damage ?? "Special"} damage {w.minRange >= .01 ? `· ${w.minRange} cell minimum` : ""}</small><small>{w.targets.length ? w.targets.join(" · ") : "Engine default targets"}</small>{w.condition && <small title={w.condition}>When {w.condition.replaceAll("rank-elite", "elite")}</small>}</div>) : <p className="lab-hint">No direct weapon. Explore production, support or transport.</p>}</section>
    <section><h3>What makes it different</h3>{facts?.description && <p className="lab-hint">{facts.description}</p>}{facts?.actions.filter(a => !common(a)).map(card)}{facts?.actions.some(common) && <details><summary>Veterancy, crates & protection</summary>{facts.actions.filter(common).map(card)}</details>}</section>
    <p className="studio-evidence">Configured · read from game rules.<br />Balance is measured in the Arena.</p>
  </aside>;
}
