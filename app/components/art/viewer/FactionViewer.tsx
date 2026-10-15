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
import { useHangarAudio } from "./useHangarAudio";
import { HANGAR_AUDIO_EVENTS, type HangarAudioPreview } from "../../../../lib/hangar-audio";

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
  const hangar = useHangarAudio(unit?.id ?? null, faction.id);
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
  const sounds = useMemo(() => (unit ? withHangarPreview(shownSounds(unit, snapSounds, faction.effects), hangar.preview) : []), [unit, snapSounds, faction.effects, hangar.preview]);
  const infoSounds = useAfterPaint(sounds);
  // The last unit with art stays on the (hidden) stage while the overview or a text-only unit is shown.
  const [stageItem, setStageItem] = useState<StageItem | null>(item);
  if (item && item !== stageItem) setStageItem(item);

  // Selection is client-side (the stage keeps its loaded art); the address follows it, and Back works.
  const select = useCallback((id: string | null) => {
    setSelected(id); setShown(null);
    // Picking a unit plays one of its select lines, as in game (after a click, never on page load).
    const picked = id ? units.find(u => u.id === id) : null;
    if (picked) void soundEngine.playAny(groupSrcs(withHangarPreview(shownSounds(picked, snapSounds, faction.effects), picked.id === hangar.preview?.actor ? hangar.preview : null), "voice:Select"));
    const href = hrefFor(faction.id, id);
    if (window.location.pathname !== href) window.history.pushState({ unit: id }, "", href);
    window.scrollTo({ top: 0 });
  }, [faction.id, faction.effects, units, snapSounds, hangar.preview]);
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
    <div className={`viewer${hangar.savedPreview || hangar.error ? " has-hangar-preview" : ""}`} style={{ "--faction-accent": faction.accent } as CSSProperties}>
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
        {hangar.local && unit?.id === "r2m1a2s" && <a className="viewer-chip" href={`http://127.0.0.1:${hangar.port}/#lab-audio`} target="_blank" rel="noreferrer">Edit audio in Hangar</a>}
      </header>
      {(hangar.savedPreview || hangar.error) && <div className="viewer-hangar-preview" role="status">
        <span>{hangar.error || `Hangar local preview · ${hangar.savedPreview!.name} · ${hangar.enabled ? "Candidate" : "Current game sounds"}`}</span>
        {hangar.savedPreview && <button type="button" onClick={() => { soundEngine.stopAll(); hangar.setEnabled(!hangar.enabled); }}>{hangar.enabled ? "Hear current game" : "Hear candidate"}</button>}
        {hangar.preview?.event === "engine" && <><span>Engine: manual audition; movement binding is not simulated.</span><button type="button" onClick={() => void soundEngine.play(hangar.preview!.url)}>Audition engine</button></>}
        <button type="button" onClick={() => { soundEngine.stopAll(); hangar.clear(); }}>Clear preview</button>
      </div>}
      <div className={`viewer-body${desk ? " is-desk" : ""}`}>
