/**
 * The Review inbox (owner, 20 November 2026): short clips of the game that the owner answers with one click or key,
 * "Looks good", "Skip", or a voice note pinned to a moment of the clip. Any session adds clips with
 * `node tools/review.mjs add` and reads the answers with `node tools/review.mjs feedback` (docs/review-inbox.md).
 *
 * Firestore, owner only (firestore.rules):
 *   reviewClips/{clipId}                 ReviewClip: what the clip shows (written by sessions) and the owner's answer
 *     notes/{noteId}                     ReviewNote: what is wrong, at which second; typed, or the transcript of a voice note
 *     audio/{noteId}_{index}             { data: Bytes }: the voice note itself, in chunks of at most 900 KiB
 * The clip files (video, poster, unit icons) are static files named by full URL in the clip.
 */

/** Where a clip comes from. A front is one line of work on the game; add one here when a new front starts filming. */
export const REVIEW_FRONTS = [
  { id: "battles", label: "Battles" },
  { id: "campaign", label: "Campaign" },
  { id: "ai", label: "AI" },
  { id: "multiplayer", label: "Multiplayer" },
  { id: "maps", label: "Maps" },
  { id: "art", label: "Art" },
  { id: "sound", label: "Sound" },
  { id: "site", label: "Website" },
] as const;
export const frontLabel = (id: string) => REVIEW_FRONTS.find((f) => f.id === id)?.label ?? id.charAt(0).toUpperCase() + id.slice(1);

/**
 * new: waiting for the owner. good / skipped / noted: the owner's answer. recheck: a session says it fixed what a
 * note described and filmed the clip again; it is back in the inbox as "fixed, check again".
 */
export type ClipState = "new" | "good" | "skipped" | "noted" | "recheck";
/** open: the owner said it is wrong. recheck: a session says it is fixed, waiting for the owner. fixed: the owner agreed. */
export type NoteState = "open" | "recheck" | "fixed";

export type UnitClass = "infantry" | "vehicle" | "aircraft" | "ship" | "defence" | "building" | "special";
export type ClipUnit = { id: string; name: string; count: number; cls?: UnitClass; /** The unit's build icon as the game draws it. */ icon?: string };
export type ClipSide = { faction: string; name: string; /** The faction's flag. */ flag?: string; units: ClipUnit[] };

export type ReviewClip = {
  id: string;
  front: string;
  title: string;
  /** Why this clip exists: what the owner is asked to judge, in one short sentence. */
  why: string;
  video: string;
  poster?: string;
  seconds: number;
  /** A fight: who against whom. Other fronts leave it out and use `chips`. */
  sides?: ClipSide[];
  /** How the fight happens (battles), or the kind of moment (other fronts). */
  mode?: { id: string; label: string };
  /** Other facts worth a glance, as small labelled chips. */
  chips?: { label: string; value: string }[];
  /** How to see it again: a link into the game, the map, the seed, a replay file. */
  repro?: { link?: string; map?: string; seed?: number; replay?: string };
  /** The build it was filmed on. */
  build: { label: string; page?: string; runtime?: string; data?: string };
  /** What the session that filmed it suspects is wrong, for the owner to confirm or dismiss. */
  suspects: { t: number; text: string }[];
  /** Suspects (by index) the owner said are fine. */
  dismissed: number[];
  state: ClipState;
  /** 1, then +1 each time the clip is filmed again after a fix. */
  round: number;
  /** The previous round's video, to compare. */
  before?: string;
  /** The session that added it. */
  by: string;
  created: number;
  updated: number;
  answered?: number;
};

export type NoteAudio = { type: string; bytes: number; chunks: number; seconds: number };
export type ReviewNote = {
  id: string;
  /** Seconds into the clip where the owner started talking or typing. */
  t: number;
  /** What is wrong: typed, a voice note's transcript, or the suspect the owner confirmed. */
  text: string;
  said: "voice" | "typed" | "suspect";
  /** Where `text` came from; "none": a voice note the browser could not transcribe (sessions transcribe it locally). */
  transcript: "browser" | "typed" | "whisper" | "none";
  audio?: NoteAudio;
  state: NoteState;
  /** The clip's round when the note was made. */
  round: number;
  /** A session's answer when it fixed it: what changed. */
  reply?: string;
  /** The build or commit that carries the fix. */
  fixedIn?: string;
  created: number;
};

export const REVIEW_CHUNK_BYTES = 900 * 1024;
/** A voice note: at most 4 chunks (3.5 MiB, about ten minutes of speech). */
export const REVIEW_MAX_AUDIO_CHUNKS = 4;
export const REVIEW_MAX_TEXT = 4000;

/** The inbox's order: clips to check again first, then new ones, oldest first; answered clips after them. */
export function inboxOrder(a: ReviewClip, b: ReviewClip) {
  const rank = (c: ReviewClip) => c.state === "recheck" ? 0 : c.state === "new" ? 1 : 2;
  return rank(a) - rank(b) || a.created - b.created || a.id.localeCompare(b.id);
}
export const waiting = (c: ReviewClip) => c.state === "new" || c.state === "recheck";

export const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
