"use client";
/* Cameos are 60x48 pixel art, drawn at whole scales; next/image would resample them. */
/* eslint-disable @next/next/no-img-element */
/**
 * The Sound desk (admin builds and dev only): audition, choose and replace any modern unit's or faction's sounds in
 * place. A/B the current sound against a candidate (weapon slots fire it in the stage's Attack demo), pick from the
 * bake-off, the mod's own sounds or the CC0 library, say a line again with the faction's own voice, and decide with
 * U (use), N (keep current) and R (reject), as in the Studio. Decisions go to RTSAI-Art/sound-review.json over the
 * dev-only /api/sound-review; RTSAI-Mod's tools/apply-sound-decisions.py applies them to the mod on a branch.
 * Public builds replace this module with empty stubs (vite.config.ts), so none of it reaches rtsai.net.
 */
import { AudioLines, Check, ChevronRight, Copy, Crosshair, Flame, Layers, ListChecks, Loader2, Mic, Pause, Play, Scissors, Search, SlidersHorizontal, Undo2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { licenceShort, slotStatus, type DeathSize, type SlotFacts, type SoundReviewFile, type SoundSlotEntry } from "../../../../lib/sound-desk/model";
import type { DeskSlot } from "../../../../lib/sound-desk/slots";
import { soundEngine } from "../review/sound";
import { isFieldKey } from "../review/keys";
import "./sound-desk.css";

const API = "/api/sound-review";
const MODERN = ["china", "iran", "turkey", "saudi", "yemen", "israel", "hezbollah"];
const FACTION_NAMES: Record<string, string> = { china: "China", iran: "Iran", turkey: "Türkiye", saudi: "Saudi Arabia", yemen: "Yemen", israel: "Israel", hezbollah: "Hezbollah" };

/** What the stage's Attack demo plays for one weapon while the desk auditions it. */
export type Audition = { weapon: string; report?: string[]; impact?: string[] };
type Trim = { start: number; end: number };
type Candidate = { id: string; source: string; title: string; sub: string; tags: string[]; licence: string; verdict: string; text?: string | null; language?: string | null; faction?: string | null; seconds?: number | null; prompt?: string | null; slot?: string };
type Library = { bakeoff: Candidate[]; project: Candidate[]; cc0: Candidate[] };
type State = { file: SoundReviewFile; pending: number; art: string; mod: string; exists: boolean; gpu: { claim: string | null } };

// ------------------------------------------------------------------------------------------------ API
async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API}/${path}`, { cache: "no-store" });
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `${r.status}`);
  return r.json() as Promise<T>;
}
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => null) as T & { error?: string } | null;
  if (!r.ok || !j) throw new Error(j?.error ?? `${r.status}`);
  return j;
}
export const audioUrl = (id: string, trim?: Trim | null) => `${API}/audio?c=${encodeURIComponent(id)}${trim ? `&t0=${trim.start}&t1=${trim.end}` : ""}`;

/** One shared store per page: the decision file, the library and the regenerated takes. */
class DeskStore {
  state: State | null = null;
  library: Library | null = null;
  takes: Candidate[] = [];
  error: string | null = null;
  private subs = new Set<() => void>();
  private loading: Promise<void> | null = null;
  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  private emit() { this.version++; for (const f of [...this.subs]) f(); }
  version = 0;
  getVersion = () => this.version;
  load() {
    this.loading ??= Promise.all([get<State>("state"), get<Library>("library"), get<{ takes: Candidate[] }>("takes")])
      .then(([s, l, t]) => { this.state = s; this.library = l; this.takes = t.takes; this.error = null; this.emit(); })
      .catch(e => { this.error = e instanceof Error ? e.message : String(e); this.loading = null; this.emit(); });
    return this.loading;
  }
  async refreshTakes() { this.takes = (await get<{ takes: Candidate[] }>("takes")).takes; this.emit(); }
  async act(action: Record<string, unknown>) {
    const r = await post<{ file: SoundReviewFile; pending: number }>("action", action);
    if (this.state) this.state = { ...this.state, file: r.file, pending: r.pending };
    this.emit();
  }
  find(id: string): Candidate | null {
    const l = this.library;
    if (!l) return null;
    return l.bakeoff.find(c => c.id === id) ?? l.project.find(c => c.id === id) ?? l.cc0.find(c => c.id === id) ?? this.takes.find(c => c.id === id) ?? null;
  }
}
const store = new DeskStore();
function useStore() { useSyncExternalStore(store.subscribe, store.getVersion, () => 0); useEffect(() => { void store.load(); }, []); return store; }

// ------------------------------------------------------------------------------------------------ playback
type Now = { key: string; seconds: number; n: number } | null;
let now: Now = null;
const nowSubs = new Set<() => void>();
const setNow = (v: Now) => { now = v; for (const f of [...nowSubs]) f(); };
const useNow = () => useSyncExternalStore(f => { nowSubs.add(f); return () => { nowSubs.delete(f); }; }, () => now, () => null);
/** Plays one sound at a time (A/B listening): a new one stops the last. */
async function playKey(key: string, url: string) {
  if (now?.key === key) { soundEngine.stopAll(); setNow(null); return; }
  soundEngine.stopAll();
  const n = performance.now();
  setNow({ key, seconds: 0, n });
  const seconds = await soundEngine.play(url);
  if (now?.n !== n) return;
  if (seconds === null) { setNow(null); return; }
  setNow({ key, seconds, n });
  window.setTimeout(() => { if (now?.n === n) setNow(null); }, seconds * 1000 + 60);
}

// ------------------------------------------------------------------------------------------------ waveforms
type Peaks = { seconds: number; peaks: number[] };
const peakCache = new Map<string, Promise<Peaks | null>>();
let inFlight = 0;
const waiting: (() => void)[] = [];
function loadPeaks(id: string, trim?: Trim | null): Promise<Peaks | null> {
  const key = `${id}|${trim?.start ?? ""}|${trim?.end ?? ""}`;
  let p = peakCache.get(key);
  if (!p) {
    p = (async () => {
      if (inFlight >= 4) await new Promise<void>(r => waiting.push(r));
      inFlight++;
      try { return await get<Peaks>(`peaks?c=${encodeURIComponent(id)}${trim ? `&t0=${trim.start}&t1=${trim.end}` : ""}`); }
      catch { return null; }
      finally { inFlight--; waiting.shift()?.(); }
    })();
    peakCache.set(key, p);
  }
  return p;
}
function usePeaks(id: string | null, visible = true) {
  const [peaks, setPeaks] = useState<{ id: string; value: Peaks | null } | null>(null);
  useEffect(() => {
    if (!id || !visible) return;
    let live = true;
    void loadPeaks(id).then(value => { if (live) setPeaks({ id, value }); });
    return () => { live = false; };
  }, [id, visible]);
  return peaks?.id === id ? peaks.value : null;
}
/** Renders once its row scrolls into view (the library lists hundreds of sounds). */
function useVisible<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } }, { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return [ref, visible] as const;
}

/**
 * A sound as its waveform: click plays it (again to stop), the playhead runs while it plays. `onTrim` lets a drag
 * across it keep only that part (long CC0 recordings).
 */
function Wave({ id, playKey: key, label, size = "md", trim, onTrim, tone }: { id: string | null; playKey?: string; label: string; size?: "sm" | "md" | "lg"; trim?: Trim | null; onTrim?: (t: Trim | null) => void; tone?: "a" | "b" }) {
  const [ref, visible] = useVisible<HTMLButtonElement>();
  const peaks = usePeaks(id, visible);
  const playing = useNow();
  const k = key ?? id ?? "";
  const on = playing?.key === k;
  const bars = size === "sm" ? 24 : size === "md" ? 48 : 64;
  const values = useMemo(() => {
    if (!peaks) return [];
    const src = peaks.peaks, out: number[] = [];
    for (let i = 0; i < bars; i++) { const a = Math.floor((i * src.length) / bars), b = Math.max(a + 1, Math.floor(((i + 1) * src.length) / bars)); out.push(Math.max(...src.slice(a, b))); }
    return out;
  }, [peaks, bars]);
  const drag = useRef<{ x0: number; moved: boolean } | null>(null);
  /** A drag that trimmed the sound is not also a click that plays it. */
  const dragged = useRef(false);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const frac = (e: React.PointerEvent) => { const r = e.currentTarget.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const seconds = peaks?.seconds ?? 0;
  const play = () => { if (id) void playKey(k, audioUrl(id, trim)); };
  const region = trim && seconds ? { left: `${(trim.start / seconds) * 100}%`, width: `${((trim.end - trim.start) / seconds) * 100}%` } : sel ? { left: `${Math.min(sel.a, sel.b) * 100}%`, width: `${Math.abs(sel.b - sel.a) * 100}%` } : null;
  return (
    <button ref={ref} type="button" className={`sd-wave is-${size}${tone ? ` is-${tone}` : ""}`} data-playing={on || undefined} disabled={!id} aria-label={`${on ? "Stop" : "Play"} ${label}`} title={onTrim ? `${label} · drag across it to keep only a part` : label}
      onClick={() => { if (dragged.current) { dragged.current = false; return; } play(); }}
      onPointerDown={e => { if (!onTrim || !seconds) return; drag.current = { x0: frac(e), moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { const d = drag.current; if (!d) return; const x = frac(e); if (Math.abs(x - d.x0) > 0.02) { d.moved = true; setSel({ a: d.x0, b: x }); } }}
      onPointerUp={e => {
        const d = drag.current; drag.current = null;
        if (!d?.moved || !onTrim || !seconds) return;
        const x = frac(e), a = Math.min(d.x0, x) * seconds, b = Math.max(d.x0, x) * seconds;
        dragged.current = true; setSel(null);
        onTrim({ start: Math.round(a * 1000) / 1000, end: Math.round(b * 1000) / 1000 });
      }}>
      <span className="sd-wave-icon">{on ? <Pause size={size === "sm" ? 11 : 14} aria-hidden="true" /> : <Play size={size === "sm" ? 11 : 14} aria-hidden="true" />}</span>
      <span className="sd-wave-bars" aria-hidden="true">
        {values.length ? values.map((v, i) => <i key={i} style={{ "--h": Math.max(0.06, v) } as CSSProperties} />) : <em />}
        {region && <b className="sd-wave-trim" style={region} />}
        {on && playing && playing.seconds > 0 && <span key={playing.n} className="sd-wave-head" style={{ animationDuration: `${playing.seconds}s` }} />}
      </span>
      {size !== "sm" && seconds > 0 && <small className="sd-wave-len">{(trim ? trim.end - trim.start : seconds).toFixed(seconds < 10 ? 2 : 1)}s</small>}
    </button>
  );
}

// ------------------------------------------------------------------------------------------------ library
const CHIPS: [string, string][] = [["all", "All"], ["gun", "Guns"], ["missile", "Missiles"], ["explosion", "Explosions"], ["impact", "Impacts"], ["engine", "Engines"], ["energy", "Energy"], ["creature", "Creatures"], ["voice", "Voices"], ["announcer", "Announcer"]];
/** The library's first filter for a slot: explosions for deaths, guns or missiles for a weapon by what it fires now. */
function chipFor(kind: string, hint = "") {
  if (kind === "death") return "explosion";
  if (kind === "impact") return "impact";
  if (kind === "voice") return "voice";
  if (kind === "announcer") return "announcer";
  if (kind === "fire") return /missile|rocket|launch|anti-air| aa|sam|vintat|vapoat|irocat|salvo|atgm|rpg/i.test(hint) ? "missile" : /gun|coax|rifle|mg|cannon|igiat|vgriat|minigun|ciws|burst/i.test(hint) ? "gun" : "all";
  if (kind === "movement") return "engine";
  return "all";
}
type Tab = "bakeoff" | "project" | "cc0" | "takes" | "say";

function LibraryPanel({ slot, picked, onPick, rejected, sayIt, hint = "" }: { slot: { kind: string; id: string; faction: string | null }; picked: string | null; onPick: (c: Candidate) => void; rejected: string[]; sayIt?: ReactNode; hint?: string }) {
  const s = useStore();
  const speech = slot.kind === "voice" || slot.kind === "announcer";
  const [tab, setTab] = useState<Tab>(speech && sayIt ? "say" : "bakeoff");
  const [chip, setChip] = useState(() => chipFor(slot.kind, hint));
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(60);
  const lib = s.library;
  const list = useMemo(() => {
    if (!lib) return [];
    const base = tab === "takes" ? s.takes.filter(t => t.slot === slot.id) : tab === "say" ? [] : lib[tab];
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return base.filter(c => (chip === "all" || c.tags.includes(chip)) && words.every(w => `${c.title} ${c.sub} ${c.text ?? ""} ${c.prompt ?? ""}`.toLowerCase().includes(w)));
  }, [lib, tab, chip, q, s.takes, slot.id]);
  if (!lib) return <div className="sd-lib is-loading"><Loader2 className="sd-spin" size={16} aria-hidden="true" /></div>;
  const tabs: [Tab, string, number | null][] = [["bakeoff", "Bake-off", lib.bakeoff.length], ["project", "In the mod", lib.project.length], ["cc0", "CC0", lib.cc0.length], ["takes", "Takes", s.takes.filter(t => t.slot === slot.id).length || null], ...(sayIt ? [["say", "Say it", null] as [Tab, string, null]] : [])];
  return (
    <div className="sd-lib">
      <div className="sd-tabs" role="tablist">{tabs.map(([id, label, n]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setLimit(60); }}>{id === "say" && <Mic size={12} aria-hidden="true" />}{label}{n ? <small>{n}</small> : null}</button>)}</div>
      {tab === "say" ? sayIt : <>
        <div className="sd-find">
          <label className="sd-search"><Search size={13} aria-hidden="true" /><input value={q} onChange={e => { setQ(e.target.value); setLimit(60); }} placeholder="Search" aria-label="Search sounds" /></label>
          <div className="sd-chips">{CHIPS.map(([id, label]) => <button key={id} type="button" aria-pressed={chip === id} onClick={() => { setChip(id); setLimit(60); }}>{label}</button>)}</div>
        </div>
        <ul className="sd-results">
          {list.slice(0, limit).map(c => <li key={c.id} className={`${picked === c.id ? "is-picked" : ""}${rejected.includes(c.id) ? " is-rejected" : ""}`}>
            <Wave id={c.id} label={c.title} size="sm" />
            <button type="button" className="sd-result" onClick={() => onPick(c)} title={c.prompt ?? c.sub}>
              <b dir="auto">{c.title}</b><small>{c.sub}</small>
            </button>
            <span className={`sd-lic is-${c.verdict}`} title={c.licence}>{licenceShort(c.licence)}</span>
          </li>)}
          {!list.length && <li className="sd-empty">Nothing here{q ? ` for “${q}”` : ""}.</li>}
        </ul>
        {list.length > limit && <button type="button" className="sd-more" onClick={() => setLimit(l => l + 120)}>{list.length - limit} more</button>}
      </>}
    </div>
  );
}

/** Say a line again with the faction's own voice: the announcer chain, or the line's own generator. */
function SayIt({ slot, onTakes }: { slot: DeskSlot; onTakes: (ids: { faction: string; slot: string; id: string }[]) => void }) {
  const s = useStore();
  const [text, setText] = useState(slot.line?.text ?? "");
  const [all, setAll] = useState(false);
  const [engine, setEngine] = useState<"asis" | "chatterbox">("asis");
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { if (busy === null) return; const t = window.setInterval(() => setElapsed(Math.round((Date.now() - busy) / 1000)), 1000); return () => window.clearInterval(t); }, [busy]);
  const eva = slot.regen === "eva";
  const english = !slot.line?.language || slot.line.language.startsWith("en");
  const say = async () => {
    setBusy(Date.now()); setElapsed(0); setError(null);
    try {
      const r = await post<{ takes: { faction: string; slot: string; id: string }[] }>("regenerate", eva
        ? { kind: "eva", clip: slot.clip, faction: slot.faction, factions: all ? MODERN : [slot.faction], text }
        : { kind: "voice", path: slot.current[0]?.path, faction: slot.faction, text, engine });
      await s.refreshTakes();
      onTakes(r.takes);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(null);
  };
  const claim = s.state?.gpu.claim;
  return (
    <div className="sd-say">
      <textarea dir="auto" value={text} onChange={e => setText(e.target.value)} rows={2} aria-label="What the line says" onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void say(); }} />
      <div className="sd-say-row">
        {eva ? <label className="sd-switch"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /><span>All 7 factions</span></label>
          : english && <div className="sd-seg" role="radiogroup" aria-label="Engine">
            {([["asis", "Kokoro"], ["chatterbox", "Chatterbox"]] as const).map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={engine === id} onClick={() => setEngine(id)}>{label}</button>)}
          </div>}
        <button type="button" className="sd-go" disabled={busy !== null || !text.trim()} onClick={() => void say()}>
          {busy !== null ? <><Loader2 className="sd-spin" size={14} aria-hidden="true" />{elapsed}s</> : <><Mic size={14} aria-hidden="true" />Say it</>}
        </button>
      </div>
      <small className="sd-say-note">{eva ? `${slot.line?.speaker ?? "announcer"} · Kokoro + the faction's radio chain` : `${slot.line?.speaker ?? "speaker"} · ${slot.line?.language ?? ""} · the line's own generator`}{busy !== null && " · the first take loads the models (about 30 s)"}</small>
      {claim && <small className="sd-say-warn">GPU claimed: {claim.slice(0, 120)} · the desk asks for a turn (gpu-yield.txt)</small>}
      {error && <small className="sd-say-warn">{error}</small>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ slots
const facts = (s: DeskSlot): SlotFacts => ({ slot: s.id, label: s.actor ? `${s.actor} · ${s.label}` : s.faction ? `${FACTION_NAMES[s.faction] ?? s.faction} · ${s.label}` : s.label, faction: s.faction, actor: s.actor, kind: s.kind, current: s.current.map(c => c.path ?? c.ref) });
function StatusMark({ entry }: { entry: SoundSlotEntry | undefined }) {
  const st = slotStatus(entry);
  if (st === "open") return entry?.rejected.length ? <span className="sd-mark is-rej" title={`${entry.rejected.length} rejected`}>{entry.rejected.length}×</span> : null;
  return <span className={`sd-mark is-${st}`} title={st === "use" && entry?.chosen && entry.chosen !== "current" ? `Use: ${entry.chosen.title}` : "Keep current"}>{st === "use" ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : "="}</span>;
}

/** The focused slot: A (now) against B (the pick), the library, and the decision. */
function SlotEditor({ slot, extra, entry, fire, onAudition, onFire, sayIt }: {
  slot: DeskSlot; extra?: DeskSlot[]; entry: SoundSlotEntry | undefined; fire: boolean;
  onAudition?: (a: Audition | null) => void; onFire?: (weapon: string) => void; sayIt?: boolean;
}) {
  const s = useStore();
  const chosen = entry?.chosen && entry.chosen !== "current" ? entry.chosen : null;
  const [pick, setPick] = useState<Candidate | null>(() => (chosen ? s.find(chosen.id) ?? { id: chosen.id, source: chosen.source, title: chosen.title, sub: "", tags: [], licence: chosen.licence, verdict: "ok" } : null));
  const [trim, setTrim] = useState<Trim | null>(() => (chosen as { trim?: Trim } | null)?.trim ?? null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [abFire, setAbFire] = useState<"a" | "b">("b");
  const [error, setError] = useState<string | null>(null);
  const [allTakes, setAllTakes] = useState<{ faction: string; slot: string; id: string }[] | null>(null);
  const slots = useMemo(() => [slot, ...(extra ?? [])], [slot, extra]);
  const decide = useCallback(async (action: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try { await s.act({ ...action, slots: slots.map(facts) }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }, [s, slots]);
  const choosePick = useCallback(() => { if (pick) void decide({ type: "choose", candidate: pick.id, trim }); }, [pick, trim, decide]);
  const keep = useCallback(() => void decide({ type: "keep" }), [decide]);
  const reject = useCallback(() => { if (pick) { void decide({ type: "reject", candidate: pick.id }); } }, [pick, decide]);
  const weapon = slot.weapon;
  // The Attack demo plays A or B for this weapon: the desk's own files, so both come from the same checkout.
  const current = slot.current, kind = slot.kind;
  const audition = useCallback((which: "a" | "b") => {
    if (!weapon || !onAudition) return;
    const urls = which === "b" && pick ? [audioUrl(pick.id, trim)] : current.flatMap(c => (c.id ? [audioUrl(c.id)] : []));
    onAudition(kind === "fire" ? { weapon, report: urls } : { weapon, impact: urls });
  }, [weapon, onAudition, pick, trim, current, kind]);
  useEffect(() => { audition(abFire); }, [audition, abFire]);
  useEffect(() => () => onAudition?.(null), [onAudition]);
  const fireNow = useCallback(() => { if (weapon && fire) { audition(abFire); onFire?.(weapon); } }, [weapon, fire, audition, abFire, onFire]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isFieldKey(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "u" && pick) { e.preventDefault(); choosePick(); }
      else if (k === "n") { e.preventDefault(); keep(); }
      else if (k === "r" && pick) { e.preventDefault(); reject(); }
      else if (k === "a" && slot.current[0]?.id) { e.preventDefault(); void playKey(`${slot.id}|a`, audioUrl(slot.current[Math.floor(Math.random() * slot.current.length)].id!)); }
      else if ((k === "b" || k === " ") && pick) { e.preventDefault(); void playKey(`${slot.id}|b`, audioUrl(pick.id, trim)); }
      else if (k === "f" && weapon && fire) { e.preventDefault(); fireNow(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pick, trim, choosePick, keep, reject, slot, weapon, fire, fireNow]);
  const st = slotStatus(entry);
  const choose = (c: Candidate) => { setPick(c); setTrim(null); void playKey(`${slot.id}|b`, audioUrl(c.id)); };
  const onTakes = (takes: { faction: string; slot: string; id: string }[]) => {
    const mine = takes.find(t => t.slot === slot.id) ?? takes[0];
    const c = mine ? s.find(mine.id) : null;
    if (c) choose(c);
    setAllTakes(takes.length > 1 ? takes : null);
  };
  const chooseAllTakes = async () => {
    if (!allTakes) return;
    setBusy(true);
    try {
      for (const t of allTakes) {
        const clip = slot.clip ?? "";
        await s.act({ type: "choose", candidate: t.id, slots: [{ slot: t.slot, label: `${FACTION_NAMES[t.faction] ?? t.faction} · ${slot.label}`, faction: t.faction, actor: null, kind: "announcer", current: [`mods/rtsai/modern-factions/audio/eva/${t.faction}/${clip}.wav`] }] });
      }
      setAllTakes(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const shared = slot.sharedWith.length;
  return (
    <div className="sd-editor">
      <div className="sd-ab">
        <div className="sd-side is-a">
          <span className="sd-ab-tag">A<small>now</small></span>
          {slot.current.length ? slot.current.map((c, i) => <Wave key={c.ref} id={c.id} playKey={`${slot.id}|a${i}`} label={c.name} size={slot.current.length > 2 ? "sm" : "md"} tone="a" />) : <span className="sd-silent">Silent</span>}
          {slot.current.length > 0 && <small className="sd-ab-name">{slot.current.map(c => c.name.replace(/\.wav$/, "")).join(", ")}</small>}
        </div>
        <div className="sd-side is-b">
          <span className="sd-ab-tag">B<small>pick</small></span>
          {pick ? <>
            <Wave id={pick.id} playKey={`${slot.id}|b`} label={pick.title} size="lg" tone="b" trim={trim} onTrim={setTrim} />
            <small className="sd-ab-name" dir="auto">{pick.title}<span className={`sd-lic is-${pick.verdict}`} title={pick.licence}>{licenceShort(pick.licence)}</span>
              {trim && <button type="button" className="sd-trim" onClick={() => setTrim(null)} title="Use the whole sound"><Scissors size={11} aria-hidden="true" />{trim.start.toFixed(2)}–{trim.end.toFixed(2)}s<X size={11} aria-hidden="true" /></button>}</small>
          </> : <span className="sd-silent">Pick a sound below</span>}
        </div>
      </div>
      {weapon && <div className="sd-fire">
        <button type="button" className="sd-fire-go" disabled={!fire} onClick={fireNow} title={fire ? "Fire it in the Attack demo (F)" : "The Attack demo does not fire this weapon"}><Crosshair size={14} aria-hidden="true" />Fire<kbd>F</kbd></button>
        <div className="sd-seg" role="radiogroup" aria-label="The demo plays">
          {(["a", "b"] as const).map(x => <button key={x} type="button" role="radio" aria-checked={abFire === x} disabled={x === "b" && !pick} onClick={() => setAbFire(x)}>{x.toUpperCase()}</button>)}
        </div>
      </div>}
      <div className="sd-decide">
        {st === "use" && chosen?.id === pick?.id ? <span className="sd-done"><Check size={15} strokeWidth={3} aria-hidden="true" />Using B</span>
          : <button type="button" className="sd-use" disabled={!pick || busy} onClick={choosePick}>Use B<kbd>U</kbd></button>}
        {st === "keep" ? <span className="sd-done is-keep"><Check size={15} strokeWidth={3} aria-hidden="true" />Keeping A</span>
          : <button type="button" className="sd-keep" disabled={busy} onClick={keep}>Keep A<kbd>N</kbd></button>}
        <button type="button" className="sd-reject" disabled={!pick || busy} onClick={reject} title="Reject B for this slot">Reject<kbd>R</kbd></button>
        {st !== "open" && <button type="button" className="sd-undo" disabled={busy} onClick={() => void decide({ type: "clear" })} title="Undo the decision"><Undo2 size={14} aria-hidden="true" /></button>}
        {busy && <Loader2 className="sd-spin" size={14} aria-hidden="true" />}
      </div>
      {(shared > 0 || (extra?.length ?? 0) > 0) && <small className="sd-shared">{extra?.length ? `Decides ${slots.length} slots at once`
        : slot.kind === "voice" ? `One line of a voice set ${shared} other unit${shared > 1 ? "s" : ""} use too: changing it changes theirs`
          : `${shared} other unit${shared > 1 ? "s" : ""} fire the same weapon; this choice is for this unit (Shared decides many at once)`}</small>}
      {allTakes && <button type="button" className="sd-all" disabled={busy} onClick={() => void chooseAllTakes()}><Layers size={14} aria-hidden="true" />Use the new takes for all {allTakes.length} factions</button>}
      {error && <small className="sd-say-warn">{error}</small>}
      <form className="sd-note" onSubmit={e => { e.preventDefault(); if (note.trim()) void decide({ type: "note", text: note }).then(() => setNote("")); }}>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
      </form>
      {entry?.notes.length ? <ul className="sd-notes">{entry.notes.slice(-3).map(n => <li key={n.at}>{n.text}</li>)}</ul> : null}
      <LibraryPanel slot={slot} hint={`${slot.label} ${slot.current.map(c => c.name).join(" ")}`} picked={pick?.id ?? null} onPick={choose} rejected={entry?.rejected ?? []} sayIt={sayIt && slot.regen ? <SayIt key={slot.id} slot={slot} onTakes={onTakes} /> : undefined} />
    </div>
  );
}

function SlotRow({ slot, entry, open, onOpen, children }: { slot: DeskSlot; entry: SoundSlotEntry | undefined; open: boolean; onOpen: () => void; children?: ReactNode }) {
  return (
    <li className={`sd-slot${open ? " is-open" : ""}`} data-status={slotStatus(entry)}>
      <div className="sd-slot-row">
        <button type="button" className="sd-slot-name" onClick={onOpen} aria-expanded={open}>
          <ChevronRight size={13} aria-hidden="true" className="sd-caret" /><span><b>{slot.label}</b>{slot.line?.text && <small dir="auto">{slot.line.text}</small>}</span>
        </button>
        <span className="sd-slot-waves">{slot.current.slice(0, 3).map((c, i) => <Wave key={c.ref} id={c.id} playKey={`${slot.id}|row${i}`} label={c.name} size="sm" />)}{!slot.current.length && <span className="sd-silent">Silent</span>}</span>
        <StatusMark entry={entry} />
      </div>
      {open && children}
    </li>
  );
}

// ------------------------------------------------------------------------------------------------ unit desk
const GROUPS: [DeskSlot["group"], string][] = [["weapon", "Weapons"], ["death", "Destroyed"], ["voice", "Voice"], ["other", "Movement and deploy"]];

function UnitDesk({ actor, faction, fireable, onAudition, onFire }: { actor: string; faction: string; fireable: string[]; onAudition: (a: Audition | null) => void; onFire: (weapon: string) => void }) {
  const s = useStore();
  const [slots, setSlots] = useState<{ actor: string; list: DeskSlot[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    get<{ slots: DeskSlot[] }>(`unit?actor=${encodeURIComponent(actor)}&faction=${encodeURIComponent(faction)}`)
      .then(r => { if (live) { setSlots({ actor, list: r.slots }); setError(null); } })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [actor, faction]);
  const list = slots?.actor === actor ? slots.list : null;
  const ordered = useMemo(() => (list ? GROUPS.flatMap(([g]) => list.filter(x => x.group === g)) : []), [list]);
  // J / K step through the slots, as the Studio steps through units.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isFieldKey(e) || e.metaKey || e.ctrlKey || e.altKey || !ordered.length) return;
      const k = e.key.toLowerCase();
      if (k !== "j" && k !== "k") return;
      e.preventDefault();
      const i = ordered.findIndex(x => x.id === open);
      const next = ordered[(i < 0 ? 0 : i + (k === "j" ? 1 : -1) + ordered.length) % ordered.length];
      setOpen(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, open]);
  if (error) return <p className="sd-error">{error}</p>;
  if (!list) return <div className="sd-loading"><Loader2 className="sd-spin" size={18} aria-hidden="true" /></div>;
  const file = s.state?.file;
  return <>
    {GROUPS.map(([g, label]) => {
      const items = list.filter(x => x.group === g);
      if (!items.length) return null;
      const decided = items.filter(x => slotStatus(file?.slots[x.id]) !== "open").length;
      return <section key={g} className="sd-group"><h4>{label}<small>{decided}/{items.length}</small></h4><ul>
        {items.map(slot => <SlotRow key={slot.id} slot={slot} entry={file?.slots[slot.id]} open={open === slot.id} onOpen={() => setOpen(o => (o === slot.id ? null : slot.id))}>
          <SlotEditor key={slot.id} slot={slot} entry={file?.slots[slot.id]} fire={Boolean(slot.weapon && fireable.some(w => w.toLowerCase() === slot.weapon!.toLowerCase()))} onAudition={onAudition} onFire={onFire} sayIt />
        </SlotRow>)}
      </ul></section>;
    })}
  </>;
}

// ------------------------------------------------------------------------------------------------ announcer desk
function AnnouncerDesk({ faction }: { faction: string }) {
  const s = useStore();
  const [data, setData] = useState<{ faction: string; clips: DeskSlot[]; notifications: DeskSlot[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    get<{ faction: string; clips: DeskSlot[]; notifications: DeskSlot[] }>(`faction?faction=${faction}`).then(r => { if (live) setData(r); }).catch(e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [faction]);
  if (error) return <p className="sd-error">{error}</p>;
  if (!data || data.faction !== faction) return <div className="sd-loading"><Loader2 className="sd-spin" size={18} aria-hidden="true" /></div>;
  const clipOf = new Map(data.clips.map(c => [c.clip!, c]));
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = data.notifications.filter(n => words.every(w => `${n.label} ${n.clip} ${clipOf.get(n.clip!)?.line?.text ?? ""}`.toLowerCase().includes(w)));
  const file = s.state?.file;
  return <>
    <label className="sd-search is-wide"><Search size={13} aria-hidden="true" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search the announcer: ready, nuclear, 009…" aria-label="Search the announcer" /></label>
    <ul className="sd-eva">
      {rows.map(n => {
        const clip = clipOf.get(n.clip!);
        const sharing = clip?.notifications?.filter(k => `notify:${k}` !== n.id) ?? [];
        const evaEntry = clip ? file?.slots[clip.id] : undefined, notifyEntry = file?.slots[n.id];
        const isOpen = open === n.id;
        return <li key={n.id} className={`sd-slot${isOpen ? " is-open" : ""}`} data-status={slotStatus(notifyEntry) !== "open" ? slotStatus(notifyEntry) : slotStatus(evaEntry)}>
          <div className="sd-slot-row">
            <button type="button" className="sd-slot-name" onClick={() => setOpen(o => (o === n.id ? null : n.id))} aria-expanded={isOpen}>
              <ChevronRight size={13} aria-hidden="true" className="sd-caret" />
              <span><b>{n.label}</b><small><code>{n.clip}</code> {clip?.line?.text ?? "—"}{sharing.length > 0 && <em className="sd-also" title={`Also plays for ${sharing.join(", ")}`}> = {sharing.length} more</em>}</small></span>
            </button>
            <span className="sd-slot-waves">{clip?.current[0] && <Wave id={clip.current[0].id} playKey={`${n.id}|row`} label={clip.line?.text ?? n.clip!} size="sm" />}</span>
            <StatusMark entry={notifyEntry?.chosen ? notifyEntry : evaEntry} />
          </div>
          {isOpen && clip && <div className="sd-eva-open">
            <h5><Layers size={13} aria-hidden="true" />Which clip it plays<small>the same for every faction</small></h5>
            <ClipPicker notification={n} clips={data.clips} entry={notifyEntry} />
            <h5><AudioLines size={13} aria-hidden="true" />What <code>{n.clip}</code> says<small>{sharing.length > 0 ? `also for ${sharing.map(k => k.replace(/([a-z])([A-Z])/g, "$1 $2")).join(", ")}` : FACTION_NAMES[faction]}</small></h5>
            <SlotEditor key={clip.id} slot={clip} entry={evaEntry} fire={false} sayIt />
          </div>}
        </li>;
      })}
    </ul>
  </>;
}

/** Points a notification at another announcer clip (the mapping in audio/notifications.yaml, shared by all factions). */
function ClipPicker({ notification, clips, entry }: { notification: DeskSlot; clips: DeskSlot[]; entry: SoundSlotEntry | undefined }) {
  const s = useStore();
  const chosen = entry?.chosen && entry.chosen !== "current" ? entry.chosen.path : null;
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const pick = async (clip: string | null) => {
    setBusy(true);
    try { await s.act(clip === null ? { type: "clear", slots: [facts(notification)] } : clip === notification.clip ? { type: "keep", slots: [facts(notification)] } : { type: "choose", candidate: `eva-clip:${clip}`, slots: [facts(notification)] }); }
    finally { setBusy(false); }
  };
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  // Without a search: the clip it plays now, the one chosen, and clips that say something close to the notification.
  const near = notification.label.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const list = words.length ? clips.filter(c => words.every(w => `${c.clip} ${c.line?.text ?? ""}`.toLowerCase().includes(w))).slice(0, 40)
    : clips.filter(c => c.clip === notification.clip || c.clip === chosen || near.some(w => (c.line?.text ?? "").toLowerCase().includes(w))).slice(0, 8);
  return <div className="sd-clips">
    <label className="sd-search"><Search size={13} aria-hidden="true" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a clip: ready, 003…" aria-label="Find a clip" /></label>
    <ul>{list.map(c => {
      const here = (chosen ?? notification.clip) === c.clip;
      return <li key={c.id} data-current={c.clip === notification.clip || undefined}>
        <Wave id={c.current[0]?.id ?? null} playKey={`${notification.id}|${c.clip}`} label={c.line?.text ?? c.clip!} size="sm" />
        <button type="button" aria-pressed={here} disabled={busy} onClick={() => void pick(here && chosen ? null : c.clip!)}><code>{c.clip}</code><span dir="auto">{c.line?.text}</span>{here && <Check size={12} strokeWidth={3} aria-hidden="true" />}</button>
      </li>;
    })}</ul>
  </div>;
}

// ------------------------------------------------------------------------------------------------ bulk sheets
type Use = { slot: string; kind: string; label: string; actor: string; faction: string; name: string; cameo: string | null; current: string[]; weapon: string | null };
type Family = { family: string; label: string; refs: string[]; play: string | null; units: number; uses: Use[] };

function Sheet({ title, icon, onClose, children }: { title: string; icon: ReactNode; onClose: () => void; children: ReactNode }) {
  // Sheets open on a click, never on the server: the stage column is there to cover.
  const host = typeof document === "undefined" ? null : document.getElementById("viewer-main");
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !isFieldKey(e)) onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  if (!host) return null;
  return createPortal(<section className="sd-sheet" aria-label={title}>
    <header><h3>{icon}{title}</h3><button type="button" className="sd-close" onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /></button></header>
    {children}
  </section>, host);
}

/** A bulk pick: one candidate for many slots at once (B, library, Use for N). */
function BulkPick({ kind, slots, label, onDone }: { kind: string; slots: SlotFacts[]; label: string; onDone?: () => void }) {
  const s = useStore();
  const [pick, setPick] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try { await s.act({ ...action, slots }); onDone?.(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  return <div className="sd-bulk">
    <div className="sd-bulk-bar">
      <span className="sd-ab-tag">B</span>
      {pick ? <Wave id={pick.id} playKey={`bulk|${label}`} label={pick.title} size="md" tone="b" /> : <span className="sd-silent">Pick a sound</span>}
      {pick && <small className="sd-ab-name" dir="auto">{pick.title}<span className={`sd-lic is-${pick.verdict}`} title={pick.licence}>{licenceShort(pick.licence)}</span></small>}
      <button type="button" className="sd-use" disabled={!pick || busy || !slots.length} onClick={() => void act({ type: "choose", candidate: pick!.id })}>Use for {slots.length}</button>
      <button type="button" className="sd-keep" disabled={busy || !slots.length} onClick={() => void act({ type: "keep" })}>Keep {slots.length}</button>
      {busy && <Loader2 className="sd-spin" size={14} aria-hidden="true" />}
    </div>
    {error && <small className="sd-say-warn">{error}</small>}
    <LibraryPanel slot={{ kind, id: `bulk:${label}`, faction: null }} picked={pick?.id ?? null} onPick={c => { setPick(c); void playKey(`bulk|${label}`, audioUrl(c.id)); }} rejected={[]} />
  </div>;
}

function SharedSheet({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [families, setFamilies] = useState<Family[] | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<"all" | "fire" | "impact" | "death">("fire");
  useEffect(() => { void get<{ families: Family[] }>("shared").then(r => { setFamilies(r.families); setFocus(f => f ?? r.families.find(x => x.uses.some(u => u.kind === "fire"))?.family ?? r.families[0]?.family ?? null); }); }, []);
  const shown = (families ?? []).filter(f => kind === "all" || f.uses.some(u => u.kind === kind));
  const fam = families?.find(f => f.family === focus) ?? null;
  const uses = fam ? fam.uses.filter(u => kind === "all" || u.kind === kind) : [];
  const selected = uses.filter(u => !off.has(u.slot));
  const file = s.state?.file;
  return <Sheet title="Shared sounds" icon={<Layers size={16} aria-hidden="true" />} onClose={onClose}>
    <div className="sd-sheet-body is-split">
      <aside className="sd-fams">
        <div className="sd-seg" role="radiogroup" aria-label="Kind">{(["fire", "impact", "death", "all"] as const).map(k => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>{k === "fire" ? "Fire" : k === "impact" ? "Impact" : k === "death" ? "Destroyed" : "All"}</button>)}</div>
        <ul>{shown.map(f => { const n = new Set(f.uses.filter(u => kind === "all" || u.kind === kind).map(u => u.actor)).size; return <li key={f.family}>
          <Wave id={f.play} playKey={`fam|${f.family}`} label={f.label} size="sm" />
          <button type="button" aria-pressed={focus === f.family} onClick={() => { setFocus(f.family); setOff(new Set()); }}><b>{f.label}</b><small>{n} units</small><i style={{ "--n": Math.min(1, n / 45) } as CSSProperties} /></button>
        </li>; })}</ul>
      </aside>
      {fam && <div className="sd-fam">
        <h4>{fam.label}<small>{selected.length} of {uses.length} slots selected · click a unit to leave it out</small></h4>
        <div className="sd-cards">
          {MODERN.map(f => { const mine = uses.filter(u => u.faction === f); return mine.length ? <div key={f} className="sd-cards-faction"><h5>{FACTION_NAMES[f]}</h5><ul>
            {mine.map(u => <li key={u.slot}><button type="button" className="sd-card" aria-pressed={!off.has(u.slot)} data-status={slotStatus(file?.slots[u.slot])} onClick={() => setOff(o => { const n = new Set(o); if (n.has(u.slot)) n.delete(u.slot); else n.add(u.slot); return n; })} title={`${u.name}: ${u.label}`}>
              {u.cameo ? <img src={u.cameo} width={60} height={48} alt="" loading="lazy" /> : <i className="viewer-nocameo" />}<span><b>{u.name}</b><small>{u.label.replace(/ · (fire|impact)$/, "")}</small></span><StatusMark entry={file?.slots[u.slot]} />
            </button></li>)}
          </ul></div> : null; })}
        </div>
        <BulkPick kind={kind === "death" ? "death" : kind === "impact" ? "impact" : "fire"} label={fam.family} slots={selected.map(u => ({ slot: u.slot, label: `${u.actor} · ${u.label}`, faction: u.faction, actor: u.actor, kind: u.kind as SlotFacts["kind"], current: u.current }))} />
      </div>}
      {!families && <div className="sd-loading"><Loader2 className="sd-spin" size={18} aria-hidden="true" /></div>}
    </div>
  </Sheet>;
}

type DeathUnit = { id: string; faction: string; name: string; category: string; cameo: string | null; cls: string; slot: SlotFacts; play: string | null; guess: DeathSize; size: DeathSize | null };
const SIZES: DeathSize[] = ["small", "medium", "large"];
function DeathsSheet({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [units, setUnits] = useState<DeathUnit[] | null>(null);
  const [cls, setCls] = useState("vehicle");
  const [bucket, setBucket] = useState<DeathSize | null>("medium");
  const [drag, setDrag] = useState<string | null>(null);
  useEffect(() => { void get<{ units: DeathUnit[] }>("deaths").then(r => setUnits(r.units)); }, []);
  const sizes = s.state?.file.deathSizes ?? {};
  const sizeOf = (u: DeathUnit) => sizes[u.id] ?? u.guess;
  const move = (actor: string, size: DeathSize) => void s.act({ type: "size", actors: [actor], size });
  const list = (units ?? []).filter(u => u.cls === cls);
  const file = s.state?.file;
  const classes: [string, string][] = [["vehicle", "Vehicles"], ["ship", "Ships"], ["aircraft", "Aircraft"], ["building", "Buildings"]];
  const inBucket = bucket ? list.filter(u => sizeOf(u) === bucket) : [];
  return <Sheet title="Destroyed, by size" icon={<Flame size={16} aria-hidden="true" />} onClose={onClose}>
    <div className="sd-sheet-body">
      <div className="sd-seg is-wide" role="radiogroup" aria-label="Class">{classes.map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={cls === id} onClick={() => setCls(id)}>{label}<small>{(units ?? []).filter(u => u.cls === id).length}</small></button>)}</div>
      <div className="sd-sizes">
        {SIZES.map(size => { const mine = list.filter(u => sizeOf(u) === size); return (
          <div key={size} className={`sd-size${bucket === size ? " is-focus" : ""}${drag ? " is-drop" : ""}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (drag) move(drag, size); setDrag(null); }}>
            <button type="button" className="sd-size-head" aria-pressed={bucket === size} onClick={() => setBucket(size)}><b>{size[0].toUpperCase() + size.slice(1)}</b><small>{mine.length}</small></button>
            <ul>{mine.map(u => <li key={u.id}><button type="button" className="sd-card" draggable data-status={slotStatus(file?.slots[u.slot.slot])} onDragStart={() => setDrag(u.id)} onDragEnd={() => setDrag(null)}
              onClick={() => { void playKey(`death|${u.id}`, audioUrl(u.play ?? "")); }} onContextMenu={e => { e.preventDefault(); move(u.id, SIZES[(SIZES.indexOf(sizeOf(u)) + 1) % 3]); }}
              title={`${u.name} (${FACTION_NAMES[u.faction]}): drag to another size, right-click to move it up a size, click to hear it now`}>
              {u.cameo ? <img src={u.cameo} width={60} height={48} alt="" loading="lazy" /> : <i className="viewer-nocameo" />}<span><b>{u.name}</b><small>{FACTION_NAMES[u.faction]}</small></span><StatusMark entry={file?.slots[u.slot.slot]} />
            </button></li>)}</ul>
          </div>); })}
      </div>
      {bucket && <BulkPick key={`${cls}-${bucket}`} kind="death" label={`${cls}-${bucket}`} slots={inBucket.map(u => u.slot)} />}
      {!units && <div className="sd-loading"><Loader2 className="sd-spin" size={18} aria-hidden="true" /></div>}
    </div>
  </Sheet>;
}

