"use client";

import { useEffect, useRef, useState } from "react";
import { renderInGame } from "../../../lib/art-lab/client";
import type { RenderSpec } from "../../../lib/art-lab/spec";
import type { PixelImage } from "./PixelCanvas";

let queue: Promise<unknown> = Promise.resolve();
/** Renders one unit at a time and yields a frame between units, so long rosters never block input. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(() => new Promise(r => requestAnimationFrame(() => r(null)))).then(job);
  queue = run.catch(() => null);
  return run;
}

/** Re-frames images onto one shared box so every unit's centre lands on the same pixel. */
export function alignImages(images: Record<string, PixelImage>, margin = 4): Record<string, PixelImage> {
  const list = Object.values(images);
  if (!list.length) return images;
  const left = Math.max(...list.map(i => i.anchorX)), right = Math.max(...list.map(i => i.width - i.anchorX));
  const up = Math.max(...list.map(i => i.anchorY)), down = Math.max(...list.map(i => i.height - i.anchorY));
  const width = left + right + 2 * margin, height = up + down + 2 * margin;
  const out: Record<string, PixelImage> = {};
  for (const [id, img] of Object.entries(images)) {
    const data = new Uint8ClampedArray(4 * width * height);
    const ox = left + margin - img.anchorX, oy = up + margin - img.anchorY;
    for (let y = 0; y < img.height; y++) data.set(img.data.subarray(4 * y * img.width, 4 * (y + 1) * img.width), 4 * ((y + oy) * width + ox));
    out[id] = { width, height, data, anchorX: left + margin, anchorY: up + margin };
  }
  return out;
}

export type RenderOptions = { facing: number; color: string | null };

/**
 * Renders a group of units (when `active`) at 1x and aligns them on a shared centre.
 * Returns null until every unit in the group is ready; errors are reported per unit.
 */
export function useInGameRenders(specs: RenderSpec[], options: RenderOptions, active: boolean) {
  const [state, setState] = useState<{ key: string; images: Record<string, PixelImage>; errors: Record<string, string> } | null>(null);
  const key = `${specs.map(s => s.id).join(",")}|${options.facing}|${options.color}`;
  const latest = useRef(key);
  useEffect(() => {
    latest.current = key;
    if (!active) return;
    let cancelled = false;
    (async () => {
      const images: Record<string, PixelImage> = {};
      const errors: Record<string, string> = {};
      for (const spec of specs) {
        try {
          images[spec.id] = await enqueue(() => renderInGame(spec, { facing: spec.voxel ? options.facing : options.facing, color: options.color }));
        } catch (error) {
          errors[spec.id] = error instanceof Error ? error.message : String(error);
        }
        if (cancelled || latest.current !== key) return;
      }
      if (!cancelled) setState({ key, images: alignImages(images), errors });
    })();
    return () => { cancelled = true; };
    // `key` captures specs and options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);
  return state && state.key === key ? state : null;
}

/** True once the element has scrolled near the viewport (stays true). */
export function useNearViewport<T extends Element>(margin = "300px") {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") { const id = setTimeout(() => setNear(true)); return () => clearTimeout(id); }
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) setNear(true); }, { rootMargin: margin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near, margin]);
  return [ref, near] as const;
}
