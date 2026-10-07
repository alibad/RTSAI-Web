"use client";
import { useEffect } from "react";
import { FIRE_ACTION, firePeriod } from "../../../../lib/art-lab/fire";
import type { FrameStore, StageItem } from "./frames";
import { useLab } from "./lab-store";
import { soundEngine } from "./sound";
import type { ActorSoundsData } from "./SoundsPanel";

const urls = (data: ActorSoundsData, ...ids: string[]) => {
  for (const id of ids) {
    const g = data.groups.find(x => x.id === id && x.played);
    const list = g?.files.filter(f => f.present).map(f => f.url) ?? [];
    if (list.length) return list;
  }
  return [];
};
/** What the actor sounds like when it fires (its weapons' reports) and when it dies (its death voice or explosion). */
export const fireUrls = (data: ActorSoundsData) => urls(data, "weapon:report");
export const deathUrls = (data: ActorSoundsData) => urls(data, "voice:Die", "death:explosion", "damage:destroyed");
export const selectUrls = (data: ActorSoundsData) => urls(data, "voice:Select");
const FIRE = /^(attack|fire|shoot|prone-shoot|gunfire)$/;

/**
 * Sound with motion on the stage: each shot of Fire plays a weapon report in step with its muzzle flash (the start of
 * every fire cycle), Die plays the death sound when it starts. Only while playing, never before a user gesture.
 */
export function useMotionSounds(frames: FrameStore, item: StageItem | null, data: ActorSoundsData | null) {
  useEffect(() => {
    if (!item || !data) return;
    const reports = fireUrls(data), deaths = deathUrls(data);
    if (!reports.length && !deaths.length) return;
    let last = { animation: useLab.getState().animation, cycle: -1, time: useLab.getState().animationTime };
    return useLab.subscribe(s => {
      const restarted = s.animation !== last.animation || s.animationTime < last.time;
      if (!s.playing) { last = { animation: s.animation, cycle: restarted ? -1 : last.cycle, time: s.animationTime }; return; }
      if (s.animation === FIRE_ACTION || FIRE.test(s.animation)) {
        const period = s.animation === FIRE_ACTION && item.fire ? firePeriod(item.fire, frames.fireArt(item, false) ?? {}) : frames.animationInfo(item, s.animation)?.durationMs ?? 0;
        const cycle = period > 0 ? Math.floor(s.animationTime / period) : 0;
        if (restarted || cycle !== last.cycle) void soundEngine.playAny(reports);
        last = { animation: s.animation, cycle, time: s.animationTime };
      } else if (/^die/.test(s.animation)) {
        if (restarted || last.cycle === -1) void soundEngine.playAny(deaths);
        last = { animation: s.animation, cycle: 0, time: s.animationTime };
      } else last = { animation: s.animation, cycle: -1, time: s.animationTime };
    });
  }, [frames, item, data]);
}