/** What is decided: every slot with a choice, newest first, A and B, undo; and the command that applies them. */
function PendingSheet({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const file = s.state?.file;
  const rows = Object.entries(file?.slots ?? {}).filter(([, e]) => slotStatus(e) !== "open").sort(([, a], [, b]) => ((a.at ?? "") < (b.at ?? "") ? 1 : -1));
  const decisions = s.state?.art ? `${s.state.art}${s.state.art.includes("\\") ? "\\" : "/"}sound-review.json` : "../RTSAI-Art/sound-review.json";
  const command = `python tools/apply-sound-decisions.py --decisions "${decisions}" --dry-run`;
  const undo = async (slot: string, e: SoundSlotEntry) => {
    setBusy(slot);
    try { await s.act({ type: "clear", slots: [{ slot, label: e.label, faction: e.faction, actor: e.actor, kind: e.kind, current: e.current }] }); } finally { setBusy(null); }
  };
  const pending = s.state?.pending ?? 0;
  return <Sheet title="Decisions" icon={<ListChecks size={16} aria-hidden="true" />} onClose={onClose}>
    <div className="sd-sheet-body">
      <div className="sd-apply">
        <span><b>{pending}</b> new sound{pending === 1 ? "" : "s"} to apply · {rows.length - pending} kept · in RTSAI-Mod, on a branch:</span>
        <code>{command}</code>
        <button type="button" className="sd-keep" onClick={() => { void navigator.clipboard?.writeText(command).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? "Copied" : "Copy"}</button>
      </div>
      <ul className="sd-decisions">
        {rows.map(([slot, e]) => {
          const c = e.chosen && e.chosen !== "current" ? e.chosen : null;
          const a = e.current.find(x => x.startsWith("mods/"));
          return <li key={slot} data-status={slotStatus(e)}>
            <span className="sd-decision-name"><b>{e.label}</b><small>{e.faction ? FACTION_NAMES[e.faction] ?? e.faction : "Every faction"} · {e.kind}{e.notes.length ? ` · “${e.notes[e.notes.length - 1].text}”` : ""}</small></span>
            <span className="sd-decision-ab">
              {a && <Wave id={`project:${a}`} playKey={`pend|${slot}|a`} label={a} size="sm" tone="a" />}
              {c ? (c.source === "eva-clip" ? <code>→ {c.path}</code> : <Wave id={c.id} playKey={`pend|${slot}|b`} label={c.title} size="sm" tone="b" />) : <span className="sd-silent">keep A</span>}
            </span>
            <small className="sd-decision-what" dir="auto">{c ? c.title : ""}</small>
            <button type="button" className="sd-undo" disabled={busy === slot} onClick={() => void undo(slot, e)} title="Undo"><Undo2 size={14} aria-hidden="true" /></button>
          </li>;
        })}
        {!rows.length && <li className="sd-empty">Nothing decided yet.</li>}
      </ul>
    </div>
  </Sheet>;
}

// ------------------------------------------------------------------------------------------------ the desk
/** The top-bar switch; the badge counts chosen replacements not yet applied to the mod. */
export function SoundDeskToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const s = useStore();
  const pending = s.state?.pending ?? 0;
  return <button type="button" className="sd-toggle" aria-pressed={on} onClick={() => onChange(!on)} title={on ? "Close the Sound desk" : "Open the Sound desk"}>
    <SlidersHorizontal size={14} aria-hidden="true" />Sound desk{pending > 0 && <small title={`${pending} chosen, not yet applied`}>{pending}</small>}
  </button>;
}

export function SoundDesk({ faction, factionName, unit, onAudition, onFire }: {
  /** The mod's faction id (china, …, saudi): the voice prefixes and announcer folders. */
  faction: string;
  factionName: string;
  unit: { id: string; name: string; weapons: string[]; modern: boolean } | null;
  onAudition: (a: Audition | null) => void;
  onFire: (weapon: string) => void;
}) {
  const s = useStore();
  const [sheet, setSheet] = useState<"shared" | "deaths" | "pending" | null>(null);
  const modern = MODERN.includes(faction);
  const close = useCallback(() => setSheet(null), []);
  return (
    <div className="sd">
      <header className="sd-head">
        <span className="eyebrow">Sound desk</span>
        <h2>{unit ? unit.name : `${factionName} announcer`}</h2>
        <div className="sd-head-tools">
          <button type="button" aria-pressed={sheet === "shared"} onClick={() => setSheet(x => (x === "shared" ? null : "shared"))} title="Stand-in sounds many units share"><Layers size={14} aria-hidden="true" />Shared</button>
          <button type="button" aria-pressed={sheet === "deaths"} onClick={() => setSheet(x => (x === "deaths" ? null : "deaths"))} title="Explosions by size"><Flame size={14} aria-hidden="true" />By size</button>
          <button type="button" className="sd-pending" aria-pressed={sheet === "pending"} onClick={() => setSheet(x => (x === "pending" ? null : "pending"))} title="Every decision, and how to apply them to the mod"><ListChecks size={14} aria-hidden="true" />{s.state?.pending ?? 0} to apply</button>
        </div>
      </header>
      {s.error && <p className="sd-error">The desk’s API did not answer: {s.error}</p>}
      {!modern ? <p className="sd-note-text">The Sound desk covers the seven modern factions. The original countries keep Westwood’s sounds.</p>
        : unit ? (unit.modern ? <UnitDesk key={unit.id} actor={unit.id} faction={faction} fireable={unit.weapons} onAudition={onAudition} onFire={onFire} /> : <p className="sd-note-text">A shared original unit: its sounds are the original countries’ too, so they are not changed here.</p>)
          : <AnnouncerDesk faction={faction} />}
      {sheet === "shared" && <SharedSheet onClose={close} />}
      {sheet === "deaths" && <DeathsSheet onClose={close} />}
      {sheet === "pending" && <PendingSheet onClose={close} />}
    </div>
  );
}
