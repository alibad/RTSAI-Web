"use client";
/**
 * The Review inbox (owner, 20 November 2026): one clip of the game at a time, large and playing, with who is fighting
 * whom shown as flags and unit icons. Three answers, each one click or key, then the next clip: Looks good (G),
 * Skip (S), or a voice note (V) pinned to the second where the owner started talking and saved as audio with its
 * transcript. T types instead. Clips a session fixed come back first, as "fixed, check again".
 *
 * A clip belongs to a front (battles, campaign, AI, ...): every session can add clips (tools/review.mjs add) and read
 * the answers (tools/review.mjs feedback). Data and its owner-only rule: lib/review/model.ts, firestore.rules.
 */
/* eslint-disable @next/next/no-img-element -- flags, unit icons and posters are small static files named by the clip. */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Firestore } from "firebase/firestore";
import {
  Anchor, ArrowRight, Building2, Check, CircleCheck, Crosshair, ExternalLink, Footprints, Keyboard, Mic, MoveRight, Pause, Plane, Play,
  Radar, RotateCcw, Shield, Ship, SkipForward, Swords, Target, ThumbsDown, ThumbsUp, Truck, Undo2, Volume2, X, Zap,
} from "lucide-react";
import { useAuth } from "../AuthProvider";
import { getFirebaseAuth, getFirebaseFirestore } from "../../../lib/firebase-client";
import { OWNER_EMAILS } from "../../../lib/admin";
import { clock, frontLabel, inboxOrder, waiting, type ClipSide, type ClipState, type ClipUnit, type NoteState, type ReviewClip, type ReviewNote } from "../../../lib/review/model";
import { addNote, answerClip, deleteNote, dismissSuspect, loadClips, loadNotes, noteAudio, updateNote } from "../../../lib/review/store";
import { useVoiceNote } from "./useVoiceNote";
import "./review.css";

const CLASS_ICONS = { infantry: Footprints, vehicle: Truck, aircraft: Plane, ship: Ship, defence: Shield, building: Building2, special: Zap };
const MODE_ICONS: Record<string, typeof Swords> = {
  direct: Crosshair, "attack-move": MoveRight, siege: Target, "air-strike": Plane, "anti-air": Radar, naval: Anchor,
  garrison: Building2, deployed: Shield, defence: Shield, special: Zap,
};
const STATE_WORDS: Record<ClipState, string> = { new: "Waiting", good: "Looks good", skipped: "Skipped", noted: "Has notes", recheck: "Fixed, check again" };

/** The local preview (Firebase emulators, tools/review-preview.mjs) signs the owner in by itself. */
const PREVIEW = process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "1";

function Unit({ unit }: { unit: ClipUnit }) {
  const Icon = CLASS_ICONS[unit.cls ?? "vehicle"] ?? Truck;
  return <figure className="rv-unit" title={`${unit.count} × ${unit.name}`}>
    <span className="rv-unit-art">{unit.icon ? <img src={unit.icon} alt="" width={60} height={48} loading="lazy" /> : <Icon size={22} aria-hidden="true" />}{unit.count > 1 && <b>×{unit.count}</b>}</span>
    <figcaption>{unit.name}</figcaption>
  </figure>;
}

function Side({ side, end }: { side: ClipSide; end?: boolean }) {
  return <div className={end ? "rv-side is-end" : "rv-side"}>
    <span className="rv-flag" title={side.name}>{side.flag ? <img src={side.flag} alt="" width={54} height={36} /> : <i>{side.name.slice(0, 2)}</i>}<small>{side.name}</small></span>
    <div className="rv-units">{side.units.map((u) => <Unit key={u.id} unit={u} />)}</div>
  </div>;
}

/** A voice note's own audio, fetched when asked for. */
function NoteSound({ db, clipId, note }: { db: Firestore; clipId: string; note: ReviewNote }) {
  const [url, setUrl] = useState("");
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (!note.audio) return null;
  // eslint-disable-next-line jsx-a11y/media-has-caption -- the owner's own voice note; its transcript is the text beside it.
  if (url) return <audio className="rv-note-audio" src={url} controls autoPlay />;
  return <button type="button" className="rv-mini" title="Hear this note" onClick={async () => { const blob = await noteAudio(db, clipId, note); if (blob) setUrl(URL.createObjectURL(blob)); }}><Volume2 size={13} aria-hidden="true" /> {clock(note.audio.seconds)}</button>;
}

