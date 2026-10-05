"use client";

import { useEffect, useState } from "react";
import type { Backdrop } from "./PixelCanvas";

export type ViewMode = "ingame" | "orbit" | "exploded";
export type MapTint = { map: string; title: string; tint: [number, number, number] };

/** One set of view settings drives every viewer on a page (all columns of a comparison at once). */
export type ViewSettings = {
  mode: ViewMode;
  /** Body facing, OpenRA WAngle (0 = north, counter-clockwise). */
  facing: number;
  spin: boolean;
  color: string | null;
  zoom: 1 | 2 | 4;
  backdrop: Backdrop;
  tintMap: string;
  /** Turret angle relative to the body (voxels) or absolute (defence sprites). */
  turretFacing: number;
  shadow: boolean;
  airborne: boolean;
  linkCameras: boolean;
  /** Sprite animation: stand, move, attack, idle, die, prone, body, make. */
  animation: string;
  playing: boolean;
};

export const defaultViewSettings: ViewSettings = {
  mode: "ingame", facing: 896, spin: false, color: "F21818", zoom: 2, backdrop: "sand", tintMap: "", turretFacing: 0,
  shadow: true, airborne: false, linkCameras: true, animation: "stand", playing: true,
};

const storageKey = "rtsai-art-lab-view";
const remembered = ["color", "zoom", "backdrop", "tintMap"] as const;

function restore(): Partial<ViewSettings> {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}") as Partial<ViewSettings>;
    const out: Partial<ViewSettings> = {};
    if (saved.color === null || (typeof saved.color === "string" && /^[0-9A-F]{6}$/i.test(saved.color))) out.color = saved.color;
    if (saved.zoom === 1 || saved.zoom === 2 || saved.zoom === 4) out.zoom = saved.zoom;
    if (["sand", "grass", "dark", "checker"].includes(saved.backdrop as string)) out.backdrop = saved.backdrop;
    if (typeof saved.tintMap === "string") out.tintMap = saved.tintMap;
    return out;
  } catch { return {}; }
}

/** View settings with an auto-spin turntable; colour, scale, ground and map light are remembered per browser. */
export function useViewSettings(initial?: Partial<ViewSettings>) {
  const [settings, setSettings] = useState<ViewSettings>({ ...defaultViewSettings, ...initial });
  useEffect(() => {
    const saved = restore();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore per-browser preferences after hydration
    if (Object.keys(saved).length) setSettings(s => ({ ...s, ...saved }));
  }, []);
  useEffect(() => {
    if (!settings.spin) return;
    // Turntable: one 1/32 turn clockwise every 120 ms (facings increase counter-clockwise in OpenRA).
    const timer = setInterval(() => setSettings(s => ({ ...s, facing: (s.facing - 32 + 1024) & 1023 })), 120);
    return () => clearInterval(timer);
  }, [settings.spin]);
  const update = (patch: Partial<ViewSettings>) => setSettings(s => {
    const next = { ...s, ...patch };
    try { localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(remembered.map(k => [k, next[k]])))); } catch { /* storage unavailable */ }
    return next;
  });
  return [settings, update] as const;
}

const NEUTRAL: [number, number, number] = [1, 1, 1];
/** The selected map's tint; stable references so effects keyed on it do not re-run every render. */
export function tintFor(tintMap: string, tints: MapTint[]): [number, number, number] {
  return tints.find(t => t.map === tintMap)?.tint ?? NEUTRAL;
}

/**
 * Links 3D-orbit cameras: rotating one viewer rotates the others (directions only; each keeps its own framing).
 */
export class CameraLink {
  linked = true;
  private readonly listeners = new Set<(direction: [number, number, number], source: unknown) => void>();
  last: [number, number, number] | null = null;
  setLinked(value: boolean) { this.linked = value; }
  publish(direction: [number, number, number], source: unknown) {
    this.last = direction;
    if (!this.linked) return;
    for (const listener of this.listeners) listener(direction, source);
  }
  subscribe(listener: (direction: [number, number, number], source: unknown) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
