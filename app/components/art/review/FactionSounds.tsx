"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Languages, Megaphone, Music, Square, Users, X } from "lucide-react";
import type { SoundClip, SoundGroupPayload } from "../../../../lib/art-lab/sounds-server";
import { ClipRow } from "./SoundsPanel";
import { soundEngine } from "./sound";
import { VoiceReview } from "./VoiceReview";

type FactionSoundsData = {
  faction: string;
  speech: { notification: string; files: SoundClip[] }[];
  voiceSets: { voiceSet: string; actors: string[]; groups: SoundGroupPayload[] }[];
  music: { id: string; title: string; file: SoundClip }[];
};
export type SoundFaction = { id: string; name: string; units: { id: string; name: string }[]; modern: boolean };
const API = "/api/art-review";
const words = (n: string) => n.replace(/([a-z])([A-Z])/g, "$1 $2");

/**
 * A faction's sound: its announcer (EVA) line for every notification, its voice sets by the units that use them,
 * and the music the mod lists. Original factions are here for comparison; their audio is read from the player's own
 * RA2 files on this machine only. The native-speaker review of the modern factions' lines opens from here too.
 */
export function FactionSounds({ factions, initial, onClose }: { factions: SoundFaction[]; initial: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [faction, setFaction] = useState(initial);
  const [tab, setTab] = useState<"speech" | "voices" | "music" | "review">("speech");
  const [data, setData] = useState<Record<string, FactionSoundsData | "error">>({});
  const [query, setQuery] = useState("");
  useEffect(() => { dialog.current?.showModal(); return () => soundEngine.stopAll(); }, []);
  const current = factions.find(f => f.id === faction) ?? factions[0];
  useEffect(() => {
    if (!current || data[current.id]) return;
    let live = true;
    const actors = current.units.map(u => u.id).join(",");
    fetch(`${API}/sounds/faction?mode=ra2&faction=${encodeURIComponent(current.id)}&actors=${encodeURIComponent(actors)}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() as Promise<FactionSoundsData> : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => { if (live) setData(m => ({ ...m, [current.id]: d })); }, () => { if (live) setData(m => ({ ...m, [current.id]: "error" })); });
    return () => { live = false; };
  }, [current, data]);
  const d = current ? data[current.id] : undefined;
  const loaded = d && d !== "error" ? d : null;
  const names = useMemo(() => new Map((current?.units ?? []).map(u => [u.id, u.name])), [current]);
  const speech = useMemo(() => (loaded?.speech ?? []).filter(s => !query || `${s.notification} ${s.files.map(f => f.line?.text ?? "").join(" ")}`.toLowerCase().includes(query.toLowerCase())), [loaded, query]);
  return (
    <dialog ref={dialog} className="studio-source-dialog sounds-dialog" aria-labelledby="faction-sounds-title" onCancel={onClose} onClose={onClose}>
      <header>
        <div><span className="lab-label">SOUNDS</span><h2 id="faction-sounds-title">{current?.name ?? faction}: how the faction sounds</h2></div>
        <button type="button" className="lab-ghost" onClick={() => soundEngine.stopAll()} title="Stop every sound"><Square size={14} aria-hidden="true" />Stop</button>
        <button type="button" className="lab-ghost" aria-label="Close sounds" onClick={onClose}><X size={19} /></button>
      </header>
      <div className="sounds-factions" role="group" aria-label="Faction">
        {factions.map(f => <button key={f.id} type="button" aria-pressed={f.id === current?.id} onClick={() => setFaction(f.id)} className={f.modern ? undefined : "is-original"}>{f.name}</button>)}
      </div>
      <nav className="sounds-tabs" aria-label="Sound kind">
        <button type="button" aria-pressed={tab === "speech"} onClick={() => setTab("speech")}><Megaphone size={14} aria-hidden="true" />Announcer</button>
        <button type="button" aria-pressed={tab === "voices"} onClick={() => setTab("voices")}><Users size={14} aria-hidden="true" />Unit voices</button>
        <button type="button" aria-pressed={tab === "music"} onClick={() => setTab("music")}><Music size={14} aria-hidden="true" />Music</button>
        <button type="button" aria-pressed={tab === "review"} onClick={() => setTab("review")}><Languages size={14} aria-hidden="true" />Native-speaker review</button>
      </nav>
      {tab === "review" ? <VoiceReview /> : d === "error" ? <p className="lab-hint">Could not read this faction’s sounds from the mod’s rules.</p> : !loaded ? <p className="lab-hint">Reading the rules…</p> : (
        <div className="sounds-dialog-body">
          {tab === "speech" && <>
            <label className="enc-search"><input type="search" aria-label="Find a notification" placeholder="Find a notification or line…" value={query} onChange={e => setQuery(e.target.value)} /></label>
            <p className="lab-hint">{speech.length} of {loaded.speech.length} notifications · {current?.modern ? "the faction’s own announcer" : "original RA2 announcer, from your local game files"}</p>
            <ul className="sounds-list">{speech.map(s => <li key={s.notification}><h4>{words(s.notification)}</h4><ul>{s.files.map(f => <ClipRow key={f.file} clip={f} />)}</ul></li>)}</ul>
          </>}
          {tab === "voices" && <div className="sounds-list">{loaded.voiceSets.map(v => (
            <section key={v.voiceSet} className="sounds-set">
              <h3>{v.voiceSet}<small>{v.actors.map(a => names.get(a) ?? a).join(" · ")}</small></h3>
              <div className="sounds-groups">{v.groups.filter(g => g.played || g.kind === "voice").map(g => <section key={g.id} className="sounds-group"><h4>{g.label}</h4><ul>{g.files.map(f => <ClipRow key={f.file} clip={f} />)}</ul></section>)}</div>
            </section>))}
            {!loaded.voiceSets.length && <p className="lab-hint">No unit of this faction has a voice set.</p>}
          </div>}
          {tab === "music" && <>
            <p className="lab-hint">The mod lists {loaded.music.length} tracks; none is a faction theme. All are the original RA2 score, read from your local game files.</p>
            <ul className="sounds-list">{loaded.music.map(t => <li key={t.id}><h4>{t.title}</h4><ul><ClipRow clip={t.file} /></ul></li>)}</ul>
          </>}
        </div>
      )}
    </dialog>
  );
}
