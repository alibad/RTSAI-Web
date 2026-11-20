"use client";
/**
 * The Review inbox (owner, 20 November 2026): one clip of the game at a time, large and playing, with who is fighting
 * whom shown as flags and unit icons. Three answers, each one click or key, then the next clip: Looks good (G),
 * Skip (S), or a voice note (V) pinned to the second where the owner started talking and saved as audio with its
 * transcript. T types instead. Clips a session fixed come back first, as "fixed, check again".
 *
 * A note can carry pictures, with the site's feedback parts (app/components/feedback): "Grab this frame" (F) takes the
 * clip's frame at the note's second into the markup editor to circle what is wrong; Ctrl+V pastes a screenshot (it
 * opens a typed note when none is open); a picture or video can be dropped or picked.
 *
 * One screen, never a scroll (owner, 20 Nov 2026: "make me something usable"): the clip as large as the window
 * allows; one title line with "3 of 30" and prev/next (P, N); the session's suspects and the owner's notes as
 * numbered markers on the scrubber, each shown over the clip at its moment (click a marker, or 1-9, to jump there);
 * the answers in one bar under the clip, between the two sides' flags and units. A short, wide window (a laptop,
 * a browser beside other windows) puts the title and answers in a column beside the clip instead.
 *
 * A clip belongs to a front (battles, campaign, AI, ...): every session can add clips (tools/review.mjs add) and read
 * the answers (tools/review.mjs feedback). Data and its owner-only rule: lib/review/model.ts, firestore.rules.
 */
/* eslint-disable @next/next/no-img-element -- flags, unit icons and posters are small static files named by the clip. */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Firestore } from "firebase/firestore";
import {
  Anchor, ArrowRight, Building2, Camera, Check, ChevronLeft, ChevronRight, CircleCheck, Crosshair, ExternalLink, Footprints, Image as ImageIcon, Keyboard, Mic, MoveRight, Pause, Plane, Play,
  Radar, RotateCcw, Shield, Ship, SkipForward, Swords, Target, ThumbsDown, ThumbsUp, Truck, Undo2, Volume2, X, Zap,
} from "lucide-react";
import { useAuth } from "../AuthProvider";
import { DropZone, FileChips, ShotStrip, usePastedFiles } from "../feedback/FeedbackMedia";
import { ScreenshotAnnotator } from "../feedback/ScreenshotAnnotator";
import { OptionSelect, type Option } from "../ui/fields";
import { captureTab, checkAttachment, isCoarsePointer, MAX_SCREENSHOTS, toJpeg, withWidgetHidden } from "../feedback/media";
import { getFirebaseAuth, getFirebaseFirestore } from "../../../lib/firebase-client";
import { OWNER_EMAILS } from "../../../lib/admin";
import { clock, frontLabel, inboxOrder, waiting, type ClipSide, type ClipState, type ClipUnit, type NoteFile, type NoteState, type ReviewClip, type ReviewNote } from "../../../lib/review/model";
import { addNote, answerClip, deleteNote, dismissSuspect, loadClips, loadNotes, noteAudio, noteFile, updateNote, type NoteAttachment } from "../../../lib/review/store";
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

/** A unit as the game's build icon, with how many fight; its name on hover. */
function Unit({ unit }: { unit: ClipUnit }) {
  const Icon = CLASS_ICONS[unit.cls ?? "vehicle"] ?? Truck;
  return <span className="rv-unit" title={`${unit.count} × ${unit.name}`}>
    {unit.icon ? <img src={unit.icon} alt={unit.name} width={46} height={36} loading="lazy" /> : <Icon size={20} aria-label={unit.name} />}{unit.count > 1 && <b>×{unit.count}</b>}
  </span>;
}

/** One side of the fight, small: its flag, then its units. */
function SideMini({ side, end }: { side: ClipSide; end?: boolean }) {
  return <div className={end ? "rv-vs is-end" : "rv-vs"} title={`${side.name}: ${side.units.map((u) => `${u.count} × ${u.name}`).join(", ")}`}>
    {side.flag ? <img className="rv-vs-flag" src={side.flag} alt={side.name} width={39} height={26} /> : <i className="rv-vs-flag">{side.name.slice(0, 2)}</i>}
    {side.units.map((u) => <Unit key={u.id} unit={u} />)}
  </div>;
}

