"use client";
/* Local-only Studio flags as small bitmaps. Each SVG flag costs tens of milliseconds of raster the first time a
   list of them appears (hundreds on a software GPU); rasterising them once, in idle time, makes the faction picker
   open at once. The bitmaps are in-memory object URLs: nothing is stored or sent anywhere. */
import { useEffect, useState } from "react";
import { flagSrc } from "./flags";

const bitmaps = new Map<string, string>();
const listeners = new Set<() => void>();
const started = new Set<string>();
const W = 96, H = 72;

/** The bitmap when ready, else the SVG data URL. */
export const flagImage = (id: string) => bitmaps.get(id) ?? flagSrc(id);

const idle = (fn: () => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fn, { timeout: 3000 }); else setTimeout(fn, 60);
};

/** Rasterises the given flags one per idle slot. */
export function prewarmFlags(ids: string[]) {
  const queue = ids.filter(id => !started.has(id) && flagSrc(id));
  queue.forEach(id => started.add(id));
  const next = () => {
    const id = queue.shift();
    if (!id) return;
    const img = new Image();
    img.src = flagSrc(id)!;
    img.decode().then(() => {
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      canvas.getContext("2d")?.drawImage(img, 0, 0, W, H);
      canvas.toBlob(blob => {
        if (blob) { bitmaps.set(id, URL.createObjectURL(blob)); for (const l of listeners) l(); }
        idle(next);
      }, "image/png");
    }).catch(() => idle(next));
  };
  if (queue.length) idle(next);
}

/** Re-renders when bitmaps arrive. */
export function useFlagBitmaps() {
  const [, bump] = useState(0);
  useEffect(() => { const l = () => bump(n => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
}
