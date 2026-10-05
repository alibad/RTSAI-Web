"use client";

/* Candidate images come from the local dev route at their own sizes; next/image cannot serve them. */
/* eslint-disable @next/next/no-img-element */
import { Check, X } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { SlotDecision } from "../../../../lib/art-lab/review";
import type { MapTint } from "../viewSettings";
import type { FrameStore, StageItem } from "./frames";
import { groundTile, groundWidth } from "./ground";
import { useLab } from "./lab-store";
import { poseFrom } from "./Stage";
import type { Version } from "./versions";

const THUMB_H = 88;
const CARD_MAX = 146, CARD_MIN = 112, GAP = 8;

/** A live thumbnail at the stage's facing, from the frame cache (it never renders on the spot). */
export const ModelThumb = memo(function ModelThumb({ item, frames, tints, zoom, width, radius, height = THUMB_H }: { item: StageItem; frames: FrameStore; tints: MapTint[]; zoom: number; width: number; radius: number | null; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = 0;
      const canvas = ref.current;
      if (!canvas) return;
      const s = useLab.getState();
      const pose = poseFrom(s, tints, s.facing, 0);
      const f = frames.peek(item, pose);
      // Keep the previous picture until the new facing is cached: no blank flashes while turning.
      if (!f) { frames.want(item, pose, true); return; }
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.round(width * dpr), h = Math.round(height * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = false;
      const z = Math.max(1, Math.round(zoom * dpr));
      const cx = Math.round((width / 2) * dpr), cy = Math.round(height * 0.56 * dpr);
      const g = groundTile(s.ground, pose.tint, groundWidth(radius));
      ctx.drawImage(g.canvas, cx - g.anchorX * z, cy - g.anchorY * z, g.width * z, g.height * z);
      ctx.drawImage(f.canvas, cx - f.anchorX * z, cy - f.anchorY * z, f.width * z, f.height * z);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(draw); };
    schedule();
    const offLab = useLab.subscribe((s, p) => {
      if (s.facing !== p.facing || s.turret !== p.turret || s.color !== p.color || s.shadow !== p.shadow || s.tintMap !== p.tintMap || s.ground !== p.ground || s.animation !== p.animation) schedule();
    });
    const offFrames = frames.subscribe(schedule);
    return () => { offLab(); offFrames(); cancelAnimationFrame(raf); };
  }, [item, frames, tints, zoom, width, radius, height]);
  return <canvas ref={ref} className="lab-thumb-canvas" style={{ width, height }} aria-hidden="true" />;
});

/**
 * One equal-size card per version: Current first, then candidates by creation order. The chosen version carries
 * a green check; rejected ones are dimmed with a cross. Click or Left/Right to focus.
 */
export const Filmstrip = memo(function Filmstrip({ versions, focus, decision, frames, tints, thumbZoom, radius, imageFit, onFocus, inPreview = null }: {
  versions: Version[];
  focus: number;
  decision: SlotDecision;
  frames: FrameStore;
  tints: MapTint[];
  thumbZoom: number;
  radius: number | null;
  /** Icons draw pixel-exact (2x when the card is wide enough); concept sheets are scaled to cover the card. */
  imageFit: "pixel" | "cover";
  onFocus: (index: number) => void;
  /** The candidate installed in the local preview mod (matched by bytes), if any. */
  inPreview?: string | null;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Equal cards that share the row; below CARD_MIN they keep their size and the strip scrolls.
  const n = Math.max(1, versions.length);
  const card = width ? Math.max(CARD_MIN, Math.min(CARD_MAX, Math.floor((width - 4 - (n - 1) * GAP) / n))) : CARD_MAX;
  const thumb = card - 16;
  const scrolls = width > 0 && n * card + (n - 1) * GAP + 4 > width;
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${focus}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focus]);
  return (
    <div className={`lab-film${scrolls ? " is-scrolling" : ""}`} ref={listRef} role="listbox" aria-label="Versions" aria-orientation="horizontal">
      {versions.map((v, i) => {
        const chosen = decision.chosen === v.key;
        const rejected = Boolean(v.candidate && decision.rejected.includes(v.key));
        return (
          <button key={v.key} type="button" role="option" data-index={i} aria-selected={i === focus}
            className={`lab-card${i === focus ? " is-focused" : ""}${chosen ? " is-chosen" : ""}${rejected ? " is-rejected" : ""}`} style={{ width: card }}
            onClick={() => onFocus(i)} title={v.candidate?.id ?? "What ships now"}>
            <span className="lab-card-thumb" style={{ width: thumb }}>
              {v.item ? <ModelThumb item={v.item} frames={frames} tints={tints} zoom={thumbZoom} width={thumb} radius={radius} />
                : v.image ? <img src={v.image} alt="" className={imageFit === "pixel" ? "is-pixel" : "is-cover"} loading="lazy" draggable={false}
                  style={imageFit === "pixel" ? { width: thumb >= 120 ? 120 : 60, height: thumb >= 120 ? 96 : 48 } : undefined} />
                : <span className="lab-card-empty">No preview</span>}
              {chosen && <span className="lab-badge is-chosen" aria-label="Chosen"><Check size={14} strokeWidth={3} /></span>}
              {rejected && <span className="lab-badge is-rejected" aria-label="Rejected"><X size={14} strokeWidth={3} /></span>}
              {inPreview === v.key && <span className="lab-card-preview" title="Installed in the local preview mod, not in the game">Preview</span>}
            </span>
            <span className="lab-card-label"><b>{v.label}</b><small>{v.tag}</small></span>
          </button>
        );
      })}
    </div>
  );
});
