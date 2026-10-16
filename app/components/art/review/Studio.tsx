"use client";
import { useSyncExternalStore } from "react";
import { Building2, Film, Swords, Palette, Library, Check, X, Minus, LayoutGrid, Flag, Map as MapIcon, Eye, BookOpen, FlaskConical, Gamepad2 } from "lucide-react";
import { failingFirst, type ActionCheck } from "../../../../lib/art-lab/chain";
import type { MeasuredGroup, MeasuredRow } from "../../../../lib/art-lab/measurements";
import type { Candidate } from "../../../../lib/art-lab/review";
import { ActorSourceDetails } from "./Sources";
import { SoundControls } from "./SoundControls";
import { OptionSelect } from "../../ui/fields";
import type { ModListing, StudioMode } from "../../../../lib/art-lab/review-ui";
import type { BehaviorFacts } from "../../../../lib/art-lab/behavior";
import { spriteAnimations } from "../../../../lib/art-lab/sprite-anim";
import { setLab, useLab } from "./lab-store";
import type { ReviewUnit,Version } from "./versions";
import { AnimationReadiness } from "./AnimationReadiness";
import { voxelAnimationParts, voxelCycleLabel } from "../../../../lib/art-lab/voxel-animation";
import { FIRE_ACTION, fireActions } from "../../../../lib/art-lab/fire";

const noSubscribe = () => () => {};
/** The installed local app (scripts/local-app.ps1) serves the website beside the Studio and marks the page for it. */
const useLocalSite = () => useSyncExternalStore(noSubscribe, () => document.body.dataset.site === "1", () => false);

export function StudioBar({ mode, mods = [], shared = false, onMode, surface, onSurface, onSources, viewerHref, encounterHref }: { viewerHref?: string; mods?: ModListing[]; shared?: boolean;
  /** RA2: the Encounter is the browser game's battle sandbox, opened as its own page (it needs cross-origin isolation). */
  encounterHref?: string; mode: StudioMode; onMode: (m: StudioMode) => void; surface: "art" | "arena" | "board"; onSurface: (s: "art" | "arena" | "board") => void; onSources: () => void }) {
  const site = useLocalSite();
  return <header className="studio-bar"><div className="studio-title"><Building2 size={19} /><b>Faction Studio</b><span>{shared ? "SHARED" : "LOCAL"}</span></div><nav className="studio-navigation" aria-label="Studio workspace">{([{ id: "board", label: "Review board", Icon: LayoutGrid }, { id: "art", label: "Unit studio", Icon: Palette }, { id: "arena", label: "Encounter", Icon: Swords }] as const).filter(t => t.id !== "board" || (mode === "ra2" && !shared)).map(({ id, label, Icon }) => (id === "arena" && encounterHref
    ? <a key={id} href={encounterHref} target="_blank" rel="noreferrer" title="The battle sandbox: the game's own simulation, in a new tab"><Icon size={16} />{label}</a>
    : <button key={id} aria-current={surface === id ? "page" : undefined} onClick={() => onSurface(id)}><Icon size={16} />{label}</button>))}{site && <><span className="studio-nav-divider" aria-hidden="true" /><a href="/play/" title="Play the browser game (top-level page: it needs cross-origin isolation)"><Gamepad2 size={16} /><span>Play</span></a><a href="/factions" title="Factions"><Flag size={16} /><span>Factions</span></a><a href={viewerHref ?? "/viewer"} title="The public Faction viewer, as players see it"><Eye size={16} /><span>Viewer</span></a><a href="/workshop" title="Workshop"><MapIcon size={16} /><span>Workshop</span></a><span className="studio-nav-divider" aria-hidden="true" /><span className="studio-admin" role="group" aria-label="Admin tools"><small>Admin</small><a href="/workshop/campaigns?mode=ra2" title="Campaign studio"><BookOpen size={16} /><span>Campaigns</span></a><a href="/workshop/evals?mode=ra2" title="AI testing"><FlaskConical size={16} /><span>AI testing</span></a></span></>}</nav><SoundControls /><button className="lab-ghost studio-sources-trigger" onClick={onSources}><Library size={16}/>Sources</button><OptionSelect<StudioMode> className="studio-mode" aria-label="Game mode" value={mode} onValueChange={onMode} options={[{ value: "ra2", label: "Red Alert 2", group: "RTS AI" }, { value: "classic", label: "Red Alert · Classic", group: "RTS AI" }, ...mods.map(m => ({ value: `mod:${m.id}` as StudioMode, label: m.name, group: "Mod library" }))]} /></header>; // eslint-disable-line @next/next/no-html-link-for-pages -- full page loads into the website the local app serves beside this standalone Studio
}

