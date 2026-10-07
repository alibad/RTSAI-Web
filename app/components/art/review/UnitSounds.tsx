"use client";
import { useEffect } from "react";
import type { FrameStore, StageItem } from "./frames";
import { soundEngine } from "./sound";
import { useActorSounds } from "./sound-data";
import { selectUrls, useMotionSounds } from "./useMotionSounds";

/**
 * The open unit's sound with motion (Fire, Die) and its select line after a hand-picked selection. Renders nothing; it
 * subscribes to the unit's sounds on its own so their arrival never re-renders the Studio.
 */
export function UnitSounds({ soundsKey, frames, item, takeSelect }: {
  soundsKey: string | null; frames: FrameStore; item: StageItem | null;
  /** True (once) when this actor was just picked by hand. */
  takeSelect: (actor: string) => boolean;
}) {
  const sounds = useActorSounds(soundsKey);
  const data = sounds && sounds !== "error" ? sounds : null;
  useMotionSounds(frames, item, data);
  useEffect(() => {
    if (data && takeSelect(data.actor)) void soundEngine.playAny(selectUrls(data));
  }, [data, takeSelect]);
  return null;
}
