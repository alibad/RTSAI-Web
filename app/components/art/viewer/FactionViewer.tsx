"use client";
/* Cameos are 60x48 pixel art, drawn at whole scales; next/image would resample them. */
/* eslint-disable @next/next/no-img-element */

import { ArrowLeft, BookOpen, Crosshair, Eye, Footprints, Pause, Play, Quote, ShieldAlert, Swords, Users, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ADMIN_BUILD } from "../../../../lib/admin";
import type { ViewerCampaign, ViewerFaction, ViewerFactionLink, ViewerUnit } from "../../../../lib/viewer";
import { FrameStore, type StageItem } from "../review/frames";
import { ViewerStage } from "./ViewerStage";
import { ViewerAdmin, type ShownVersion } from "./ViewerAdmin";
import { soundEngine } from "../review/sound";
import { SoundControls } from "../review/SoundControls";
import type { PublicClip } from "../../../../lib/faction-audio";
import { EA_NOTICE, useOriginalArt } from "../../../../lib/original-art";
import "./viewer.css";

const groups: [string, string][] = [["infantry", "Infantry"], ["vehicle", "Vehicles"], ["aircraft", "Aircraft"], ["ship", "Naval"], ["defense", "Defenses"], ["structure", "Buildings"]];
const COLOR_KEY = "rtsai-viewer-color";

const hrefFor = (faction: string, unit: string | null) => (unit ? `/viewer/${faction}/${unit}` : `/viewer/${faction}`);

/**
 * The public Faction viewer: a faction's units as the game draws them (turn them, play their actions), their stats
 * and doctrine, and the faction's campaigns. Read-only and player-facing: no candidates, checks, decisions or
 * provenance. Shared original units are drawn with Westwood's art from the Faction Studio's published snapshot (with
 * EA's notice). The admin build adds a tucked-away History per unit.
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
  // The last unit with art stays on the (hidden) stage while the overview or a text-only unit is shown.
  const [stageItem, setStageItem] = useState<StageItem | null>(item);
  if (item && item !== stageItem) setStageItem(item);

  // Selection is client-side (the stage keeps its loaded art); the address follows it, and Back works.
  const select = useCallback((id: string | null) => {
    setSelected(id); setShown(null);
    // Picking a unit plays one of its select lines, as in game (after a click, never on page load).
    const picked = id ? units.find(u => u.id === id) : null;
    if (picked) void soundEngine.playAny(groupSrcs(picked, "voice:Select"));
    const href = hrefFor(faction.id, id);
    if (window.location.pathname !== href) window.history.pushState({ unit: id }, "", href);
    window.scrollTo({ top: 0 });
  }, [faction.id, units]);
  useEffect(() => {
    const onPop = () => { const m = /^\/viewer\/[^/]+\/([^/?#]+)/.exec(window.location.pathname); setSelected(m ? decodeURIComponent(m[1]) : null); setShown(null); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => { document.title = `${unit ? `${unit.name} · ` : ""}${faction.name} · Faction viewer | RTS AI`; }, [unit, faction.name]);

  const project = units.filter(u => u.art), shared = units.filter(u => !u.art);
  const identity = faction.narrative?.identity ?? null;
  const link = (u: ViewerUnit) => (e: React.MouseEvent) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); select(u.id); };

  return (
    <div className="viewer" style={{ "--faction-accent": faction.accent } as CSSProperties}>
      <header className="viewer-top">
        <a className="viewer-back" href={`/factions/${faction.id}?mode=ra2`}><ArrowLeft size={15} aria-hidden="true" />{faction.name}</a>
        <nav className="viewer-factions" aria-label="Factions">
          {factions.map(f => <a key={f.id} href={hrefFor(f.id, null)} aria-current={f.id === faction.id ? "page" : undefined} title={f.name}>{marks[f.id]}<span>{f.name}</span></a>)}
        </nav>
        <SoundControls />
        <span className="viewer-title">Faction viewer</span>
      </header>
      <div className="viewer-body">
        <aside className="viewer-rail" aria-label={`${faction.name} units`}>
          <a className={`viewer-overview${unit ? "" : " is-current"}`} href={hrefFor(faction.id, null)} aria-current={unit ? undefined : "page"} onClick={e => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); select(null); }}>
            {marks[faction.id]}<span><b>{faction.name}</b><small>{faction.title}</small></span>
          </a>
          {groups.map(([category, label]) => {
            const list = project.filter(u => u.category === category);
            if (!list.length) return null;
            return <section key={category}><h2>{label}<small>{list.length}</small></h2><ul>
              {list.map(u => <li key={u.id}><a href={hrefFor(faction.id, u.id)} aria-current={u.id === selected ? "page" : undefined} onClick={link(u)}>
                {u.cameo ? <img src={u.cameo} width={60} height={48} alt="" loading="lazy" decoding="async" /> : <i className="viewer-nocameo" />}
                <span><b>{u.name}</b><small>{u.role}</small></span></a></li>)}
            </ul></section>;
          })}
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
              <ViewerStage frames={frames} item={shown?.item ?? stageItem} color={color} onColor={pickColor} onAction={id => { if (unit) playAction(unit, id); }}
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
                <div className="viewer-hero-pick">{project.slice(0, 12).map(u => <a key={u.id} href={hrefFor(faction.id, u.id)} onClick={link(u)} title={u.name}>{u.cameo && <img src={u.cameo} width={60} height={48} alt={u.name} loading="lazy" decoding="async" />}</a>)}</div>
              </div>
            </div>
          )}
        </main>

        <aside className="viewer-info" aria-label={unit ? `${unit.name} details` : `${faction.name} doctrine`}>
          {infoUnit ? <UnitInfo unit={infoUnit} classicLabel={faction.classicLabel} /> : <FactionInfo faction={faction} />}
          {ADMIN_BUILD && infoUnit?.art && <ViewerAdmin key={infoUnit.id} unit={infoUnit} factionId={artFactionId} factionName={faction.name} frames={frames} onShow={setShown} />}
        </aside>
      </div>
    </div>
  );
}

const groupSrcs = (unit: ViewerUnit, ...ids: string[]) => {
  for (const id of ids) { const g = unit.sounds.find(x => x.id === id); if (g?.clips.length) return g.clips.map(c => c.src); }
  return [];
};
/** An action's sound: a weapon report when it fires, the death sound when it dies (the project's own clips only). */
function playAction(unit: ViewerUnit, action: string) {
  if (/^die/.test(action)) void soundEngine.playAny(groupSrcs(unit, "voice:Die", "death:explosion", "damage:destroyed"));
  else if (/^(attack|fire|shoot|prone-shoot)$/.test(action)) void soundEngine.playAny(groupSrcs(unit, "weapon:report"));
}

