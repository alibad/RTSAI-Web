"use client";

import { create } from "zustand";
import type { Backdrop } from "../PixelCanvas";

export type Compare = "single" | "side" | "swipe" | "lineup";
export type View3d = "off" | "orbit" | "exploded";

/**
 * The Review screen's view state. Facing, turret and swipe change many times a second while dragging; canvases
 * subscribe to them imperatively so React never re-renders the page for a turn.
 */
export type LabView = {
  facing: number;
  /** Turret angle relative to the body (vehicles) or to InitialFacing (defences). */
  turret: number;
  spin: boolean;
  playing: boolean;
  animation: string;
  animationTime:number;
  /** Wheel zoom; null fits the unit to the stage. */
  zoom: number | null;
  compare: Compare;
  view3d: View3d;
  /** Swipe divider, 0..1 of the stage width. */
  swipe: number;
  lineupFacings: 4 | 8;
  color: string | null;
  ground: Backdrop;
  tintMap: string;
  shadow: boolean;
  /** Aircraft fly at cruise altitude (the Animations step) instead of standing landed. */
  flying: boolean;
};

export const defaultView: LabView = {
  facing: 896, turret: 0, spin: false, playing: false, animation: "stand",animationTime:0, zoom: null, compare: "single", view3d: "off",
  swipe: 0.5, lineupFacings: 4, color: "F21818", ground: "sand", tintMap: "", shadow: true, flying: false,
};

export const useLab = create<LabView>(() => ({ ...defaultView }));
export const setLab = (patch: Partial<LabView> | ((s: LabView) => Partial<LabView>)) => useLab.setState(s=>{const next=typeof patch==="function"?patch(s):patch;return next.animation!==undefined&&next.animation!==s.animation?{...next,animationTime:0}:next;});

const storageKey = "rtsai-art-review-view";
const remembered = ["color", "ground", "tintMap", "shadow", "lineupFacings"] as const;

/** Restores the rarely changed settings (View popover) and keeps them per browser. */
export function rememberView() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}") as Partial<LabView>;
    const patch: Partial<LabView> = {};
    if (saved.color === null || (typeof saved.color === "string" && /^[0-9A-F]{6}$/i.test(saved.color))) patch.color = saved.color;
    if (["sand", "grass", "dark", "checker"].includes(saved.ground as string)) patch.ground = saved.ground;
    if (typeof saved.tintMap === "string") patch.tintMap = saved.tintMap;
    if (typeof saved.shadow === "boolean") patch.shadow = saved.shadow;
    if (saved.lineupFacings === 4 || saved.lineupFacings === 8) patch.lineupFacings = saved.lineupFacings;
    if (Object.keys(patch).length) useLab.setState(patch);
  } catch { /* storage unavailable */ }
  return useLab.subscribe((s, prev) => {
    if (remembered.every(k => s[k] === prev[k])) return;
    try { localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(remembered.map(k => [k, s[k]])))); } catch { /* ignore */ }
  });
}
