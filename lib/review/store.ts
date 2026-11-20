/**
 * The Review inbox in Firestore, from the owner's browser (lib/review/model.ts has the shape; firestore.rules lets
 * only the owner in). Sessions use tools/review.mjs instead, with the owner's Google credentials.
 */
import type { Bytes, DocumentData, Firestore } from "firebase/firestore";
import { REVIEW_CHUNK_BYTES, REVIEW_MAX_AUDIO_CHUNKS, REVIEW_MAX_TEXT, type ClipState, type NoteAudio, type ReviewClip, type ReviewNote } from "./model";

const millis = (v: unknown) => typeof (v as { toMillis?: () => number } | null)?.toMillis === "function" ? (v as { toMillis(): number }).toMillis() : typeof v === "number" ? v : 0;

function clipOf(id: string, d: DocumentData): ReviewClip {
  return {
    id, front: d.front ?? "battles", title: d.title ?? id, why: d.why ?? "", video: d.video ?? "", poster: d.poster, seconds: d.seconds ?? 0,
    sides: d.sides, mode: d.mode, chips: d.chips, repro: d.repro, build: d.build ?? { label: "" },
    suspects: d.suspects ?? [], dismissed: d.dismissed ?? [], state: d.state ?? "new", round: d.round ?? 1, before: d.before, by: d.by ?? "",
    created: millis(d.created), updated: millis(d.updated), answered: d.answered ? millis(d.answered) : undefined,
  };
}

function noteOf(id: string, d: DocumentData): ReviewNote {
  return { id, t: d.t ?? 0, text: d.text ?? "", said: d.said ?? "typed", transcript: d.transcript ?? "typed", audio: d.audio, state: d.state ?? "open", round: d.round ?? 1, reply: d.reply, fixedIn: d.fixedIn, created: millis(d.created) };
}

/** Every clip (the inbox is small: tens of clips per front). */
export async function loadClips(db: Firestore): Promise<ReviewClip[]> {
  const F = await import("firebase/firestore");
  return (await F.getDocs(F.collection(db, "reviewClips"))).docs.map((d) => clipOf(d.id, d.data()));
}

export async function loadNotes(db: Firestore, clipId: string): Promise<ReviewNote[]> {
  const F = await import("firebase/firestore");
  return (await F.getDocs(F.collection(db, "reviewClips", clipId, "notes"))).docs.map((d) => noteOf(d.id, d.data())).sort((a, b) => a.t - b.t || a.created - b.created);
}

/** The owner's answer to a clip ("new" or "recheck" takes an answer back). */
export async function answerClip(db: Firestore, clipId: string, state: ClipState) {
  const F = await import("firebase/firestore");
  await F.updateDoc(F.doc(db, "reviewClips", clipId), { state, answered: F.serverTimestamp() });
}

/** The owner says a suspect is fine. */
export async function dismissSuspect(db: Firestore, clipId: string, index: number) {
  const F = await import("firebase/firestore");
  await F.updateDoc(F.doc(db, "reviewClips", clipId), { dismissed: F.arrayUnion(index) });
}

function newId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789", random = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(random, (v) => alphabet[v % alphabet.length]).join("");
}

/** A note on a clip: its audio first (when spoken), then the note itself, so a note never points at missing audio. */
export async function addNote(db: Firestore, clipId: string, input: {
  t: number; text: string; said: ReviewNote["said"]; transcript: ReviewNote["transcript"]; round: number;
  voice?: { blob: Blob; seconds: number };
}): Promise<ReviewNote> {
  const F = await import("firebase/firestore");
  const id = newId();
  let audio: NoteAudio | undefined;
  if (input.voice) {
    const bytes = new Uint8Array(await input.voice.blob.arrayBuffer());
    const chunks = Math.max(1, Math.ceil(bytes.length / REVIEW_CHUNK_BYTES));
    if (!bytes.length || chunks > REVIEW_MAX_AUDIO_CHUNKS) throw new Error("That voice note is too long to save. Say it in two notes.");
    for (let i = 0; i < chunks; i++)
      await F.setDoc(F.doc(db, "reviewClips", clipId, "audio", `${id}_${i}`), { data: F.Bytes.fromUint8Array(bytes.slice(i * REVIEW_CHUNK_BYTES, (i + 1) * REVIEW_CHUNK_BYTES)) });
    audio = { type: (input.voice.blob.type || "audio/webm").split(";")[0], bytes: bytes.length, chunks, seconds: Math.max(0, Math.round(input.voice.seconds * 10) / 10) };
  }
  const note = {
    t: Math.max(0, Math.round(input.t * 10) / 10), text: input.text.trim().slice(0, REVIEW_MAX_TEXT), said: input.said, transcript: input.transcript,
    ...(audio ? { audio } : {}), state: "open" as const, round: input.round,
  };
  await F.setDoc(F.doc(db, "reviewClips", clipId, "notes", id), { ...note, created: F.serverTimestamp() });
  return { id, ...note, created: Date.now() };
}

/** The owner's check of a fix (fixed, or open again), or a corrected text. */
export async function updateNote(db: Firestore, clipId: string, noteId: string, patch: Partial<Pick<ReviewNote, "state" | "text">>) {
  const F = await import("firebase/firestore");
  await F.updateDoc(F.doc(db, "reviewClips", clipId, "notes", noteId), patch.text === undefined ? patch : { ...patch, text: patch.text.trim().slice(0, REVIEW_MAX_TEXT), transcript: "typed" });
}

export async function deleteNote(db: Firestore, clipId: string, note: ReviewNote) {
  const F = await import("firebase/firestore");
  await F.deleteDoc(F.doc(db, "reviewClips", clipId, "notes", note.id));
  for (let i = 0; i < (note.audio?.chunks ?? 0); i++) await F.deleteDoc(F.doc(db, "reviewClips", clipId, "audio", `${note.id}_${i}`));
}

/** A voice note's audio, to play back. */
export async function noteAudio(db: Firestore, clipId: string, note: ReviewNote): Promise<Blob | null> {
  if (!note.audio) return null;
  const F = await import("firebase/firestore");
  const parts = await Promise.all(Array.from({ length: note.audio.chunks }, (_, i) => F.getDoc(F.doc(db, "reviewClips", clipId, "audio", `${note.id}_${i}`))));
  if (parts.some((p) => !p.exists())) return null;
  return new Blob(parts.map((p) => (p.data()!.data as Bytes).toUint8Array()) as BlobPart[], { type: note.audio.type });
}
