"use client";
/* Cameos are 60x48 pixel art, drawn at whole scales; next/image would resample them. */
/* eslint-disable @next/next/no-img-element */

import { ArrowLeft, BookOpen, Crosshair, Eye, Footprints, Pause, Play, Quote, ShieldAlert, Swords, Users, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ADMIN_BUILD } from "../../../../lib/admin";
import type { ViewerCampaign, ViewerFaction, ViewerFactionLink, ViewerUnit } from "../../../../lib/viewer";
import { FrameStore, type StageItem } from "../review/frames";
import { ViewerStage } from "./ViewerStage";
import { EffectGlyph } from "./attack-icons";
import { modeLabel } from "../../../../lib/weapon-demo";
import { ViewerAdmin, type ShownVersion } from "./ViewerAdmin";
import { SoundDesk, SoundDeskToggle, type Audition } from "./SoundDesk";
import { soundEngine } from "../review/sound";
import { SoundControls } from "../review/SoundControls";
import type { PublicClip } from "../../../../lib/faction-audio";
import { EA_NOTICE, useOriginalArt } from "../../../../lib/original-art";
import { isProjectClip, useFactionSounds, type SnapshotSounds } from "../../../../lib/original-sounds";
import "./viewer.css";

const groups: [string, string][] = [["infantry", "Infantry"], ["vehicle", "Vehicles"], ["aircraft", "Aircraft"], ["ship", "Naval"], ["defense", "Defenses"], ["structure", "Buildings"]];
const COLOR_KEY = "rtsai-viewer-color";
const DESK_KEY = "rtsai-viewer-desk";

const hrefFor = (faction: string, unit: string | null) => (unit ? `/viewer/${faction}/${unit}` : `/viewer/${faction}`);

/**
 * The public Faction viewer: a faction's units as the game draws them (turn them, play their actions), their stats
 * and doctrine, and the faction's campaigns. Read-only and player-facing: no candidates, checks, decisions or
 * provenance. Shared original units, and the nine original countries' whole rosters, are drawn with Westwood's art from
 * the Faction Studio's published snapshot (with EA's notice). The admin build adds a tucked-away History per unit.
 */
