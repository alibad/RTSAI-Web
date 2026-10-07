"use client";
import { useEffect, useRef, type RefObject } from "react";
import type { DuelResult } from "../../../../lib/art-lab/duel-server";
import { placementActor } from "../../../../lib/art-lab/encounter";
import type { SoundClip } from "../../../../lib/art-lab/sounds-server";
import { soundEngine } from "./sound";
import type { ActorSoundsData } from "./SoundsPanel";
import { deathUrls } from "./useMotionSounds";

const API = "/api/art-review";
/** Two shots of one weapon closer than this sound as one (a burst, or a fast replay). */
const MIN_GAP_MS = 70;

type ReplaySounds = { reports: Map<string, string[]>; deaths: Map<string, string[]> };

/**
 * The Encounter replay's sound: each recorded shot plays its weapon's report and each recorded death the destroyed
 * actor's death sound, at the tick the engine measured. Seeking or a jump never plays the skipped span.
 */
export function useReplaySounds(result: DuelResult | null, playhead: RefObject<number>, playing: boolean, factions: string[]) {
  const sounds = useRef<{ result: DuelResult; data: ReplaySounds } | null>(null);
  const [fa, fb] = factions;
  useEffect(() => {
    if (!result || result.request.mode !== "ra2") return;
    let live = true;
    const weapons = [...new Set((result.shots ?? []).map(s => s.weapon))];
    const destroyed = (result.events ?? []).filter(e => e.kind === "destroyed").map(e => ({ actor: placementActor(result.request.placements, e.side, e.index, [result.request.a.id, result.request.b.id]), faction: e.side === 0 ? fa : fb }));
    const types = [...new Map(destroyed.map(d => [`${d.actor}:${d.faction ?? ""}`, d])).values()];
    const get = <T,>(path: string) => fetch(`${API}/${path}`, { cache: "no-store" }).then(r => (r.ok ? r.json() as Promise<T> : null)).catch(() => null);
    void Promise.all([
      weapons.length ? get<Record<string, { report: SoundClip[] }>>(`sounds/weapons?mode=ra2&names=${encodeURIComponent(weapons.join(","))}`) : null,
      ...types.map(t => get<ActorSoundsData>(`sounds?mode=ra2&actor=${encodeURIComponent(t.actor)}${t.faction ? `&faction=${encodeURIComponent(t.faction)}` : ""}`)),
    ]).then(([w, ...actors]) => {
      if (!live) return;
      const reports = new Map(Object.entries((w ?? {}) as Record<string, { report: SoundClip[] }>).map(([name, s]) => [name, s.report.filter(c => c.present).map(c => c.url)]));
      const deaths = new Map(types.map((t, i) => [`${t.actor}:${t.faction ?? ""}`, actors[i] ? deathUrls(actors[i] as ActorSoundsData) : []]));
      sounds.current = { result, data: { reports, deaths } };
    });
    return () => { live = false; };
  }, [result, fa, fb]);

  useEffect(() => {
    if (!playing || !result) return;
    let last = playhead.current ?? 0, raf = 0;
    const lastShot = new Map<string, number>();
    const step = () => {
      const now = playhead.current ?? 0, data = sounds.current?.result === result ? sounds.current.data : null;
      const span = now - last;
      // Only a short, forward span plays (a seek or a stall replays nothing).
      if (data && span > 0 && span < result.ticksPerSecond) {
        for (const shot of result.shots ?? []) {
          if (shot.tick <= last || shot.tick > now) continue;
          const at = performance.now();
          if (at - (lastShot.get(shot.weapon) ?? -1e9) < MIN_GAP_MS) continue;
          lastShot.set(shot.weapon, at);
          void soundEngine.playAny(data.reports.get(shot.weapon) ?? [], { gain: 0.8 });
        }
        for (const e of result.events ?? []) {
          if (e.kind !== "destroyed" || e.tick <= last || e.tick > now) continue;
          const actor = placementActor(result.request.placements, e.side, e.index, [result.request.a.id, result.request.b.id]);
          void soundEngine.playAny(data.deaths.get(`${actor}:${(e.side === 0 ? fa : fb) ?? ""}`) ?? []);
        }
      }
      last = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, result, playhead, fa, fb]);
}
