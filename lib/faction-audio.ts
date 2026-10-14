/**
 * The modern factions' own, licensed sounds for the public Faction viewer (public/faction-audio/, written by
 * scripts/sync-faction-audio.mjs from RTSAI-Mod's rules and per-clip records). Server-side only. Original Red Alert 2
 * sounds are never in this repository: the Faction Studio's published snapshot carries them (lib/original-sounds.ts),
 * and the viewer loads them in the browser next to these.
 */
import data from "../data/faction-audio.json";

/** `file`: the clip's path in the mod, as the rules name it (the snapshot's sound lists refer to project clips by it). */
export type PublicClip = { src: string; file?: string; language: string | null; text: string | null; english: string | null; license: string };
export type PublicSoundGroup = { id: string; label: string; kind: string; clips: PublicClip[] };
type Manifest = { clips: Record<string, PublicClip & { sourceSha256: string; bytes: number }>; units: Record<string, { id: string; label: string; kind: string; clips: string[] }[]> };
const audio = data as unknown as Manifest;

/** An actor's published sounds, grouped as the game plays them (select, orders, weapon, death...). */
export function unitSounds(actorId: string): PublicSoundGroup[] {
  return (audio.units[actorId.toLowerCase()] ?? []).map(g => ({
    id: g.id, label: g.label, kind: g.kind,
    clips: g.clips.flatMap(file => { const c = audio.clips[file]; return c ? [{ src: c.src, file, language: c.language, text: c.text, english: c.english, license: c.license }] : []; }),
  })).filter(g => g.clips.length);
}

/** The project's own sound effects (explosions, launches) by mod path: original units' rules play some of them too. */
export function projectEffects(): Record<string, PublicClip> {
  return Object.fromEntries(Object.entries(audio.clips).filter(([file]) => file.startsWith("mods/rtsai/audio/sfx/"))
    .map(([file, c]) => [file, { src: c.src, file, language: null, text: null, english: null, license: c.license }]));
}
