/**
 * The modern factions' own, licensed sounds for the public Faction viewer (public/faction-audio/, written by
 * scripts/sync-faction-audio.mjs from RTSAI-Mod's rules and per-clip records). Server-side only. Original Red Alert 2
 * sounds are never here: units whose sounds are all original simply have none.
 */
import data from "../data/faction-audio.json";

export type PublicClip = { src: string; language: string | null; text: string | null; english: string | null; license: string };
export type PublicSoundGroup = { id: string; label: string; kind: string; clips: PublicClip[] };
type Manifest = { clips: Record<string, PublicClip & { sourceSha256: string; bytes: number }>; units: Record<string, { id: string; label: string; kind: string; clips: string[] }[]> };
const audio = data as unknown as Manifest;

/** An actor's published sounds, grouped as the game plays them (select, orders, weapon, death...). */
export function unitSounds(actorId: string): PublicSoundGroup[] {
  return (audio.units[actorId.toLowerCase()] ?? []).map(g => ({
    id: g.id, label: g.label, kind: g.kind,
    clips: g.clips.flatMap(file => { const c = audio.clips[file]; return c ? [{ src: c.src, language: c.language, text: c.text, english: c.english, license: c.license }] : []; }),
  })).filter(g => g.clips.length);
}