/** A moment of the clip: a session's suspect (numbered), the owner's note, or a note sent back as fixed. */
type Moment = { key: string; t: number; kind: "suspect" | "note" | "recheck"; text: string; n?: number; index?: number; note?: ReviewNote };

/** Each front's colour dot in the front picker. */
const FRONT_COLOURS: Record<string, string> = {
  battles: "#ef5b3f", campaign: "#f1d28b", ai: "#7fb2ff", "ai-opponent": "#7fb2ff", multiplayer: "#86d67c", maps: "#4fc3b0",
  art: "#c79bff", sound: "#ff9fc8", "look-and-sound": "#ff9fc8", site: "#a4a898", "first-five-min": "#ffb347", "first-session": "#ffb347",
  "maker-tools": "#4fc3b0", "release-check": "#a4a898",
};
const frontColour = (id: string) => FRONT_COLOURS[id] ?? `hsl(${[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)} 60% 62%)`;

/** A voice note's own audio, fetched when asked for. */
function NoteSound({ db, clipId, note }: { db: Firestore; clipId: string; note: ReviewNote }) {
  const [url, setUrl] = useState("");
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (!note.audio) return null;
  // eslint-disable-next-line jsx-a11y/media-has-caption -- the owner's own voice note; its transcript is the text beside it.
  if (url) return <audio className="rv-note-audio" src={url} controls autoPlay />;
  return <button type="button" className="rv-mini" title="Hear this note" onClick={async () => { const blob = await noteAudio(db, clipId, note); if (blob) setUrl(URL.createObjectURL(blob)); }}><Volume2 size={13} aria-hidden="true" /> {clock(note.audio.seconds)}</button>;
}

/** A note's pictures and videos, fetched when asked for. */
function NoteFiles({ db, clipId, files }: { db: Firestore; clipId: string; files: NoteFile[] }) {
  const [loaded, setLoaded] = useState<{ file: NoteFile; url: string }[] | null>(null);
  useEffect(() => () => { for (const l of loaded ?? []) URL.revokeObjectURL(l.url); }, [loaded]);
  if (!loaded) return <button type="button" className="rv-mini" title="See the pictures in this note" onClick={async () => {
    const blobs = await Promise.all(files.map((f) => noteFile(db, clipId, f)));
    setLoaded(files.flatMap((file, i) => (blobs[i] ? [{ file, url: URL.createObjectURL(blobs[i]) }] : [])));
  }}><ImageIcon size={13} aria-hidden="true" /> {files.length}</button>;
  return <span className="rv-note-files">{loaded.map(({ file, url }) => file.kind === "picture"
    ? <a key={file.id} href={url} target="_blank" rel="noreferrer" title={file.name}><img src={url} alt={file.name} /></a>
    // eslint-disable-next-line jsx-a11y/media-has-caption -- a video the owner attached to their own note.
    : <video key={file.id} src={url} controls title={file.name} />)}</span>;
}