/** Actions live beside the art they control; unsupported rotations are explained rather than faked. */
/** `fireUnknown`: a vehicle whose firing rules are not loaded yet; its Fire button loads them (lib/art-lab/fire.ts). */
export function ActionShelf({ unit, version,mode,onEncounter,fireUnknown=false }: { unit: ReviewUnit;version:Version|null|undefined;mode:StudioMode; onEncounter: () => void; fireUnknown?: boolean }) {
  const animation = useLab(s => s.animation);
  const item=version?.item;
  const sprite=item?.sprite??unit.sprite,spec=item?.spec??unit.spec;
  const options = [...(spec.voxel ? voxelAnimationParts(spec).length?[{id:"body",label:voxelCycleLabel(spec),body:null,note:null}]:[] : spriteAnimations(sprite)), ...(fireUnknown ? [{ id: FIRE_ACTION, label: "Fire", body: null, note: null }] : fireActions(item?.fire))];
  const facing = useLab(s => s.facing), turret = useLab(s => s.turret);
  const turns = Boolean(spec.voxel) || options.some(a => Math.abs(a.body?.facings ?? 1) > 1);
  const hasTurret = Boolean(sprite?.turret || spec.voxel?.parts.some(p => p.turretOffset !== null));
  return <section className="studio-action-shelf" aria-label="Artwork and behavior"><div className="studio-action-heading"><span>Preview behavior{version?.kind==="candidate"?" / candidate":""}</span><button className="lab-ghost" onClick={onEncounter}><Swords size={14} />Test against another actor</button></div><div className="studio-action-list">{options.map(a => <button key={a.id} aria-pressed={animation === a.id} onClick={() => setLab({ animation: a.id, playing: true, view3d: "off" })}><Film size={13} />{a.label}</button>)}{!options.length && <span className="lab-hint">Voxel model · movement and combat in Encounter</span>}</div><div className="studio-pose-controls">{turns ? <label>Body facing<input aria-label="Body facing" type="range" min={0} max={1023} value={facing} onChange={e => setLab({ facing: Number(e.target.value), spin: false })} /></label> : <span className="lab-hint">Fixed isometric artwork · this building has one authored view.</span>}{hasTurret && <label>Turret aim<input aria-label="Turret aim" type="range" min={-512} max={512} value={turret} onChange={e => setLab({ turret: Number(e.target.value), spin: false })} /></label>}</div><p className="lab-hint">Sequence preview from game artwork. Encounter measures movement, damage and destruction in OpenRA.</p>{options.find(a=>a.id===animation)?.note&&<p className="lab-hint">{options.find(a=>a.id===animation)?.note}</p>}{version?.candidate?.previewNote&&<p className="lab-hint">{version.candidate.previewNote}</p>}<AnimationReadiness actor={unit.id} mode={mode}/></section>;
}

/** The Animations step: one row of the version's own actions (click to play); drag the stage to turn it. */
export function ActionRow({ unit, version, onEncounter }: { unit: ReviewUnit; version: Version | null | undefined; onEncounter: () => void }) {
  const animation = useLab(s => s.animation), turret = useLab(s => s.turret);
  const item = version?.item;
  const sprite = item?.sprite ?? unit.sprite, spec = item?.spec ?? unit.spec;
  const options = [...(spec.voxel ? (voxelAnimationParts(spec).length ? [{ id: "body", label: voxelCycleLabel(spec) }] : []) : spriteAnimations(sprite)), ...fireActions(item?.fire)];
  const hasTurret = Boolean(sprite?.turret || spec.voxel?.parts.some(p => p.turretOffset !== null));
  return <section className="studio-action-row" aria-label="Actions">
    <div className="studio-action-list" role="group" aria-label="Play an action">{options.map(a => <button key={a.id} aria-pressed={animation === a.id} onClick={() => setLab({ animation: a.id, playing: true, animationTime: 0, view3d: "off" })}><Film size={13} />{a.label}</button>)}
      {!options.length && <span className="lab-hint">No authored animation in this model{spec.voxel ? " (turn and aim it on the stage)" : ""}.</span>}</div>
    {hasTurret && <label className="studio-action-aim">Turret<input aria-label="Turret aim" type="range" min={-512} max={512} value={turret} onChange={e => setLab({ turret: Number(e.target.value), spin: false })} /></label>}
    <button className="lab-ghost" onClick={onEncounter}><Swords size={14} />Test in an encounter</button>
  </section>;
}