export function ReviewInbox() {
  const { user, loading: authLoading, openAuth } = useAuth();
  const [db, setDb] = useState<Firestore | null>(null);
  const [clips, setClips] = useState<ReviewClip[] | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  // /admin/review?front=battles opens on one front.
  const [front, setFront] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("front")) ?? "all");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, ReviewNote[]>>({});
  const [panel, setPanel] = useState<"watch" | "voice" | "type">("watch");
  const [pinned, setPinned] = useState(0);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<{ id: string; was: ClipState; notes: { id: string; was: NoteState }[] }[]>([]);
  const [showBefore, setShowBefore] = useState(false);
  const [length, setLength] = useState(0);
  const [paused, setPaused] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const fill = useRef<HTMLElement | null>(null);
  const timeLabel = useRef<HTMLSpanElement | null>(null);
  const { words: voiceWords, seconds: voiceSeconds, problem: voiceProblem, meterRef, start: voiceStart, stop: voiceStop, cancel: voiceCancel } = useVoiceNote();

  // ---- sign-in and loading
  useEffect(() => { void getFirebaseFirestore().then(setDb); }, []);
  useEffect(() => {
    if (!PREVIEW || authLoading || user) return;
    const auth = getFirebaseAuth();
    if (auth) void import("firebase/auth").then((A) => A.signInWithEmailAndPassword(auth, OWNER_EMAILS[0], "review-preview")).catch(() => {});
  }, [authLoading, user]);
  useEffect(() => {
    if (!db || !user) return;
    let live = true;
    loadClips(db).then((all) => {
      if (!live) return;
      const sorted = [...all].sort(inboxOrder);
      setClips(sorted);
      setOrder(sorted.map((c) => c.id));
      setCurrentId((id) => id ?? sorted.find((c) => waiting(c) && (front === "all" || c.front === front))?.id ?? null);
    }).catch((e: { code?: string }) => { if (live) { setClips([]); setError(e.code === "permission-denied" ? "This inbox opens only for the owner's sign-in." : "The inbox could not be loaded. Check the connection and reload."); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loaded once per sign-in; the front only picks the first clip.
  }, [db, user]);

  const byId = useMemo(() => new Map((clips ?? []).map((c) => [c.id, c])), [clips]);
  const inFront = useCallback((c: ReviewClip) => front === "all" || c.front === front, [front]);
  const strip = useMemo(() => order.map((id) => byId.get(id)).filter((c): c is ReviewClip => !!c && inFront(c)), [order, byId, inFront]);
  const clip = currentId ? byId.get(currentId) ?? null : null;
  const clipNotes = useMemo(() => (clip ? notes[clip.id] ?? [] : []), [clip, notes]);
  const fronts = useMemo(() => {
    const ids = [...new Set((clips ?? []).map((c) => c.front))];
    return ids.map((id) => ({ id, label: frontLabel(id), left: (clips ?? []).filter((c) => c.front === id && waiting(c)).length }));
  }, [clips]);
  const left = strip.filter(waiting).length;

  useEffect(() => {
    if (!db || !clip || notes[clip.id]) return;
    let live = true;
    const id = clip.id;
    void loadNotes(db, id).then((list) => { if (live) setNotes((n) => ({ ...n, [id]: list })); }).catch(() => {});
    return () => { live = false; };
  }, [db, clip, notes]);

  // A new clip starts from its beginning, playing, with nothing half-said.
  const openClip = useCallback((id: string | null) => { setCurrentId(id); setPanel("watch"); setTyped(""); setShowBefore(false); setLength(0); setPaused(false); }, []);
  const pickFront = useCallback((id: string) => { setFront(id); openClip((clips ?? []).find((c) => waiting(c) && (id === "all" || c.front === id))?.id ?? null); }, [clips, openClip]);
  const typeBox = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (panel === "type") typeBox.current?.focus(); }, [panel]);

  // ---- the video
  // The playhead follows the video on every frame without re-rendering the page.
  useEffect(() => {
    let frame = 0;
    const follow = () => {
      const v = video.current;
      if (v) {
        const total = v.duration || 0;
        if (fill.current) fill.current.style.width = total ? `${Math.min(100, (v.currentTime / total) * 100)}%` : "0%";
        if (timeLabel.current) timeLabel.current.textContent = `${clock(v.currentTime)} / ${clock(total)}`;
      }
      frame = requestAnimationFrame(follow);
    };
    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, []);
  const seek = useCallback((t: number) => { const v = video.current; if (v) v.currentTime = Math.max(0, Math.min(v.duration || t, t)); }, []);
  const togglePlay = useCallback(() => { const v = video.current; if (!v) return; if (v.paused) void v.play().catch(() => {}); else v.pause(); }, []);

  // ---- answers
  const patchClip = useCallback((id: string, patch: Partial<ReviewClip>) => setClips((all) => (all ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c))), []);
  const goNext = useCallback((from: string, answered: Record<string, ClipState> = {}) => {
    const ids = strip.map((c) => c.id), at = ids.indexOf(from);
    const open = (id: string) => { const c = byId.get(id); return !!c && (answered[id] ? answered[id] === "new" || answered[id] === "recheck" : waiting(c)); };
    openClip([...ids.slice(at + 1), ...ids.slice(0, Math.max(0, at))].find(open) ?? null);
  }, [strip, byId, openClip]);
  const fail = useCallback((e: unknown) => { console.error(e); setError((e as { code?: string }).code === "permission-denied" ? "Not saved: this inbox takes answers only from the owner's sign-in." : "Not saved. Check the connection and try again."); }, []);

  const answer = useCallback(async (state: "good" | "skipped") => {
    if (!db || !clip || busy) return;
    setBusy(true); setError("");
    try {
      // "Looks good" on a clip that came back fixed closes the notes it answers.
      const closing = state === "good" ? clipNotes.filter((n) => n.state === "recheck") : [];
      for (const n of closing) await updateNote(db, clip.id, n.id, { state: "fixed" });
      await answerClip(db, clip.id, state);
      setHistory((h) => [...h, { id: clip.id, was: clip.state, notes: closing.map((n) => ({ id: n.id, was: n.state })) }]);
      if (closing.length) setNotes((all) => ({ ...all, [clip.id]: (all[clip.id] ?? []).map((n) => (closing.includes(n) ? { ...n, state: "fixed" } : n)) }));
      patchClip(clip.id, { state });
      goNext(clip.id, { [clip.id]: state });
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [db, clip, busy, clipNotes, patchClip, goNext, fail]);

  const saveNote = useCallback(async (input: { t: number; text: string; said: ReviewNote["said"]; transcript: ReviewNote["transcript"]; voice?: { blob: Blob; seconds: number } }, stay: boolean) => {
    if (!db || !clip) return;
    setBusy(true); setError("");
    try {
      const note = await addNote(db, clip.id, { ...input, round: clip.round });
      // A new note on a clip that came back fixed means the fix did not land: its earlier notes are open again.
      const reopened = clipNotes.filter((n) => n.state === "recheck");
      for (const n of reopened) await updateNote(db, clip.id, n.id, { state: "open" });
      if (clip.state !== "noted") await answerClip(db, clip.id, "noted");
      setNotes((all) => ({ ...all, [clip.id]: [...(all[clip.id] ?? []).map((n) => (reopened.includes(n) ? { ...n, state: "open" as const } : n)), note].sort((a, b) => a.t - b.t) }));
      patchClip(clip.id, { state: "noted" });
      setPanel("watch"); setTyped("");
      if (stay) void video.current?.play().catch(() => {}); else goNext(clip.id, { [clip.id]: "noted" });
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [db, clip, clipNotes, patchClip, goNext, fail]);

  const startVoice = useCallback(async () => {
    if (!clip || busy || panel !== "watch") return;
    const v = video.current;
    setPinned(v?.currentTime ?? 0);
    v?.pause();
    if (await voiceStart()) setPanel("voice"); else void v?.play().catch(() => {});
  }, [clip, busy, panel, voiceStart]);
  const endVoice = useCallback(async (stay: boolean) => {
    const take = await voiceStop();
    if (!take) { setPanel("watch"); return; }
    await saveNote({ t: pinned, text: take.text, said: "voice", transcript: take.text ? "browser" : "none", voice: { blob: take.blob, seconds: take.seconds } }, stay);
  }, [voiceStop, saveNote, pinned]);
  const cancelNote = useCallback(() => { voiceCancel(); setPanel("watch"); setTyped(""); void video.current?.play().catch(() => {}); }, [voiceCancel]);
  const startTyping = useCallback(() => { if (!clip || busy || panel !== "watch") return; setPinned(video.current?.currentTime ?? 0); video.current?.pause(); setPanel("type"); }, [clip, busy, panel]);
  const saveTyped = useCallback((stay: boolean) => { if (typed.trim()) void saveNote({ t: pinned, text: typed, said: "typed", transcript: "typed" }, stay); }, [typed, pinned, saveNote]);

  const removeNote = useCallback(async (note: ReviewNote) => {
    if (!db || !clip) return;
    try {
      await deleteNote(db, clip.id, note);
      const rest = clipNotes.filter((n) => n.id !== note.id);
      setNotes((all) => ({ ...all, [clip.id]: rest }));
      // With its last open note gone, the clip waits for an answer again.
      if (clip.state === "noted" && !rest.some((n) => n.state === "open")) {
        const back: ClipState = clip.round > 1 && rest.some((n) => n.state === "recheck") ? "recheck" : "new";
        await answerClip(db, clip.id, back);
        patchClip(clip.id, { state: back });
      }
    } catch (e) { fail(e); }
  }, [db, clip, clipNotes, patchClip, fail]);

  const confirmSuspect = useCallback((index: number) => { const s = clip?.suspects[index]; if (s) void saveNote({ t: s.t, text: s.text, said: "suspect", transcript: "typed" }, true); }, [clip, saveNote]);
  const waveOff = useCallback(async (index: number) => {
    if (!db || !clip) return;
    try { await dismissSuspect(db, clip.id, index); patchClip(clip.id, { dismissed: [...clip.dismissed, index] }); } catch (e) { fail(e); }
  }, [db, clip, patchClip, fail]);

  const undo = useCallback(async () => {
    const last = history.at(-1);
    if (!db || !last || busy) return;
    setBusy(true);
    try {
      for (const n of last.notes) await updateNote(db, last.id, n.id, { state: n.was });
      await answerClip(db, last.id, last.was);
      patchClip(last.id, { state: last.was });
      if (last.notes.length) setNotes((all) => ({ ...all, [last.id]: (all[last.id] ?? []).map((n) => { const was = last.notes.find((x) => x.id === n.id)?.was; return was ? { ...n, state: was } : n; }) }));
      setHistory((h) => h.slice(0, -1));
      openClip(last.id);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [db, history, busy, patchClip, fail, openClip]);

  // ---- keys: the whole inbox works without the mouse
  const hasOpen = clipNotes.some((n) => n.state === "open");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (panel === "voice") {
        if (key === "Enter" || key === "v") { e.preventDefault(); void endVoice(false); }
        else if (key === "m") { e.preventDefault(); void endVoice(true); }
        else if (key === "Escape") { e.preventDefault(); cancelNote(); }
        return;
      }
      if (panel !== "watch" || !clip) { if (key === "z") void undo(); return; }
      if (key === "v") { e.preventDefault(); void startVoice(); }
      else if (key === "t") { e.preventDefault(); startTyping(); }
      else if (key === "g" || (key === "Enter" && !hasOpen)) { e.preventDefault(); if (!hasOpen) void answer("good"); }
      else if (key === "Enter" || key === "n") { e.preventDefault(); if (hasOpen) goNext(clip.id); }
      else if (key === "s") { e.preventDefault(); if (!hasOpen) void answer("skipped"); }
      else if (key === "z") { e.preventDefault(); void undo(); }
      else if (key === " " || key === "k") { e.preventDefault(); togglePlay(); }
      else if (key === "ArrowLeft") { e.preventDefault(); seek((video.current?.currentTime ?? 0) - 1); }
      else if (key === "ArrowRight") { e.preventDefault(); seek((video.current?.currentTime ?? 0) + 1); }
      else if (key === "b" && clip.before) { e.preventDefault(); setShowBefore((b) => !b); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, clip, hasOpen, answer, startVoice, startTyping, endVoice, cancelNote, goNext, undo, togglePlay, seek]);

  // ---- what to draw
  if (!user && !authLoading) return <main id="main-content" className="rv rv-empty"><div className="rv-card">
    <h1>Review inbox</h1><p>{PREVIEW ? "Opening the preview…" : "Sign in as the owner to open it."}</p>
    {!PREVIEW && <button type="button" className="rv-go" onClick={() => openAuth("Sign in to open the Review inbox")}>Sign in</button>}
  </div></main>;
  if (!clips) return <main id="main-content" className="rv rv-empty" aria-busy="true"><div className="rv-card"><p>Loading the inbox…</p></div></main>;

  const total = clip ? length || clip.seconds || 1 : 1;
  const suspects = clip ? clip.suspects.map((s, index) => ({ ...s, index })).filter((s) => !clip.dismissed.includes(s.index) && !clipNotes.some((n) => n.said === "suspect" && n.text === s.text)) : [];
  const answered = clip ? clipNotes.filter((n) => n.state === "recheck") : [];
  const mine = clip ? clipNotes.filter((n) => n.state !== "recheck") : [];
  const recheck = clip?.state === "recheck";
  const ModeIcon = MODE_ICONS[clip?.mode?.id ?? ""] ?? Swords;
  const mark = (t: number) => ({ left: `${Math.min(100, (t / total) * 100)}%` }) as CSSProperties;
  const counts = { good: strip.filter((c) => c.state === "good").length, noted: strip.filter((c) => c.state === "noted").length, skipped: strip.filter((c) => c.state === "skipped").length };

  let actions: ReactNode;
  if (panel === "voice") actions = <div className="rv-talk" data-testid="rv-recording">
    <span className="rv-meter" ref={meterRef} aria-hidden="true"><Mic size={22} /></span>
    <div className="rv-talk-words"><small>At {clock(pinned)} · {clock(voiceSeconds)}</small><p>{voiceWords || "Listening. Say what is wrong."}</p></div>
    <button type="button" className="rv-go" disabled={busy} onClick={() => void endVoice(false)}>Save, next <kbd>⏎</kbd></button>
    <button type="button" className="rv-quiet" disabled={busy} onClick={() => void endVoice(true)}>Save, more to say <kbd>M</kbd></button>
    <button type="button" className="rv-quiet" onClick={cancelNote}>Cancel <kbd>Esc</kbd></button>
  </div>;
  else if (panel === "type") actions = <div className="rv-talk">
    <span className="rv-meter is-still" aria-hidden="true"><Keyboard size={20} /></span>
    <div className="rv-talk-words"><small>At {clock(pinned)}</small>
      <textarea ref={typeBox} value={typed} maxLength={4000} placeholder="What is wrong here?" onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveTyped(false); } else if (e.key === "Escape") cancelNote(); }} /></div>
    <button type="button" className="rv-go" disabled={busy || !typed.trim()} onClick={() => saveTyped(false)}>Save, next <kbd>⏎</kbd></button>
    <button type="button" className="rv-quiet" disabled={busy || !typed.trim()} onClick={() => saveTyped(true)}>Save, more to say</button>
    <button type="button" className="rv-quiet" onClick={cancelNote}>Cancel <kbd>Esc</kbd></button>
  </div>;
  else actions = <div className="rv-answers">
    {hasOpen
      ? <button type="button" className="rv-answer is-next" data-testid="rv-next" disabled={busy} onClick={() => clip && goNext(clip.id)}><ArrowRight size={22} aria-hidden="true" /><span>Next clip</span><kbd>⏎</kbd></button>
      : <button type="button" className="rv-answer is-good" data-testid="rv-good" disabled={busy} onClick={() => void answer("good")}><Check size={22} aria-hidden="true" /><span>{recheck ? "Fixed" : "Looks good"}</span><kbd>G</kbd></button>}
    <button type="button" className="rv-answer is-voice" data-testid="rv-voice" disabled={busy} onClick={() => void startVoice()}><Mic size={22} aria-hidden="true" /><span>{hasOpen ? "Another note" : recheck ? "Still wrong" : "Voice note"}</span><kbd>V</kbd></button>
    {!hasOpen && <button type="button" className="rv-answer is-skip" data-testid="rv-skip" disabled={busy} onClick={() => void answer("skipped")}><SkipForward size={22} aria-hidden="true" /><span>Skip</span><kbd>S</kbd></button>}
    <button type="button" className="rv-type" data-testid="rv-type" onClick={startTyping}><Keyboard size={14} aria-hidden="true" /> Type instead <kbd>T</kbd></button>
  </div>;

  return <main id="main-content" className="rv" data-testid="review-inbox">
    <header className="rv-top">
      <h1>Review</h1>
      <div className="rv-fronts" role="group" aria-label="Fronts">
        {fronts.length > 1 && <button type="button" aria-pressed={front === "all"} onClick={() => pickFront("all")}>All</button>}
        {fronts.map((f) => <button key={f.id} type="button" aria-pressed={front === f.id || fronts.length === 1} onClick={() => pickFront(f.id)}>{f.label}{f.left > 0 && <b>{f.left}</b>}</button>)}
      </div>
      <span className="rv-left" data-testid="rv-left"><b>{left}</b> to go</span>
      <button type="button" className="rv-mini" disabled={!history.length || busy} onClick={() => void undo()} title="Take back your last answer"><Undo2 size={13} aria-hidden="true" /> Undo <kbd>Z</kbd></button>
    </header>

    {clip ? <>
      <section className="rv-stage">
        <video ref={video} key={`${clip.id}-${showBefore ? "before" : "now"}-${clip.round}`} src={showBefore && clip.before ? clip.before : clip.video} poster={clip.poster} autoPlay muted loop playsInline
          onClick={togglePlay} onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)} onPlay={() => setPaused(false)} onPause={() => setPaused(true)} data-testid="rv-video" />
        {recheck && <span className="rv-banner"><RotateCcw size={14} aria-hidden="true" /> Fixed · check again</span>}
        {(clip.state === "good" || clip.state === "skipped") && <span className="rv-banner is-done">{STATE_WORDS[clip.state]}</span>}
        {clip.before && <button type="button" className="rv-before" aria-pressed={showBefore} onClick={() => setShowBefore((b) => !b)}>{showBefore ? "Before the fix" : "After the fix"} <kbd>B</kbd></button>}
      </section>

      <div className="rv-timeline">
        <button type="button" className="rv-play" onClick={togglePlay} aria-label={paused ? "Play" : "Pause"}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>
        <div className="rv-track" role="slider" tabIndex={-1} aria-label="Position in the clip" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={0}
          onPointerDown={(e) => { const box = e.currentTarget.getBoundingClientRect(); const at = (x: number) => seek(((x - box.left) / box.width) * total); at(e.clientX); const move = (m: PointerEvent) => at(m.clientX); const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); }}>
          <i ref={(el) => { fill.current = el; }} />
          {suspects.map((s) => <span key={`s${s.index}`} className="rv-mark is-suspect" style={mark(s.t)} title={s.text} />)}
          {clipNotes.map((n) => <span key={n.id} className={`rv-mark is-${n.state}`} style={mark(n.t)} title={n.text} />)}
          {panel !== "watch" && <span className="rv-mark is-pin" style={mark(pinned)} />}
        </div>
        <span className="rv-time" ref={timeLabel}>0:00 / {clock(total)}</span>
      </div>

      <div className="rv-facts">
        {clip.sides?.[0] ? <Side side={clip.sides[0]} /> : <span />}
        <div className="rv-what">
          {clip.mode && <span className="rv-mode"><ModeIcon size={15} aria-hidden="true" /> {clip.mode.label}</span>}
          <h2>{clip.title}</h2>
          {clip.why && <p>{clip.why}</p>}
          <small>
            {clip.chips?.map((c) => <span key={c.label}>{c.label} <b>{c.value}</b></span>)}
            <span title={[clip.build.page && `page ${clip.build.page}`, clip.build.runtime, clip.build.data].filter(Boolean).join(" · ")}>{clip.build.label}</span>
            {clip.repro?.link && <a href={clip.repro.link} target="_blank" rel="noreferrer">Open this fight <ExternalLink size={11} aria-hidden="true" /></a>}
          </small>
        </div>
        {clip.sides?.[1] ? <Side side={clip.sides[1]} end /> : <span />}
      </div>

      {(suspects.length > 0 || answered.length > 0 || mine.length > 0) && <div className="rv-notes">
        {answered.map((n) => <div key={n.id} className="rv-note is-recheck">
          <button type="button" className="rv-at" onClick={() => seek(n.t)}>{clock(n.t)}</button>
          <div><p>You: {n.text || "(voice note)"}</p>{n.reply && <p className="rv-reply">Fixed: {n.reply}{n.fixedIn ? ` (${n.fixedIn})` : ""}</p>}</div>
          {db && <NoteSound db={db} clipId={clip.id} note={n} />}
        </div>)}
        {suspects.map((s) => <div key={`s${s.index}`} className="rv-note is-suspect" data-testid="rv-suspect">
          <button type="button" className="rv-at" onClick={() => seek(s.t)}>{clock(s.t)}</button>
          <div><p><em>Claude suspects</em> {s.text}</p></div>
          <button type="button" className="rv-mini is-bad" disabled={busy} onClick={() => confirmSuspect(s.index)} title="Yes, that is wrong"><ThumbsDown size={13} aria-hidden="true" /> Wrong</button>
          <button type="button" className="rv-mini" disabled={busy} onClick={() => void waveOff(s.index)} title="No, that is fine"><ThumbsUp size={13} aria-hidden="true" /> Fine</button>
        </div>)}
        {mine.map((n) => <div key={n.id} className={`rv-note is-${n.state}`} data-testid="rv-note">
          <button type="button" className="rv-at" onClick={() => seek(n.t)}>{clock(n.t)}</button>
          <div><p>{n.text || "Voice note saved. The words will be added from the audio."}</p></div>
          {db && <NoteSound db={db} clipId={clip.id} note={n} />}
          {n.state === "open" && <button type="button" className="rv-mini" onClick={() => void removeNote(n)} title="Remove this note" aria-label="Remove this note"><X size={13} aria-hidden="true" /></button>}
          {n.state === "fixed" && <CircleCheck size={15} className="rv-ok" aria-label="Fixed" />}
        </div>)}
      </div>}

      {(error || voiceProblem) && <p className="rv-error" role="alert">{error || voiceProblem}</p>}
      {actions}
    </> : <section className="rv-done" data-testid="rv-done">
      <CircleCheck size={54} aria-hidden="true" />
      <h2>{clips.length ? "All caught up" : "No clips yet"}</h2>
      {clips.length > 0 && <div className="rv-tally"><span className="is-good"><b>{counts.good}</b> look good</span><span className="is-noted"><b>{counts.noted}</b> with notes</span><span className="is-skip"><b>{counts.skipped}</b> skipped</span></div>}
      <p>{clips.length ? "Your notes are read by the sessions working on the game. What they fix comes back here to check again." : "Clips appear here when a session films them."}</p>
      {error && <p className="rv-error" role="alert">{error}</p>}
    </section>}

    {strip.length > 0 && <nav className="rv-strip" aria-label="Clips">
      {strip.map((c) => <button key={c.id} type="button" className={`is-${c.state}`} aria-current={c.id === currentId ? "true" : undefined} title={`${c.title} · ${STATE_WORDS[c.state]}`} onClick={() => openClip(c.id)}>
        {c.poster ? <img src={c.poster} alt="" loading="lazy" /> : <span>{frontLabel(c.front)}</span>}
        {c.sides && <span className="rv-strip-flags">{c.sides.map((s, i) => s.flag ? <img key={i} src={s.flag} alt="" /> : null)}</span>}
        <i aria-hidden="true">{c.state === "good" ? <Check size={11} /> : c.state === "skipped" ? <SkipForward size={11} /> : c.state === "noted" ? <Mic size={11} /> : c.state === "recheck" ? <RotateCcw size={11} /> : null}</i>
      </button>)}
    </nav>}
  </main>;
}