/** One frame of a clip, as a PNG. The clip is read again with CORS, so the frame can be read back out of a canvas. */
async function clipFrame(src: string, at: number): Promise<Blob> {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous"; v.muted = true; v.preload = "auto"; v.playsInline = true;
  const settle = (event: "loadeddata" | "seeked") => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event}`)), 15000);
    v.addEventListener(event, () => { clearTimeout(timer); resolve(); }, { once: true });
    v.addEventListener("error", () => { clearTimeout(timer); reject(new Error("the clip could not be read")); }, { once: true });
  });
  try {
    const loaded = settle("loadeddata");
    v.src = src;
    await loaded;
    const seeked = settle("seeked");
    v.currentTime = Math.max(0.01, Math.min(at, (v.duration || at + 1) - 0.05));
    await seeked;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    // Throws when the clip's host does not allow reading its pixels; the caller falls back to the tab capture.
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("empty frame");
    return blob;
  } finally { v.removeAttribute("src"); v.load(); }
}

type Attachment = NoteAttachment & { id: string; url: string };
let attachmentSeq = 0;

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
  /** The clip's second, a few times a second: which suspect or note shows over the clip now. */
  const [now, setNow] = useState(0);
  /** A marker the owner clicked: its sentence stays over the clip. */
  const [focus, setFocus] = useState<string | null>(null);
  const [length, setLength] = useState(0);
  const [paused, setPaused] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const fill = useRef<HTMLElement | null>(null);
  const timeLabel = useRef<HTMLSpanElement | null>(null);
  // A voice note at the ten-minute limit is saved, and the owner stays on the clip.
  const atLimit = useRef(() => {});
  const { words: voiceWords, seconds: voiceSeconds, limit: voiceLimit, problem: voiceProblem, meterRef, start: voiceStart, stop: voiceStop, cancel: voiceCancel } = useVoiceNote({ onLimit: () => atLimit.current() });
  // The note's pictures and videos, and the one being marked up.
  const [pics, setPics] = useState<Attachment[]>([]);
  const picsRef = useRef<Attachment[]>([]);
  const [annotating, setAnnotating] = useState<{ src: string; owned: boolean; name: string; replace?: string } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

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

  // ---- a note's pictures
  const setAttachments = useCallback((next: Attachment[]) => {
    for (const old of picsRef.current) if (!next.includes(old)) URL.revokeObjectURL(old.url);
    picsRef.current = next;
    setPics(next);
  }, []);
  const addAttachment = useCallback((a: NoteAttachment) => setAttachments([...picsRef.current, { ...a, id: `a${++attachmentSeq}`, url: URL.createObjectURL(a.blob) }]), [setAttachments]);
  useEffect(() => () => { for (const a of picsRef.current) URL.revokeObjectURL(a.url); }, []);

  // A new clip starts from its beginning, playing, with nothing half-said.
  const openClip = useCallback((id: string | null) => { setCurrentId(id); setPanel("watch"); setTyped(""); setAttachments([]); setShowBefore(false); setLength(0); setPaused(false); setFocus(null); setNow(0); }, [setAttachments]);
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
  useEffect(() => {
    const id = setInterval(() => { const t = video.current?.currentTime ?? 0; setNow((was) => (Math.abs(was - t) > 0.1 ? t : was)); }, 200);
    return () => clearInterval(id);
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

  const saveNote = useCallback(async (input: { t: number; text: string; said: ReviewNote["said"]; transcript: ReviewNote["transcript"]; voice?: { blob: Blob; seconds: number }; files?: NoteAttachment[] }, stay: boolean) => {
    if (!db || !clip) return;
    setBusy(true); setError("");
    try {
      const note = await addNote(db, clip.id, { ...input, round: clip.round });
      if (input.files?.length) setAttachments([]);
      // A new note on a clip that came back fixed means the fix did not land: its earlier notes are open again.
      const reopened = clipNotes.filter((n) => n.state === "recheck");
      for (const n of reopened) await updateNote(db, clip.id, n.id, { state: "open" });
      if (clip.state !== "noted") await answerClip(db, clip.id, "noted");
      setNotes((all) => ({ ...all, [clip.id]: [...(all[clip.id] ?? []).map((n) => (reopened.includes(n) ? { ...n, state: "open" as const } : n)), note].sort((a, b) => a.t - b.t) }));
      patchClip(clip.id, { state: "noted" });
      setPanel("watch"); setTyped("");
      if (stay) void video.current?.play().catch(() => {}); else goNext(clip.id, { [clip.id]: "noted" });
    } catch (e) { fail(e); } finally { setBusy(false); }
  }, [db, clip, clipNotes, patchClip, goNext, fail, setAttachments]);

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
    await saveNote({ t: pinned, text: take.text, said: "voice", transcript: take.text ? "browser" : "none", voice: { blob: take.blob, seconds: take.seconds }, files: picsRef.current }, stay);
  }, [voiceStop, saveNote, pinned]);
  useEffect(() => { atLimit.current = () => void endVoice(true); });
  const cancelNote = useCallback(() => { voiceCancel(); setPanel("watch"); setTyped(""); setAttachments([]); void video.current?.play().catch(() => {}); }, [voiceCancel, setAttachments]);
  /** Opens a typed note at the clip's current second; returns that second, or null when a note cannot start now. */
  const startTyping = useCallback(() => {
    if (!clip || busy || panel !== "watch") return null;
    const at = video.current?.currentTime ?? 0;
    setPinned(at); video.current?.pause(); setPanel("type");
    return at;
  }, [clip, busy, panel]);
  const canSaveTyped = !!typed.trim() || pics.length > 0;
  const saveTyped = useCallback((stay: boolean) => { if (typed.trim() || picsRef.current.length) void saveNote({ t: pinned, text: typed, said: "typed", transcript: "typed", files: picsRef.current }, stay); }, [typed, pinned, saveNote]);

  // ---- pictures: grab the clip's frame, paste, drop or pick; one picture opens in the markup editor
  const room = MAX_SCREENSHOTS - pics.length;
  const grabFrame = useCallback(async (at: number) => {
    if (!clip || grabbing || picsRef.current.length >= MAX_SCREENSHOTS) return;
    setGrabbing(true); setError("");
    const name = `frame-${clock(at).replace(":", "m")}s.jpg`;
    try {
      let blob: Blob | null;
      try { blob = await clipFrame(showBefore && clip.before ? clip.before : clip.video, at); }
      catch {
        // The clip's host does not let the page read its pixels: take this tab instead (the browser asks once).
        const frame = await withWidgetHidden(captureTab);
        blob = await new Promise<Blob | null>((resolve) => frame.toBlob(resolve, "image/png"));
      }
      if (!blob) throw new Error("empty");
      setAnnotating({ src: URL.createObjectURL(blob), owned: true, name });
    } catch { setError("The frame could not be taken. Paste a screenshot instead (Ctrl+V)."); }
    finally { setGrabbing(false); }
  }, [clip, grabbing, showBefore]);
  const addFiles = useCallback(async (files: File[]) => {
    setError("");
    let left = MAX_SCREENSHOTS - picsRef.current.length;
    let markUp = files.length === 1 && !isCoarsePointer();
    for (const file of files) {
      const check = checkAttachment(file);
      if (!check.ok) { setError(check.error); continue; }
      const picture = check.contentType.startsWith("image/"), clipFile = check.contentType.startsWith("video/");
      if (!picture && !clipFile) { setError(`“${file.name}” can’t go in a note: pictures and videos only.`); continue; }
      if (left <= 0) { setError(`Up to ${MAX_SCREENSHOTS} pictures or videos in one note.`); break; }
      left--;
      if (picture && markUp) { setAnnotating({ src: URL.createObjectURL(file), owned: true, name: file.name.replace(/\.[^.]+$/, ".jpg") }); markUp = false; continue; }
      if (picture) {
        try { const jpeg = await toJpeg(await createImageBitmap(file)); addAttachment({ blob: jpeg.blob, kind: "picture", type: "image/jpeg", name: file.name.replace(/\.[^.]+$/, ".jpg"), width: jpeg.width, height: jpeg.height }); }
        catch { setError(`“${file.name}” could not be read.`); }
      } else addAttachment({ blob: file, kind: "video", type: check.contentType, name: file.name });
    }
  }, [addAttachment]);
  const finishMarkup = useCallback((result: { blob: Blob; width: number; height: number } | null) => {
    const open = annotating;
    if (!open) return;
    if (result) {
      const made: NoteAttachment = { blob: result.blob, kind: "picture", type: "image/jpeg", name: open.name, width: result.width, height: result.height };
      if (open.replace) setAttachments(picsRef.current.map((a) => (a.id === open.replace ? { ...made, id: a.id, url: URL.createObjectURL(made.blob) } : a)));
      else addAttachment(made);
    }
    if (open.owned) URL.revokeObjectURL(open.src);
    setAnnotating(null);
    // Back to the words, so Enter saves the note.
    requestAnimationFrame(() => typeBox.current?.focus());
  }, [annotating, addAttachment, setAttachments]);
  // Ctrl+V anywhere: the picture goes into the open note, or opens a typed note at this second.
  usePastedFiles(!!clip && !annotating && !busy, (files) => { if (panel === "watch" && startTyping() === null) return; void addFiles(files); });

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

  // ---- the clip's moments: suspects not answered yet (numbered), the owner's notes, notes sent back as fixed
  const moments = useMemo<Moment[]>(() => {
    if (!clip) return [];
    const open = clip.suspects.map((s, index) => ({ ...s, index })).filter((s) => !clip.dismissed.includes(s.index) && !clipNotes.some((n) => n.said === "suspect" && n.text === s.text)).sort((a, b) => a.t - b.t);
    return [
      ...open.map((s, i) => ({ key: `s${s.index}`, t: s.t, kind: "suspect" as const, text: s.text, n: i + 1, index: s.index })),
      ...clipNotes.map((n) => ({ key: n.id, t: n.t, kind: n.state === "recheck" ? "recheck" as const : "note" as const, text: n.text || (n.audio ? "Voice note saved. The words will be added from the audio." : "Pictures saved."), note: n })),
    ];
  }, [clip, clipNotes]);
  const numbered = useMemo(() => moments.filter((m) => m.n), [moments]);

  // ---- keys: the whole inbox works without the mouse
  const hasOpen = clipNotes.some((n) => n.state === "open");
  const step = useCallback((dir: 1 | -1) => {
    const ids = strip.map((c) => c.id);
    if (!ids.length) return;
    const at = clip ? ids.indexOf(clip.id) : -1;
    openClip(ids[(at + dir + ids.length) % ids.length]);
  }, [strip, clip, openClip]);
  const jump = useCallback((m: Moment) => { setFocus(m.key); seek(Math.max(0, m.t - 1)); void video.current?.play().catch(() => {}); }, [seek]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The markup editor has its own keys.
      if (e.metaKey || e.ctrlKey || e.altKey || annotating) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (panel === "voice") {
        if (key === "Enter" || key === "v") { e.preventDefault(); void endVoice(false); }
        else if (key === "m") { e.preventDefault(); void endVoice(true); }
        else if (key === "f") { e.preventDefault(); void grabFrame(pinned); }
        else if (key === "Escape") { e.preventDefault(); cancelNote(); }
        return;
      }
      if (panel !== "watch") { if (key === "z") void undo(); return; }
      if (key === "n") { e.preventDefault(); step(1); return; }
      if (key === "p") { e.preventDefault(); step(-1); return; }
      if (key === "z") { e.preventDefault(); void undo(); return; }
      if (!clip) return;
      if (key === "v") { e.preventDefault(); void startVoice(); }
      else if (key === "t") { e.preventDefault(); startTyping(); }
      else if (key === "f") { e.preventDefault(); const at = startTyping(); if (at !== null) void grabFrame(at); }
      else if (key === "g" || (key === "Enter" && !hasOpen)) { e.preventDefault(); if (!hasOpen) void answer("good"); }
      else if (key === "Enter") { e.preventDefault(); goNext(clip.id); }
      else if (key === "s") { e.preventDefault(); if (!hasOpen) void answer("skipped"); }
      else if (key === " " || key === "k") { e.preventDefault(); togglePlay(); }
      else if (key === "ArrowLeft") { e.preventDefault(); seek((video.current?.currentTime ?? 0) - 1); }
      else if (key === "ArrowRight") { e.preventDefault(); seek((video.current?.currentTime ?? 0) + 1); }
      else if (key === "b" && clip.before) { e.preventDefault(); setShowBefore((b) => !b); }
      else if (key === "Escape") setFocus(null);
      else if (/^[1-9]$/.test(key) && numbered[Number(key) - 1]) { e.preventDefault(); jump(numbered[Number(key) - 1]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, clip, hasOpen, annotating, pinned, numbered, answer, startVoice, startTyping, endVoice, cancelNote, grabFrame, goNext, undo, togglePlay, seek, step, jump]);

  // ---- what to draw
  if (!user && !authLoading) return <main id="main-content" className="rv rv-empty"><div className="rv-card">
    <h1>Review inbox</h1><p>{PREVIEW ? "Opening the preview…" : "Sign in as the owner to open it."}</p>
    {!PREVIEW && <button type="button" className="rv-go" onClick={() => openAuth("Sign in to open the Review inbox")}>Sign in</button>}
  </div></main>;
  if (!clips) return <main id="main-content" className="rv rv-empty" aria-busy="true"><div className="rv-card"><p>Loading the inbox…</p></div></main>;

  const total = clip ? length || clip.seconds || 1 : 1;
  const recheck = clip?.state === "recheck";
  const ModeIcon = MODE_ICONS[clip?.mode?.id ?? ""] ?? Swords;
  const mark = (t: number) => ({ left: `${Math.min(100, (t / total) * 100)}%` }) as CSSProperties;
  const counts = { good: strip.filter((c) => c.state === "good").length, noted: strip.filter((c) => c.state === "noted").length, skipped: strip.filter((c) => c.state === "skipped").length };
  const pos = clip ? strip.findIndex((c) => c.id === clip.id) + 1 : 0;
  // What shows over the clip: the moment a marker was clicked for, else what is happening now (each sentence from
  // just before its second to a few seconds after it, as subtitles). A fixed clip opens on what was fixed.
  const shown = moments.filter((m) => (focus ? m.key === focus : (now >= m.t - 0.3 && now <= m.t + 3.5) || (m.kind === "recheck" && now < 5)));
  const facts = clip ? [...(clip.chips ?? []).map((c) => `${c.label}: ${c.value}`), clip.build.label, ...[clip.build.page && `page ${clip.build.page}`, clip.build.runtime, clip.build.data].filter(Boolean)].join(" · ") : "";

  // The note's pictures: grab the clip's frame, the ones added so far (click to mark up), and paste, drop or pick.
  const pictures = <div className="rv-pics" data-testid="rv-pics">
    <button type="button" className="rv-grab" data-testid="rv-grab" disabled={grabbing || room <= 0} onClick={() => void grabFrame(pinned)}
      title="Take the clip's picture at this second, then circle what is wrong"><Camera size={16} aria-hidden="true" /> {grabbing ? "Taking the frame…" : "Grab this frame"}{panel === "voice" && <kbd>F</kbd>}</button>
    <ShotStrip shots={pics.filter((a) => a.kind === "picture").map((a) => ({ id: a.id, url: a.url }))}
      onMarkUp={(id) => { const a = pics.find((p) => p.id === id); if (a) setAnnotating({ src: a.url, owned: false, name: a.name, replace: id }); }}
      onRemove={(id) => setAttachments(picsRef.current.filter((a) => a.id !== id))} />
    <FileChips files={pics.filter((a) => a.kind === "video").map((a) => ({ id: a.id, name: a.name, size: a.blob.size, contentType: a.type }))}
      onRemove={(id) => setAttachments(picsRef.current.filter((a) => a.id !== id))} />
    {room > 0 && <DropZone onFiles={(files) => void addFiles(files)} label="Paste a screenshot (Ctrl+V), drop one, or pick a picture or video" />}
  </div>;
  // Save says what it waits for when there is nothing to save yet.
  const saveLabel = (ready: boolean) => (busy ? "Saving…" : ready ? <>Save, next <kbd>⏎</kbd></> : "Type a note or add a picture first");

  let actions: ReactNode;
  if (panel === "voice") actions = <div className="rv-talk" data-testid="rv-recording">
    <div className="rv-talk-row">
      <span className="rv-meter" ref={meterRef} aria-hidden="true"><Mic size={22} /></span>
      <div className="rv-talk-words"><small>At {clock(pinned)} · {clock(voiceSeconds)}{voiceSeconds > voiceLimit - 60 ? ` · saves itself at ${clock(voiceLimit)}` : ""}</small><p>{voiceWords || "Listening. Say what is wrong."}</p></div>
      <div className="rv-talk-buttons">
        <button type="button" className="rv-go" data-testid="rv-save" disabled={busy} aria-busy={busy} onClick={() => void endVoice(false)}>{saveLabel(true)}</button>
        <button type="button" className="rv-quiet" disabled={busy} onClick={() => void endVoice(true)}>Save, more to say <kbd>M</kbd></button>
        <button type="button" className="rv-quiet" onClick={cancelNote}>Cancel <kbd>Esc</kbd></button>
      </div>
    </div>
    {pictures}
  </div>;
  else if (panel === "type") actions = <div className="rv-talk" data-testid="rv-typing">
    <div className="rv-talk-row">
      <span className="rv-meter is-still" aria-hidden="true"><Keyboard size={20} /></span>
      <div className="rv-talk-words"><small>At {clock(pinned)}</small>
        <textarea ref={typeBox} value={typed} maxLength={4000} placeholder="What is wrong here?" onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveTyped(false); } else if (e.key === "Escape") cancelNote(); }} /></div>
      <div className="rv-talk-buttons">
        <button type="button" className="rv-go" data-testid="rv-save" disabled={busy || !canSaveTyped} aria-busy={busy} onClick={() => saveTyped(false)}>{saveLabel(canSaveTyped)}</button>
        <button type="button" className="rv-quiet" disabled={busy || !canSaveTyped} onClick={() => saveTyped(true)}>Save, more to say</button>
        <button type="button" className="rv-quiet" onClick={cancelNote}>Cancel <kbd>Esc</kbd></button>
      </div>
    </div>
    {pictures}
  </div>;
  else actions = <div className="rv-answers">
    {hasOpen
      ? <button type="button" className="rv-answer is-next" data-testid="rv-next" disabled={busy} onClick={() => clip && goNext(clip.id)}><ArrowRight size={20} aria-hidden="true" /><span>Next clip</span><kbd>⏎</kbd></button>
      : <button type="button" className="rv-answer is-good" data-testid="rv-good" disabled={busy} onClick={() => void answer("good")}><Check size={20} aria-hidden="true" /><span>{recheck ? "Fixed" : "Looks good"}</span><kbd>G</kbd></button>}
    <button type="button" className="rv-answer is-voice" data-testid="rv-voice" disabled={busy} onClick={() => void startVoice()}><Mic size={20} aria-hidden="true" /><span>{hasOpen ? "Another note" : recheck ? "Still wrong" : "Voice note"}</span><kbd>V</kbd></button>
    {!hasOpen && <button type="button" className="rv-answer is-skip" data-testid="rv-skip" disabled={busy} onClick={() => void answer("skipped")}><SkipForward size={20} aria-hidden="true" /><span>Skip</span><kbd>S</kbd></button>}
    <button type="button" className="rv-type" data-testid="rv-type" onClick={startTyping} title="Type instead (T); Ctrl+V pastes a screenshot, F grabs this frame"><Keyboard size={14} aria-hidden="true" /> Type <kbd>T</kbd></button>
  </div>;

  const frontOptions: Option<string>[] = [
    { value: "all", label: "All fronts", description: `${(clips ?? []).filter(waiting).length} to go`, leading: <span className="rv-dot" style={{ background: "#f0eee6" }} /> },
    ...fronts.map((f) => ({ value: f.id, label: f.label, description: f.left ? `${f.left} to go` : "done", leading: <span className="rv-dot" style={{ background: frontColour(f.id) }} /> })),
  ];

  return <main id="main-content" className="rv" data-testid="review-inbox">
    <div className={`rv-grid${panel !== "watch" ? " is-talking" : ""}`}>
      <header className="rv-head">
        <div className="rv-nav" role="group" aria-label="Clips">
          <button type="button" aria-label="Previous clip (P)" title="Previous clip (P)" disabled={!strip.length} onClick={() => step(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
          <span data-testid="rv-pos">{clip ? <><b>{pos}</b> of {strip.length}</> : `${strip.length} clips`}</span>
          <button type="button" aria-label="Next clip (N)" title="Next clip (N)" disabled={!strip.length} onClick={() => step(1)}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
        {clip && <div className="rv-name">
          {clip.mode && <span className="rv-mode" title={clip.mode.label}><ModeIcon size={14} aria-hidden="true" /> {clip.mode.label}</span>}
          <h2 title={clip.title}>{clip.title}</h2>
          {clip.why && <p title={clip.why}>{clip.why}</p>}
        </div>}
        <div className="rv-tools">
          <span className="rv-left" data-testid="rv-left"><b>{left}</b> to go</span>
          {fronts.length > 1 && <OptionSelect<string> size="sm" aria-label="Front" value={front} onValueChange={pickFront} options={frontOptions} className="rv-front" />}
          {clip?.repro?.link && <a className="rv-mini" href={clip.repro.link} target="_blank" rel="noreferrer" title={`Open this fight in the game. ${facts}`}><ExternalLink size={13} aria-hidden="true" /> Fight</a>}
          <button type="button" className="rv-mini" disabled={!history.length || busy} onClick={() => void undo()} title="Take back your last answer (Z)"><Undo2 size={13} aria-hidden="true" /> Undo</button>
        </div>
      </header>

      {clip ? <>
        <section className="rv-stage">
          <video ref={video} key={`${clip.id}-${showBefore ? "before" : "now"}-${clip.round}`} src={showBefore && clip.before ? clip.before : clip.video} poster={clip.poster} autoPlay muted loop playsInline
            onClick={togglePlay} onLoadedMetadata={(e) => setLength(e.currentTarget.duration || 0)} onPlay={() => setPaused(false)} onPause={() => setPaused(true)} data-testid="rv-video" />
          {recheck && <span className="rv-banner"><RotateCcw size={14} aria-hidden="true" /> Fixed · check again</span>}
          {(clip.state === "good" || clip.state === "skipped") && <span className="rv-banner is-done">{STATE_WORDS[clip.state]}</span>}
          {clip.before && <button type="button" className="rv-before" aria-pressed={showBefore} onClick={() => setShowBefore((b) => !b)}>{showBefore ? "Before the fix" : "After the fix"} <kbd>B</kbd></button>}
          {(error || voiceProblem) && <p className="rv-error" role="alert">{error || voiceProblem}</p>}
          {shown.length > 0 && <div className="rv-captions" data-testid="rv-captions">
            {shown.slice(0, 3).map((m) => <div key={m.key} className={`rv-caption is-${m.kind}`} data-testid={m.kind === "suspect" ? "rv-suspect" : "rv-note"}>
              {m.n ? <b className="rv-num">{m.n}</b> : <button type="button" className="rv-at" onClick={() => seek(m.t)}>{clock(m.t)}</button>}
              <p title={m.kind === "recheck" && m.note?.reply ? `${m.text}