/** The Checks step: what the art tools measured for this candidate, failing checks first. Never the owner's decision. */
export function ChecksPanel({ checks, actions, candidate, label }: { checks: MeasuredGroup[]; actions: ActionCheck[]; candidate: Candidate | null; label: string | null }) {
  const mark = (pass: boolean | null) => pass === true ? <Check size={14} strokeWidth={3} className="is-good" /> : pass === false ? <X size={14} strokeWidth={3} className="is-bad" /> : <Minus size={14} />;
  const { failing, failedGroups, passing } = failingFirst(checks);
  const families = [...new Set(checks.flatMap(g => g.family))];
  const row = (r: MeasuredRow, key: string) => <li key={key} title={r.why}>{mark(r.pass)}<span>{r.label}<small>{[r.value !== null ? `${Math.abs(r.value) >= 100 ? Math.round(r.value) : +r.value.toFixed(3)}` : null, r.stock, r.range ? `needs ${r.range}` : null].filter(Boolean).join(" · ")}</small></span><b>{r.pass ? "pass" : "fail"}</b></li>;
  return <aside className="lab-panel studio-facts studio-checks"><div className="studio-panel-head"><span className="lab-label">CHECKS</span><h2>{label ?? "No candidate"}</h2>
    <p>{!candidate ? "Nothing to check until a game model exists." : !checks.length ? "Not measured yet. The art route has saved no results for this candidate." : `Measured by the art tools${families.length ? ` against stock ${families.join(", ")}` : ""}. A pass is not your approval.`}</p></div>
    {(failing.length > 0 || failedGroups.length > 0) && <section><h3 className="is-bad">Failing</h3><ul className="studio-check-list">
      {failing.map(({ group, row: r }) => row(r, `${group.file}:${r.metric}`))}
      {failedGroups.map(g => <li key={`${g.file}:${g.title}`}>{mark(false)}<span>{g.title}<small>{g.problems.join("; ") || g.tool}</small></span><b>fail</b></li>)}
    </ul></section>}
    {checks.map(g => { const ok = passing.find(p => p.group === g)?.rows ?? []; if (!ok.length && !g.notes.length && !(g.pass === true && !g.rows.length)) return null; return <section key={`${g.file}:${g.title}`}><h3>{g.title}<small>{g.tool}</small></h3>
      <ul className="studio-check-list">{g.pass === true && !g.rows.length && <li>{mark(true)}<span>{g.title}<small>{g.file}</small></span><b>pass</b></li>}{ok.map(r => row(r, `${g.file}:${r.metric}`))}{g.notes.map(n => <li key={n}>{mark(null)}<span>{n}</span><b /></li>)}</ul></section>; })}
    {actions.length > 0 && <section><h3>Actions in its own art</h3><ul className="studio-check-list">{actions.map(a => <li key={a.id}>{mark(a.present ? true : false)}<span>{a.label}</span><b>{a.present ? "yes" : "missing"}</b></li>)}</ul>{actions.find(a => a.note) && <p className="lab-hint">{actions.find(a => a.note)!.note}</p>}</section>}
  </aside>;
}

export function BehaviorPanel({ unit, facts }: { unit: ReviewUnit; facts: BehaviorFacts | null }) {
  const common = (a: { detail: string }) => /rank-|crate-|invulnerability/.test(a.detail);
  const card = (a: { id: string; label: string; detail: string }) => <div className="studio-behavior" key={a.id}><b>{a.label}</b><p>{a.detail}</p></div>;
  if (!facts) return <aside className="lab-panel studio-facts"><div className="studio-panel-head"><span className="lab-label">ACTOR & BEHAVIOR</span><h2>{unit.name}</h2><p>Loading the actor’s game rules…</p></div></aside>;
  return <aside className="lab-panel studio-facts"><div className="studio-panel-head"><span className="lab-label">ACTOR & BEHAVIOR</span><h2>{unit.name}</h2><p>{unit.category === "defense" ? "Defense structure" : unit.role}</p></div>
    <ActorSourceDetails unit={unit}/><div className="studio-fact-grid"><div><small>Health</small><b>{facts?.health ?? "—"}</b></div><div><small>Armor</small><b>{facts?.armor ?? "—"}</b></div><div><small>Speed</small><b>{facts?.speed ?? "Stationary"}</b></div><div><small>Footprint</small><b>{facts?.footprint ?? "Mobile"}</b></div></div>
    <section><h3>Weapons</h3>{facts?.weapons.length ? facts.weapons.map((w, i) => <div className="studio-weapon" key={`${w.id}-${i}`}><b>{w.id}</b><span>{w.projectile}</span><div><strong>{w.range}</strong> cell range <i>·</i> <strong>{w.reload / 25}s</strong> reload</div><small>{w.burst > 1 ? `${w.burst}-shot burst · ` : ""}{w.damage ?? "Special"} damage {w.minRange >= .01 ? `· ${w.minRange} cell minimum` : ""}</small><small>{w.targets.length ? w.targets.join(" · ") : "Engine default targets"}</small>{w.condition && <small title={w.condition}>When {w.condition.replaceAll("rank-elite", "elite")}</small>}</div>) : <p className="lab-hint">No direct weapon. Explore production, support or transport.</p>}</section>
    <section><h3>What makes it different</h3>{facts?.description && <p className="lab-hint">{facts.description}</p>}{facts?.actions.filter(a => !common(a)).map(card)}{facts?.actions.some(common) && <details><summary>Veterancy, crates & protection</summary>{facts.actions.filter(common).map(card)}</details>}</section>
    <p className="studio-evidence">Configured · read from game rules.<br />Balance is measured in the Arena.</p>
  </aside>;
}