function ClipButton({ clip }: { clip: PublicClip }) {
  const [playing, setPlaying] = useState(false);
  const play = async () => { setPlaying(true); const s = await soundEngine.play(clip.src); window.setTimeout(() => setPlaying(false), (s ?? 0) * 1000); };
  return <button type="button" className="viewer-clip" onClick={play} aria-label={`Play${clip.text ? `: ${clip.english ?? clip.text}` : " sound"}`}>
    {playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
    {clip.text ? <span><b dir="auto" lang={clip.language ?? undefined}>{clip.text}</b>{clip.english && clip.english !== clip.text && <small>{clip.english}</small>}</span> : <span><b>Play</b></span>}
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

function UnitInfo({ unit, classicLabel }: { unit: ViewerUnit; classicLabel: string }) {
  return <>
    <header className="viewer-info-head"><span className="eyebrow">{unit.role || groups.find(g => g[0] === unit.category)?.[1]}</span><h2>{unit.name}</h2>
      {unit.cost != null && <span className="viewer-cost">${unit.cost.toLocaleString("en")}</span>}</header>
    {unit.description && <p className="viewer-lead">{unit.description}</p>}
    <Stats unit={unit} />
    {unit.weapons.length > 0 && <section className="viewer-block"><h3><Crosshair size={15} aria-hidden="true" />Weapons</h3><ul className="viewer-weapons">
      {unit.weapons.map((w, i) => <li key={i}><b>{w.projectile}</b><span>{[w.damage != null ? `${w.damage} damage` : null, w.range != null ? `${w.range} cells` : null, w.reloadSeconds != null ? `${w.reloadSeconds}s reload` : null].filter(Boolean).join(" · ")}</span>{w.targets.length > 0 && <small>Hits {w.targets.join(", ").toLowerCase()}</small>}</li>)}
    </ul></section>}
    {(unit.strengths || unit.counterplay) && <section className="viewer-block viewer-doctrine">
      {unit.strengths && <p><Footprints size={15} aria-hidden="true" /><span><b>Use it to</b>{unit.strengths}</span></p>}
      {unit.counterplay && <p><ShieldAlert size={15} aria-hidden="true" /><span><b>Watch for</b>{unit.counterplay}</span></p>}
    </section>}
    {unit.sounds.length > 0 && <section className="viewer-block"><h3><Volume2 size={15} aria-hidden="true" />Voice and sound</h3>
      <ul className="viewer-sounds">{unit.sounds.filter(g => g.kind === "voice").slice(0, 4).map(g => <li key={g.id}><small>{g.label}</small>{g.clips.map(c => <ClipButton key={c.src} clip={c} />)}</li>)}
        {unit.sounds.filter(g => g.kind !== "voice").map(g => <li key={g.id}><small>{g.label}</small>{g.clips.map(c => <ClipButton key={c.src} clip={c} />)}</li>)}</ul>
      <p className="viewer-note">Synthetic voices and sounds made for this project ({[...new Set(unit.sounds.flatMap(g => g.clips.map(c => c.license.split(" ")[0])))].join(", ")}). {classicLabel} sounds are not published.</p>
    </section>}
    {unit.dossier && <a className="viewer-link" href={unit.dossier}>Read the full dossier →</a>}
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
