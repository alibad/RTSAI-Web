"use client";
/**
 * Red Alert 2's original voices and sound effects for the Faction viewer (never music), shown free and non-commercially
 * under EA's modding guidelines with EA's notice. Like Westwood's art they come from the Faction Studio's published
 * snapshot (scripts/publish-studio.ts extracts them from the owner's own game files), never from this repository; one
 * small file per faction, loaded in the browser when a unit is shown. A snapshot published before sounds were added
 * simply has none, and the viewer shows only the project's own clips.
 */
import { useEffect, useState } from "react";
import { snapshotIndex } from "./original-art";

/** A sound list as the game plays it; each clip is an original file name ("igisea.wav") or a project clip's mod path. */
export type SnapshotSoundGroup = { id: string; label: string; kind: string; clips: string[] };
export type SnapshotSounds = {
  /** Every unit the faction builds, by lower-case actor id. */
  units: Record<string, SnapshotSoundGroup[]>;
  /** Each unit's weapons' report and impact clips, by lower-case actor id, then lower-case weapon name. */
  weapons: Record<string, Record<string, { report: string[]; impact: string[] }>>;
  /** Where each original clip is published. */
  clips: Record<string, { src: string }>;
};

const loads = new Map<string, Promise<SnapshotSounds | null>>();
/** The faction's sounds from the snapshot, or null (no snapshot, or one published without sounds). */
export function loadFactionSounds(faction: string): Promise<SnapshotSounds | null> {
  let load = loads.get(faction);
  if (!load) {
    load = (async () => {
      const url = (await snapshotIndex())?.sounds?.factions[faction];
      if (!url) return null;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Sounds: ${response.status}`);
      return await response.json() as SnapshotSounds;
    })().catch(() => { loads.delete(faction); return null; });
    loads.set(faction, load);
  }
  return load;
}

/** The faction's original sounds once loaded (null before, when `enabled` is false, or when none are published). */
export function useFactionSounds(faction: string, enabled = true) {
  const [sounds, setSounds] = useState<{ faction: string; value: SnapshotSounds | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadFactionSounds(faction).then(value => { if (live) setSounds({ faction, value }); });
    return () => { live = false; };
  }, [faction, enabled]);
  return sounds?.faction === faction ? sounds.value : null;
}

/** A clip reference is a project clip when it names a mod path. */
export const isProjectClip = (ref: string) => ref.includes("/");
