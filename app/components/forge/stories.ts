/**
 * Unit stories for the Concept Forge: each faction's war told in chapters, and each unit's own story in it. The
 * drafts live in D:\Generated\RTSAI\stories\<faction>.json (GET /api/concept-forge/stories) until the owner approves
 * them. They follow the campaign's story bible (RTSAI-Mod docs/story-bible.md): every faction fights the stateless
 * Obsidian Directorate and its Orion Group, never another real nation, and civilians are never targets.
 *
 * An original's story is keyed by its id in its own faction's file, a game unit's by its game id (r2qilin) in its
 * faction's file, and a mix borrows its hull's story: it is a field refit of that hull.
 */
export type Chapter = {
  id: string; title: string;
  /** When it happens, in the story's words ("Spring 2026", "The night of Glass Island"). */
  when: string;
  text: string;
  /** The campaign chapter it belongs to ("Act II · Bring the Islands Online"), when it has one. */
  campaign?: string | null;
  /** A painted still that heads the chapter: a stories-folder path (chapters/<faction>/<id>.webp) or an address. */
  art?: string;
};
export type UnitStory = {
  /** What its crews call it. */
  callsign: string;
  /** The chapter it enters the war in. */
  chapter: string;
  /** Who built it, and the problem it was built for. */
  origin: string;
  /** Its moment in the war. */
  story: string;
  /** Lines its crew says on the radio. */
  crew: string[];
  /** The Directorate's file on it: how the villain sees it. */
  broker: string;
};
/** One of the people who carry a faction's war: a reader follows them from chapter to chapter and unit to unit. */
export type Person = {
  id: string; name: string;
  /** Empty for people without one (a co-op foreman). */
  rank?: string;
  /** What they do, in one line. */
  role: string;
  /** Who they were before the war, what they want and fear. */
  bio: string;
  /** The thing they say that people quote back to them. */
  line: string;
  /** What they do in each chapter they are in, in chapter order. */
  arc: { chapter: string; text: string }[];
  /** The units (story keys in this file) they crew, built, command or are remembered in. */
  units: string[];
  /** Their portrait: a campaign commander's published one (an https address), or a draft from the stories folder
   *  (portraits/<faction>/<id>.webp, served by the Forge's story-file route). Without one they wear their initials. */
  portrait?: string;
};
export type FactionStory = { faction: string; title: string; line: string; chapters: Chapter[]; cast?: Person[]; units: Record<string, UnitStory> };
export type Stories = Record<string, FactionStory>;

/** A unit's story and its chapter: `id` is an original's id or a game unit's game id, looked up in `faction`'s file. */
export function storyOf(stories: Stories, faction: string, id: string) {
  const fs = stories[faction], s = fs?.units[id];
  return fs && s ? { story: s, chapter: fs.chapters.find(c => c.id === s.chapter) ?? null, faction, people: castOf(fs, id) } : null;
}

/** The people of a faction's cast who are in a unit's story. */
export function castOf(fs: FactionStory | undefined, id: string): Person[] {
  return (fs?.cast ?? []).filter(p => p.units.includes(id));
}

/** Where a portrait or a chapter's still is fetched from: an address as it is, a stories-folder path through the Forge's API. */
export function portraitSrc(portrait: string | undefined, api: string) {
  return !portrait ? undefined : /^https?:\/\//.test(portrait) ? portrait : `${api}/story-file/${portrait.split("/").map(encodeURIComponent).join("/")}`;
}

/** Initials for a person's badge: the first letters of their first and last names. */
export function initials(name: string) {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase();
}