export function FactionViewer({ faction, factions, initial, marks, lineup, artFactionId }: {
  faction: ViewerFaction;
  factions: ViewerFactionLink[];
  initial: string | null;
  /** Flags or emblems per faction id, rendered on the server. */
  marks: Record<string, ReactNode>;
  /** The faction lineup picture, rendered on the server. */
  lineup: ReactNode;
  /** The art workspace's id for the faction (the Studio link in admin builds). */
  artFactionId: string;
}) {
  const [selected, setSelected] = useState<string | null>(initial);
  const [frames] = useState(() => new FrameStore());
  useEffect(() => { frames.revive(); return () => frames.dispose(); }, [frames]);
  const [color, setColor] = useState("F21818");
  // The remembered colour is read after hydration (the server has no storage); a one-time update.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { const c = localStorage.getItem(COLOR_KEY); if (c && /^[0-9A-F]{6}$/i.test(c)) setColor(c); } catch { /* storage unavailable */ } }, []);
  const pickColor = useCallback((hex: string) => { setColor(hex); try { localStorage.setItem(COLOR_KEY, hex); } catch { /* storage unavailable */ } }, []);
  const [shown, setShown] = useState<ShownVersion | null>(null);
  // Admin builds: the Sound desk takes the details column; it can make the stage's Attack demo fire a weapon with a
  // candidate sound (`audition`, `fire`). Public builds never turn it on (its module is an empty stub there).
  const [desk, setDeskState] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read after hydration (?desk=1 or the last choice)
  useEffect(() => { if (!ADMIN_BUILD) return; try { if (new URLSearchParams(window.location.search).has("desk") || localStorage.getItem(DESK_KEY) === "1") setDeskState(true); } catch { /* storage unavailable */ } }, []);
  const setDesk = useCallback((on: boolean) => { setDeskState(on); try { localStorage.setItem(DESK_KEY, on ? "1" : "0"); } catch { /* storage unavailable */ } }, []);
  const [audition, setAudition] = useState<Audition | null>(null);
  const [fire, setFire] = useState<{ weapon: string; n: number } | null>(null);
  const fireWeapon = useCallback((weapon: string) => setFire(f => ({ weapon, n: (f?.n ?? 0) + 1 })), []);

  const units = faction.units;
  const unit = units.find(u => u.id === selected) ?? null;
  // The details panel follows one frame after the stage: on a software GPU, repainting both in the frame that answers
  // the click doubles its cost, so the click paints the new unit first and its details right after.
  const infoUnit = useAfterPaint(unit);
  // Shared original units: Westwood's art, loaded once for factions that build any.
  const original = useOriginalArt(units.some(u => !u.art));
  const items = useMemo(() => new Map(units.flatMap(u => {
    const art = u.art ?? original[u.id.toLowerCase()];
    return art ? [[u.id, { key: u.id, spec: art.spec, sprite: art.sprite } as StageItem]] : [];
  })), [units, original]);
  const item = unit ? items.get(unit.id) ?? null : null;
  // Westwood's voices and effects (and every unit's weapon sounds) from the published snapshot, once a unit is shown.
  const [wantSounds, setWantSounds] = useState(Boolean(initial));
  if (unit && !wantSounds) setWantSounds(true);
  const snapSounds = useFactionSounds(faction.soundFaction, wantSounds);
  const sounds = useMemo(() => (unit ? shownSounds(unit, snapSounds, faction.effects) : []), [unit, snapSounds, faction.effects]);
  const infoSounds = useAfterPaint(sounds);
  // The last unit with art stays on the (hidden) stage while the overview or a text-only unit is shown.
  const [stageItem, setStageItem] = useState<StageItem | null>(item);
  if (item && item !== stageItem) setStageItem(item);

  // Selection is client-side (the stage keeps its loaded art); the address follows it, and Back works.
  const select = useCallback((id: string | null) => {
    setSelected(id); setShown(null);
    // Picking a unit plays one of its select lines, as in game (after a click, never on page load).
    const picked = id ? units.find(u => u.id === id) : null;
    if (picked) void soundEngine.playAny(groupSrcs(shownSounds(picked, snapSounds, faction.effects), "voice:Select"));
    const href = hrefFor(faction.id, id);
    if (window.location.pathname !== href) window.history.pushState({ unit: id }, "", href);
    window.scrollTo({ top: 0 });
  }, [faction.id, faction.effects, units, snapSounds]);
  useEffect(() => {
    const onPop = () => { const m = /^\/viewer\/[^/]+\/([^/?#]+)/.exec(window.location.pathname); setSelected(m ? decodeURIComponent(m[1]) : null); setShown(null); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => { document.title = `${unit ? `${unit.name} · ` : ""}${faction.name} · Faction viewer | RTS AI`; }, [unit, faction.name]);

  // An original country lists its whole roster by build tab; a modern faction its own units, then the shared ones.
  const project = faction.original ? units : units.filter(u => u.art), shared = faction.original ? [] : units.filter(u => !u.art);
  const cameoOf = (u: ViewerUnit) => u.cameo ?? original[u.id.toLowerCase()]?.spec.cameo ?? null;
  const identity = faction.narrative?.identity ?? null;
  const link = (u: ViewerUnit) => (e: React.MouseEvent) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); select(u.id); };

  return (
    <div className="viewer" style={{ "--faction-accent": faction.accent } as CSSProperties}>
      <header className="viewer-top">
        <a className="viewer-back" href={`/factions/${faction.id}?mode=ra2`}><ArrowLeft size={15} aria-hidden="true" />{faction.name}</a>
        {/* Every faction at a glance: the modern ones by name, the nine original countries as flags (the current one
            named). The two groups wrap onto a second row rather than scroll. */}
        <nav className="viewer-factions" aria-label="Factions">
          {[factions.filter(f => !f.original), factions.filter(f => f.original)].map((group, i) => group.length > 0 &&
            <div key={i} className={`viewer-factions-group${i ? " is-original" : ""}`} role="group" aria-label={i ? "Original countries" : "Modern factions"}>
              {group.map(f => <a key={f.id} href={hrefFor(f.id, null)} className={f.original ? "is-original" : undefined} aria-current={f.id === faction.id ? "page" : undefined} title={f.name}>{marks[f.id]}<span>{f.name}</span></a>)}
            </div>)}
        </nav>
        {ADMIN_BUILD && <SoundDeskToggle on={desk} onChange={setDesk} />}
        <SoundControls />
        <span className="viewer-title">Faction viewer</span>
      </header>
      <div className={`viewer-body${desk ? " is-desk" : ""}`}>
        <aside className="viewer-rail" aria-label={`${faction.name} units`}>
          <a className={`viewer-overview${unit ? "" : " is-current"}`} href={hrefFor(faction.id, null)} aria-current={unit ? undefined : "page"} onClick={e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); select(null); }}>
            {marks[faction.id]}<span><b>{faction.name}</b><small>{faction.title}</small></span>
          </a>
          {groups.map(([category, label]) => {
            const list = project.filter(u => u.category === category);
            if (!list.length) return null;
            return <section key={category}><h2>{label}<small>{list.length}</small></h2><ul>
              {list.map(u => <li key={u.id}><a href={hrefFor(faction.id, u.id)} aria-current={u.id === selected ? "page" : undefined} onClick={link(u)}>
                {cameoOf(u) ? <img src={cameoOf(u)!} width={60} height={48} alt="" loading="lazy" decoding="async" /> : <i className="viewer-nocameo" />}
                <span><b>{u.name}</b><small>{u.role}</small></span></a></li>)}
            </ul></section>;
          })}
          {faction.original && <p className="viewer-rail-note">Westwood’s original art. {EA_NOTICE}</p>}
          {shared.length > 0 && <section className="viewer-shared"><h2>Shared units<small>{shared.length}</small></h2>
            <p>{faction.classicLabel} units the faction also builds, in Westwood’s original art. {EA_NOTICE}</p>
            <ul>{shared.map(u => { const cameo = original[u.id.toLowerCase()]?.spec.cameo; return <li key={u.id}><a href={hrefFor(faction.id, u.id)} aria-current={u.id === selected ? "page" : undefined} onClick={link(u)}>
              {cameo ? <img src={cameo} width={60} height={48} alt="" loading="lazy" decoding="async" /> : <i className="viewer-nocameo" />}
              <span><b>{u.name}</b><small>{groups.find(g => g[0] === u.category)?.[1] ?? u.category}</small></span></a></li>; })}</ul>
          </section>}
        </aside>

        <main className="viewer-main" id="viewer-main">
          {/* The stage stays mounted (hidden) while the overview or a text-only unit shows: its canvas and loaded art
              come back without a new compositor layer. */}
          {stageItem && (
            <div className="viewer-stage-slot" hidden={!(unit && item)}>
              <ViewerStage frames={frames} item={shown?.item ?? stageItem} color={color} onColor={pickColor} onAction={id => playAction(sounds, id)}
                weapons={unit && item && !shown ? unit.attack : NO_WEAPONS} dummies={faction.dummies} fire={desk ? fire : null}
                sounds={weaponId => {
                  const base = unit ? weaponSounds(unit, sounds, snapSounds, faction.effects, weaponId) : { report: [], impact: [] };
                  // The Sound desk auditions one weapon's fire or impact with the sound it is comparing.
                  return audition && desk && audition.weapon.toLowerCase() === weaponId.toLowerCase() ? { report: audition.report ?? base.report, impact: audition.impact ?? base.impact } : base;
                }}
                tag={shown ? <span className="viewer-historical"><b>{shown.label}</b><button type="button" onClick={() => setShown(null)}>Back to the game’s art</button></span> : undefined}>
                {unit && item && <div className="viewer-stage-name"><h1>{unit.name}</h1><span>{unit.role}</span></div>}
              </ViewerStage>
            </div>
          )}
          {unit && !item && (
            <div className="viewer-stock"><Swords size={34} aria-hidden="true" /><h1>{unit.name}</h1><p>An {faction.classicLabel} unit, in Westwood’s original art. Loading…</p></div>
          )}
          {!unit && (
            <div className="viewer-hero">
              <div className="viewer-hero-art">{lineup}</div>
              <div className="viewer-hero-copy"><span className="eyebrow">{faction.title}</span><h1>{faction.tagline}</h1>
                {identity?.motto && <blockquote className="viewer-motto">“{identity.motto}”</blockquote>}
                {identity && identity.keywords.length > 0 && <ul className="viewer-keywords" aria-label="In three words">{identity.keywords.map(k => <li key={k}>{k}</li>)}</ul>}
                <p>{faction.story}</p>
                <div className="viewer-hero-pick">{(faction.original ? units.filter(u => faction.unique.includes(u.id)) : project.slice(0, 12)).map(u => <a key={u.id} href={hrefFor(faction.id, u.id)} onClick={link(u)} title={u.name}>{cameoOf(u) ? <img src={cameoOf(u)!} width={60} height={48} alt={u.name} loading="lazy" decoding="async" /> : <span>{u.name}</span>}</a>)}</div>
              </div>
            </div>
          )}
        </main>

        <aside className={`viewer-info${desk ? " is-desk" : ""}`} aria-label={unit ? `${unit.name} details` : `${faction.name} doctrine`}>
          {desk ? <SoundDesk faction={artFactionId} factionName={faction.name} unit={unit ? { id: unit.id, name: unit.name, weapons: unit.attack.map(w => w.id), modern: Boolean(unit.art) } : null} onAudition={setAudition} onFire={fireWeapon} />
            : infoUnit ? <UnitInfo unit={infoUnit} sounds={infoUnit === unit ? infoSounds : shownSounds(infoUnit, snapSounds, faction.effects)} /> : faction.original ? <CountryInfo faction={faction} link={link} withSounds={Boolean(snapSounds)} /> : <FactionInfo faction={faction} />}
          {ADMIN_BUILD && !desk && infoUnit?.art && <ViewerAdmin key={infoUnit.id} unit={infoUnit} factionId={artFactionId} factionName={faction.name} frames={frames} onShow={setShown} />}
        </aside>
      </div>
    </div>
  );
}

const NO_WEAPONS: ViewerUnit["attack"] = [];
/** A clip the info panel lists: the project's own (with what it says) or one of Westwood's originals. */
type ShownClip = PublicClip & { original: boolean };
type ShownGroup = { id: string; label: string; kind: string; clips: ShownClip[] };

/**
 * Every sound the unit has, as the game plays it: the snapshot's lists (originals and the project's clips together,
 * in the game's order) when they are loaded, else the project's own published clips.
 */
function shownSounds(unit: ViewerUnit, snap: SnapshotSounds | null, effects: Record<string, PublicClip>): ShownGroup[] {
  const own = (g: ViewerUnit["sounds"][number]): ShownGroup => ({ ...g, clips: g.clips.map(c => ({ ...c, original: false })) });
  const lists = snap?.units[unit.id];
  if (!snap || !lists) return unit.sounds.map(own);
  const byFile = new Map([...Object.values(effects), ...unit.sounds.flatMap(g => g.clips)].flatMap(c => (c.file ? [[c.file, c] as const] : [])));
  const out: ShownGroup[] = lists.map(g => ({
    id: g.id, label: g.label, kind: g.kind,
    clips: [...new Map(g.clips.flatMap((ref): ShownClip[] => {
      if (isProjectClip(ref)) { const c = byFile.get(ref); return c ? [{ ...c, original: false }] : []; }
      const o = snap.clips[ref];
      return o ? [{ src: o.src, language: null, text: null, english: null, license: "Westwood", original: true }] : [];
    }).map(c => [c.src, c] as const)).values()],
  })).filter(g => g.clips.length);
  for (const g of unit.sounds) if (!out.some(x => x.id === g.id)) out.push(own(g));
  return out;
}
const groupSrcs = (groups: ShownGroup[], ...ids: string[]) => {
  for (const id of ids) { const g = groups.find(x => x.id === id); if (g?.clips.length) return g.clips.map(c => c.src); }
  return [];
};
/** A weapon's own report and impact (the snapshot knows each weapon's), else the unit's weapon sounds. */
function weaponSounds(unit: ViewerUnit, groups: ShownGroup[], snap: SnapshotSounds | null, effects: Record<string, PublicClip>, weaponId: string) {
  const w = snap?.weapons[unit.id]?.[weaponId.toLowerCase()];
  if (snap && w) {
    const byFile = new Map([...Object.values(effects), ...unit.sounds.flatMap(g => g.clips)].flatMap(c => (c.file ? [[c.file, c.src] as const] : [])));
    const resolve = (refs: string[]) => refs.flatMap(ref => { const src = isProjectClip(ref) ? byFile.get(ref) : snap.clips[ref]?.src; return src ? [src] : []; });
    const report = resolve(w.report), impact = resolve(w.impact);
    if (report.length || impact.length) return { report, impact };
  }
  return { report: groupSrcs(groups, "weapon:report"), impact: groupSrcs(groups, "weapon:impact") };
}
/** An action's sound: the attack order's acknowledgement, a weapon report when it fires, the death sound when it dies. */
function playAction(groups: ShownGroup[], action: string) {
  if (action === "attack-order") void soundEngine.playAny(groupSrcs(groups, "voice:Attack", "voice:Action"));
  else if (/^die/.test(action)) void soundEngine.playAny(groupSrcs(groups, "voice:Die", "death:explosion", "damage:destroyed"));
  else if (/^(attack|fire|shoot|prone-shoot)$/.test(action)) void soundEngine.playAny(groupSrcs(groups, "weapon:report"));
}

function ClipButton({ clip, n }: { clip: ShownClip; n: number }) {
  const [playing, setPlaying] = useState(false);
  const play = async () => { setPlaying(true); const s = await soundEngine.play(clip.src); window.setTimeout(() => setPlaying(false), (s ?? 0) * 1000); };
  const icon = playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />;
  // A line with words shows them; an effect or an original line is a small numbered play chip.
  if (!clip.text) return <button type="button" className="viewer-chip" data-playing={playing || undefined} onClick={play} aria-label={`Play sound ${n}`}>{icon}<span>{n}</span></button>;
  return <button type="button" className="viewer-clip" data-playing={playing || undefined} onClick={play} aria-label={`Play: ${clip.english ?? clip.text}`}>
    {icon}<span><b dir="auto" lang={clip.language ?? undefined}>{clip.text}</b>{clip.english && clip.english !== clip.text && <small>{clip.english}</small>}</span>
  </button>;
}

/** `value`, updated only after the frame that shows the change to everything else has painted. */
function useAfterPaint<T>(value: T): T {
  const [late, setLate] = useState(value);
  useEffect(() => {
    if (Object.is(late, value)) return;
    let timer = 0;
    const frame = requestAnimationFrame(() => { timer = window.setTimeout(() => setLate(value), 0); });
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [value, late]);
  return late;
}

function Stats({ unit }: { unit: ViewerUnit }) {
  return <dl className="viewer-stats">{unit.stats.map(s => <div key={s.id}><dt>{s.label}</dt><dd><i style={{ "--value": s.value } as CSSProperties} aria-hidden="true" /><span>{s.display}</span></dd></div>)}</dl>;
}

function UnitInfo({ unit, sounds }: { unit: ViewerUnit; sounds: ShownGroup[] }) {
  const licences = [...new Set(sounds.flatMap(g => g.clips.filter(c => !c.original).map(c => c.license.split(" ")[0])))];
  const originals = sounds.some(g => g.clips.some(c => c.original));
  return <>
    <header className="viewer-info-head"><span className="eyebrow">{unit.role || groups.find(g => g[0] === unit.category)?.[1]}</span><h2>{unit.name}</h2>
      {unit.cost != null && <span className="viewer-cost">${unit.cost.toLocaleString("en")}</span>}</header>
    {unit.description && <p className="viewer-lead">{unit.description}</p>}
    <Stats unit={unit} />
    {unit.attack.length > 0 ? <section className="viewer-block"><h3><Crosshair size={15} aria-hidden="true" />Weapons</h3><ul className="viewer-weapons">
      {/* What the unit fires (and a switchable mode), as the Attack demo plays it; elite variants are left out. */}
      {unit.attack.map(w => <li key={w.id}><b><EffectGlyph effect={w.effect} />{w.label}{w.mode && <em>{modeLabel(w.mode)}</em>}</b>
        <span>{[`${w.damage} damage`, w.burst > 1 ? `bursts of ${w.burst}` : null, `${Number.isInteger(w.range) ? w.range : w.range.toFixed(1)} cells`, `${(w.reloadTicks * 0.04).toFixed(1)}s reload`].filter(Boolean).join(" · ")}</span>
        <small>Hits {w.targets.filter(t => t !== "MicroDrone").join(", ").toLowerCase()}</small></li>)}
    </ul></section> : unit.weapons.length > 0 && <section className="viewer-block"><h3><Crosshair size={15} aria-hidden="true" />Weapons</h3><ul className="viewer-weapons">
      {unit.weapons.map((w, i) => <li key={i}><b>{w.projectile}</b><span>{[w.damage != null ? `${w.damage} damage` : null, w.range != null ? `${w.range} cells` : null, w.reloadSeconds != null ? `${w.reloadSeconds}s reload` : null].filter(Boolean).join(" · ")}</span>{w.targets.length > 0 && <small>Hits {w.targets.join(", ").toLowerCase()}</small>}</li>)}
    </ul></section>}
    {(unit.strengths || unit.counterplay) && <section className="viewer-block viewer-doctrine">
      {unit.strengths && <p><Footprints size={15} aria-hidden="true" /><span><b>Use it to</b>{unit.strengths}</span></p>}
      {unit.counterplay && <p><ShieldAlert size={15} aria-hidden="true" /><span><b>Watch for</b>{unit.counterplay}</span></p>}
    </section>}
    {sounds.length > 0 && <section className="viewer-block"><h3><Volume2 size={15} aria-hidden="true" />Voice and sound</h3>
      <ul className="viewer-sounds">{sounds.map(g => <li key={g.id} data-kind={g.kind}><small>{g.label}</small>
        <div className={g.clips.some(c => c.text) ? "viewer-lines" : "viewer-chips"}>{g.clips.map((c, i) => <ClipButton key={c.src} clip={c} n={i + 1} />)}</div></li>)}</ul>
      {licences.length > 0 && <p className="viewer-note">Synthetic voices and sounds made for this project ({licences.join(", ")}).</p>}
      {originals && <p className="viewer-note">Westwood’s original voices and sound effects. {EA_NOTICE}</p>}
    </section>}
    {unit.dossier && <a className="viewer-link" href={unit.dossier}>Read the full dossier →</a>}
  </>;
}

/** An original country: what only it builds, where the rest of its roster comes from, and EA's notice. */
function CountryInfo({ faction, link, withSounds }: { faction: ViewerFaction; link: (u: ViewerUnit) => (e: React.MouseEvent) => void; withSounds: boolean }) {
  const own = faction.units.filter(u => faction.unique.includes(u.id));
  const side = faction.side === "Allies" ? "Allied" : "Soviet";
  return <>
    <header className="viewer-info-head"><span className="eyebrow">{faction.side} · Original country</span><h2>{faction.name}</h2></header>
    <p className="viewer-lead">One of Red Alert 2’s nine countries, playable in the browser game alongside the modern factions. It builds the {side} roster{own.length ? ", plus its own:" : "."}</p>
    {own.length > 0 && <section className="viewer-block"><h3><Swords size={15} aria-hidden="true" />Only {faction.name}</h3><ul className="viewer-weapons">
      {own.map(u => <li key={u.id}><a href={hrefFor(faction.id, u.id)} onClick={link(u)}><b>{u.name}</b></a>{u.description && <span>{u.description}</span>}</li>)}
    </ul></section>}
    <p className="viewer-note">{faction.units.length} units and buildings, in Westwood’s original art{withSounds ? " and sound" : ""}. {EA_NOTICE}</p>
  </>;
}

function FactionInfo({ faction }: { faction: ViewerFaction }) {
  const n = faction.narrative;
  return <>
    <header className="viewer-info-head"><span className="eyebrow">{faction.side} · Doctrine</span><h2>{faction.title}</h2></header>
    <p className="viewer-lead">{faction.playstyle}</p>
    <section className="viewer-block viewer-doctrine">
      <p><Footprints size={15} aria-hidden="true" /><span><b>Strengths</b>{faction.strengths}</span></p>
      <p><ShieldAlert size={15} aria-hidden="true" /><span><b>Counterplay</b>{faction.counterplay}</span></p>
    </section>
    {n?.identity && n.identity.story.length > 0 && <section className="viewer-block viewer-voice" aria-labelledby="viewer-identity">
      <h3 id="viewer-identity"><Quote size={15} aria-hidden="true" />In their own words</h3>
      {n.identity.story.map((p, i) => <p key={i}>{p}</p>)}
    </section>}
    {n && n.rivalViews.length > 0 && <section className="viewer-block" aria-labelledby="viewer-rivals">
      <h3 id="viewer-rivals"><Eye size={15} aria-hidden="true" />Through their rivals’ eyes</h3>
      <ul className="viewer-rivals">{n.rivalViews.map(v => <li key={v.rival.id} style={{ "--rival-accent": v.rival.accent } as CSSProperties}>
        <a href={hrefFor(v.rival.id, null)}>{v.rival.flag && <img src={v.rival.flag} width={20} height={15} alt="" />}<b>{v.rival.name}</b>{v.kind && <small>{v.kind}</small>}</a>
        {v.text.map((p, i) => <blockquote key={i}><p>{p}</p></blockquote>)}
      </li>)}</ul>
      {n.framing && <p className="viewer-note">{n.framing}</p>}
    </section>}
    <section className="viewer-block" aria-labelledby="viewer-campaigns"><h3 id="viewer-campaigns"><BookOpen size={15} aria-hidden="true" />Campaigns</h3>
      {faction.campaigns.length ? faction.campaigns.map(c => <Campaign key={c.id} c={c} />) : <p className="viewer-empty">{`No campaign is written for ${faction.name} yet.`}</p>}
      {faction.otherCampaigns.length > 0 && <>
        <h4>{faction.campaigns.length ? "More campaigns" : "Campaigns in RTS AI"}</h4>
        {faction.otherCampaigns.map(c => <Campaign key={c.id} c={c} other />)}
      </>}
    </section>
  </>;
}

function Campaign({ c, other = false }: { c: ViewerCampaign; other?: boolean }) {
  return <details className="viewer-campaign" open={!other}>
    <summary><b>{c.title}</b><small>{other ? `Played as ${c.playedAs} · ` : ""}{c.missions.length} chapters</small></summary>
    <p>{c.synopsis}</p>
    <ol>{c.missions.map(m => <li key={m.id}><b>{m.title}</b><small>{m.location}</small></li>)}</ol>
    {c.characters.length > 0 && <p className="viewer-cast"><Users size={14} aria-hidden="true" />{c.characters.map(p => p.name).join(", ")}</p>}
  </details>;
}
