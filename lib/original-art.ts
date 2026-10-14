"use client";
/**
 * Westwood's original art for the original roster (the nine countries and the units every faction shares), shown
 * free and non-commercially under EA's modding guidelines. It comes from the Faction Studio's published snapshot
 * (scripts/publish-studio.ts → Cloudflare Pages, data/studio-snapshot.json), so the site never bundles EA files itself.
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

/** The published snapshot's index: its rosters and, once published with them, the original sounds per faction. */
export type SnapshotIndex = { rosters: Record<string, string>; sounds?: { notice?: string; factions: Record<string, string> } };
let indexLoad: Promise<SnapshotIndex | null> | null = null;
/** The snapshot index, fetched once per page (null when there is none or it cannot be read). */
export function snapshotIndex(): Promise<SnapshotIndex | null> {
  indexLoad ??= (async () => {
    const index = (snapshot as { index?: string | null }).index;
    if (!index) return null;
    const response = await fetch(index);
    if (!response.ok) throw new Error(`Snapshot index: ${response.status}`);
    return await response.json() as SnapshotIndex;
  })().catch(() => { indexLoad = null; return null; });
  return indexLoad;
}

/** Every original unit's art for a game mode, by lower-case actor id ({} when the snapshot is unavailable). */
export function loadOriginalArt(mode: "ra2" | "ra" = "ra2"): Promise<Record<string, OriginalArt>> {
  const key = mode === "ra" ? "classic" : "ra2";
  let load = loads.get(key);
  if (!load) {
    load = (async () => {
      const rosters = (await snapshotIndex())?.rosters;
      if (!rosters?.[key]) return {};
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
