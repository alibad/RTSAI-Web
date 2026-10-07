"use client";
import type { EffectSource } from "./frames";

/**
 * The local Studio's effect art (muzzle flashes): resolved from the mod's rules and read from the private originals
 * cache by the dev-only Review API. Only the Studio (stubbed out of production builds) passes this to its FrameStore.
 */
export const studioEffects: EffectSource = query =>
  fetch(`/api/art-review/visual?${new URLSearchParams({ mode: "ra2", ...query })}`)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