Fixed: ${m.note.reply}` : m.text}>{m.kind === "suspect" ? <><em>Claude suspects</em> {m.text}</> : m.kind === "recheck" ? <>You: {m.text}{m.note?.reply && <span className="rv-reply"> Fixed: {m.note.reply}{m.note.fixedIn ? ` (${m.note.fixedIn})` : ""}</span>}</> : m.text}</p>
              {m.kind === "suspect" && m.index !== undefined && <>
                <button type="button" className="rv-mini is-bad" disabled={busy} onClick={() => { confirmSuspect(m.index!); setFocus(null); }} title="Yes, that is wrong"><ThumbsDown size={13} aria-hidden="true" /> Wrong</button>
                <button type="button" className="rv-mini" disabled={busy} onClick={() => { void waveOff(m.index!); setFocus(null); }} title="No, that is fine"><ThumbsUp size={13} aria-hidden="true" /> Fine</button>
              </>}
              {m.note && db && <NoteSound db={db} clipId={clip.id} note={m.note} />}
              {m.note?.files?.length && db ? <NoteFiles db={db} clipId={clip.id} files={m.note.files} /> : null}
              {m.note?.state === "open" && <button type="button" className="rv-mini" onClick={() => void removeNote(m.note!)} title="Remove this note" aria-label="Remove this note"><X size={13} aria-hidden="true" /></button>}
              {m.note?.state === "fixed" && <CircleCheck size={15} className="rv-ok" aria-label="Fixed" />}
              {focus === m.key && <button type="button" className="rv-mini" onClick={() => setFocus(null)} aria-label="Close" title="Close (Esc)"><X size={13} aria-hidden="true" /></button>}
            </div>)}
          </div>}
        </section>

        <div className="rv-timeline">
          <button type="button" className="rv-play" onClick={togglePlay} aria-label={paused ? "Play" : "Pause"}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>
          <div className="rv-track" role="slider" tabIndex={-1} aria-label="Position in the clip" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(now)}
            onPointerDown={(e) => { if ((e.target as HTMLElement).closest(".rv-mark")) return; const box = e.currentTarget.getBoundingClientRect(); const at = (x: number) => seek(((x - box.left) / box.width) * total); at(e.clientX); const move = (m: PointerEvent) => at(m.clientX); const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); }}>
            <i ref={(el) => { fill.current = el; }} />
            {moments.map((m) => <button key={m.key} type="button" className={`rv-mark is-${m.kind === "note" ? m.note?.state ?? "open" : m.kind}`} style={mark(m.t)}
              data-testid={m.kind === "suspect" ? "rv-marker" : "rv-note-mark"} aria-label={`${clock(m.t)}: ${m.text}`} title={`${clock(m.t)} ${m.text}`} onClick={() => jump(m)}>{m.n ?? ""}</button>)}
            {panel !== "watch" && <span className="rv-mark is-pin" style={mark(pinned)} />}
          </div>
          <span className="rv-time" ref={timeLabel}>0:00 / {clock(total)}</span>
        </div>

        <div className="rv-bar">
          {clip.sides?.[0] && <SideMini side={clip.sides[0]} />}
          {actions}
          {clip.sides?.[1] && <SideMini side={clip.sides[1]} end />}
        </div>
      </> : <section className="rv-done" data-testid="rv-done">
        <CircleCheck size={54} aria-hidden="true" />
        <h2>{clips.length ? "All caught up" : "No clips yet"}</h2>
        {clips.length > 0 && <div className="rv-tally"><span className="is-good"><b>{counts.good}</b> look good</span><span className="is-noted"><b>{counts.noted}</b> with notes</span><span className="is-skip"><b>{counts.skipped}</b> skipped</span></div>}
        <p>{clips.length ? "Your notes are read by the sessions working on the game. What they fix comes back here to check again." : "Clips appear here when a session films them."}</p>
        {error && <p className="rv-error" role="alert">{error}</p>}
      </section>}
    </div>
    {annotating && <ScreenshotAnnotator src={annotating.src} onSave={finishMarkup} onCancel={() => finishMarkup(null)} />}
  </main>;
}
