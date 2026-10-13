"use client";
/**
 * Westwood's original art for the original roster (the nine countries and the units every faction shares), shown
 * free and non-commercially under EA's modding guidelines. It comes from the Faction Studio's published snapshot
 * (scripts/publish-studio.ts → Vercel Blob, data/studio-snapshot.json), so the site never bundles EA files itself.
 * Loaded once per page, only where an original unit is on screen.
 */
import { useEffect, useState } from "react";
import snapshot from "../data/studio-snapshot.json";
import type { RenderSpec } from "./art-lab/spec";
import type { SpriteArt } from "./art-lab/types";

export { EA_NOTICE } from "./ea-notice";

export type OriginalArt = { spec: RenderSpec; sprite: SpriteArt | null };
type Roster = { stock?: Record<string, OriginalArt>; originals?: Record<string, OriginalArt> };

const loads = new Map<string, Promise<Record<string, OriginalArt>>>();

/** Every original unit's art for a game mode, by lower-case actor id ({} when the snapshot is unavailable). */
export function loadOriginalArt(mode: "ra2" | "ra" = "ra2"): Promise<Record<string, OriginalArt>> {
  const key = mode === "ra" ? "classic" : "ra2";
  let load = loads.get(key);
  if (!load) {
    load = (async () => {
      const index = (snapshot as { index?: string | null }).index;
      if (!index) return {};
      const { rosters } = await (await fetch(index)).json() as { rosters: Record<string, string> };
      if (!rosters[key]) return {};
      const roster = await (await fetch(rosters[key])).json() as Roster;
      return { ...roster.stock, ...roster.originals };
    })().catch(() => { loads.delete(key); return {}; });
    loads.set(key, load);
  }
  return load;
}

/** The original art once loaded (an empty record before, or when `enabled` is false). */
export function useOriginalArt(enabled: boolean, mode: "ra2" | "ra" = "ra2") {
  const [art, setArt] = useState<Record<string, OriginalArt>>({});
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadOriginalArt(mode).then(a => { if (live) setArt(a); });
    return () => { live = false; };
  }, [enabled, mode]);
  return art;
}
