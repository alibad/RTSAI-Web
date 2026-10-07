"use client";

import { Minus, Pause, Play, Plus, RotateCw } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clampZoom, dragFacing, FACING_STEP, fitZoom } from "../../../../lib/art-lab/review-ui";
import { spriteAnimations } from "../../../../lib/art-lab/sprite-anim";
import { voxelAnimationParts, voxelCycleLabel } from "../../../../lib/art-lab/voxel-animation";
import { houseColors } from "../../../../lib/art-lab/remap";
import { facingLabel } from "../../../../lib/art-lab/voxel-math";
import { frameRadius, type FrameStore, type Pose, type StageItem } from "../review/frames";
import { groundFor, groundTile, groundWidth } from "../review/ground";

const DEFAULT_FACING = 896;
const SPIN_MS = 110;
const MAX_ZOOM = 6;
/** Actions that play once and hold their last frame (the game never loops them). */
const ONE_SHOT = /(^die|^make$|deploy|takeoff|^land$|^liedown$|^standup$)/;

export type ViewerAction = { id: string; label: string };
/** What the unit can do on the stage: its sprite sequences, or the voxel model's own cycle (rotors, radars). */
export function actionsFor(item: StageItem): ViewerAction[] {
  if (item.spec.voxel) return voxelAnimationParts(item.spec).length ? [{ id: "body", label: voxelCycleLabel(item.spec) }] : [];
  return spriteAnimations(item.sprite).map(a => ({ id: a.id, label: a.label }));
}
const turns = (item: StageItem) => Boolean(item.spec.voxel) || Boolean(item.sprite?.sequences.some(s => Math.abs(s.facings) > 1));

/** A sprite's ground shadow while it flies: its silhouette in the shadow colour, cached per frame. */
const silhouettes = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function silhouette(canvas: HTMLCanvasElement) {
  let s = silhouettes.get(canvas);
  if (!s) {
    s = document.createElement("canvas"); s.width = canvas.width; s.height = canvas.height;
    const c = s.getContext("2d")!;
    c.drawImage(canvas, 0, 0); c.globalCompositeOperation = "source-in"; c.fillStyle = "rgba(0, 0, 0, 0.55)"; c.fillRect(0, 0, s.width, s.height);
    silhouettes.set(canvas, s);
  }
  return s;
}
type Picture = { canvas: HTMLCanvasElement; width: number; height: number; anchorX: number; anchorY: number };
/** Draws a 1x picture with its anchor at CSS point (cx, cy), whole device pixels per game pixel. */
function put(ctx: CanvasRenderingContext2D, dpr: number, p: Picture, cx: number, cy: number, zoom: number) {
  const z = Math.max(1, Math.round(zoom * dpr));
  ctx.drawImage(p.canvas, Math.round(cx * dpr) - p.anchorX * z, Math.round(cy * dpr) - p.anchorY * z, p.width * z, p.height * z);
}

/**
 * The player's stage: the unit as the game draws it, on its ground, pixel-exact at a whole zoom. Drag (or the arrow
 * keys) turns it, the wheel zooms, Space spins; actions play the game's own sequences. Draws only when something
 * changes; nothing loops while it is still.
 */
export function ViewerStage({ frames, item, color, onColor, tag, children }: {
  frames: FrameStore; item: StageItem; color: string; onColor: (hex: string) => void;
  /** A label over the art (admin History shows earlier versions here, never as current). */
  tag?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const actions = useMemo(() => actionsFor(item), [item]);
  const firstAction = actions[0]?.id ?? "stand";
  const [animation, setAnimation] = useState(firstAction);
  const [playing, setPlaying] = useState(false);
  const [spin, setSpin] = useState(false);
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const [radius, setRadius] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ facing: DEFAULT_FACING, time: 0 });
  /** The facing as screen readers hear it (the drawing reads view.current, so dragging never re-renders). */
  const [facing, setFacing] = useState(DEFAULT_FACING);
  const airborne = item.spec.category === "aircraft";
  // A new unit starts on its first action, still, with the zoom refitted. The stage itself stays mounted: on a
  // software GPU a fresh canvas layer per unit costs a frame of 150-200 ms to composite.
  const [shown, setShown] = useState(item);
  if (shown !== item) {
    setShown(item); setAnimation(firstAction); setPlaying(false); setSpin(false); setZoomOverride(null); setRadius(null);
  }
  useEffect(() => { view.current.time = 0; }, [item]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize(s => (s.width === Math.round(r.width) && s.height === Math.round(r.height) ? s : { width: Math.round(r.width), height: Math.round(r.height) }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const pose = (facing: number, time: number, action = animation): Pose => ({
    facing, turret: 0, tick: 0, timeMs: time, loop: !ONE_SHOT.test(action), animation: action, color, shadow: true, tint: [1, 1, 1], airborne,
  });
  const zoom = zoomOverride ?? (radius ? fitZoom(radius, size.width, size.height, MAX_ZOOM, 0.72) : 2);
  // A sprite aircraft flies this many 1x pixels above its shadow (OpenRA: 1448 world units per 30 px); a voxel
  // aircraft's frame already holds its altitude.
  const lift = airborne && !item.spec.voxel && item.spec.airAltitude ? (30 * item.spec.airAltitude) / 1448 : 0;

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(size.width * dpr)), h = Math.max(1, Math.round(size.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h); ctx.imageSmoothingEnabled = false;
    const f = frames.get(item, pose(view.current.facing, view.current.time));
    const up = f ? lift : 0;
    const cx = size.width / 2, cy = Math.round(size.height * 0.56 + (up * zoom) / 2);
    put(ctx, dpr, groundTile(groundFor(item.spec.category, "sand"), [1, 1, 1], groundWidth(radius)), cx, cy, zoom);
    if (!f) return;
    if (up) { put(ctx, dpr, { ...f, canvas: silhouette(f.canvas) }, cx, cy, zoom); put(ctx, dpr, f, cx, cy - up * zoom, zoom); }
    else put(ctx, dpr, f, cx, cy, zoom);
  };
  const drawRef = useRef(draw);
  useLayoutEffect(() => { drawRef.current = draw; });
  const pending = useRef(0);
  const schedule = useMemo(() => () => {
    if (pending.current) return;
    pending.current = requestAnimationFrame(() => { pending.current = 0; drawRef.current(); });
  }, []);
  useEffect(() => () => cancelAnimationFrame(pending.current), []);
  useEffect(() => { schedule(); }, [schedule, item, color, animation, zoom, size, radius]);
  useEffect(() => frames.subscribe(() => schedule()), [frames, schedule]);

  // The fit follows the unit's turning circle at the default facing, once its first frame exists.
  useEffect(() => {
    const check = () => {
      const f = frames.get(item, pose(DEFAULT_FACING, 0, firstAction));
      if (f) setRadius(r => r ?? Math.max(8, Math.ceil(frameRadius(f))));
    };
    check();
    return frames.subscribe(check);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only for a new unit or colour
  }, [frames, item, firstAction]);

  // Playback and spin advance the view on animation frames; one-shot actions stop on their last frame.
  useEffect(() => {
    if (!playing && !spin) return;
    let last = performance.now(), spinAt = last, raf = 0;
    const duration = frames.animationInfo(item, animation)?.durationMs ?? 0;
    const tick = (now: number) => {
      const dt = now - last; last = now;
      if (playing) {
        view.current.time += dt;
        if (ONE_SHOT.test(animation) && duration && view.current.time >= duration) { view.current.time = duration; setPlaying(false); }
      }
      if (spin && now - spinAt >= SPIN_MS) { spinAt = now; view.current.facing = (view.current.facing - FACING_STEP + 1024) % 1024; }
      drawRef.current();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const stop = () => { if (document.hidden) { setSpin(false); setPlaying(false); } };
    document.addEventListener("visibilitychange", stop);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", stop); };
  }, [playing, spin, frames, item, animation]);

  const drag = useRef<{ x: number; facing: number } | null>(null);
  const canTurn = turns(item);
  const choose = (id: string) => { setAnimation(id); view.current.time = 0; setPlaying(true); };

  return (
    <div className="viewer-stage">
      <div ref={boxRef} className="viewer-canvas-box" tabIndex={0} role="slider" aria-orientation="horizontal"
        aria-label={`${item.spec.name}: ${canTurn ? "drag or use the arrow keys to turn it" : "a fixed view"}`}
        aria-valuemin={0} aria-valuemax={1023} aria-valuenow={facing} aria-valuetext={facingLabel(facing)}
        onPointerDown={e => { if (!canTurn) return; drag.current = { x: e.clientX, facing: view.current.facing }; e.currentTarget.setPointerCapture(e.pointerId); setSpin(false); }}
        onPointerMove={e => { if (!drag.current) return; view.current.facing = dragFacing(drag.current.facing, e.clientX - drag.current.x); schedule(); }}
        onPointerUp={() => { drag.current = null; setFacing(view.current.facing); }} onPointerCancel={() => { drag.current = null; }}
        onWheel={e => { if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return; setZoomOverride(z => clampZoom((z ?? zoom) + (e.deltaY < 0 ? 1 : -1), MAX_ZOOM)); }}
        onKeyDown={e => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") { if (!canTurn) return; view.current.facing = (view.current.facing + (e.key === "ArrowLeft" ? FACING_STEP : -FACING_STEP) + 1024) % 1024; setFacing(view.current.facing); schedule(); e.preventDefault(); }
          else if (e.key === " ") { if (canTurn) setSpin(s => !s); e.preventDefault(); }
          else if (e.key === "+" || e.key === "=") setZoomOverride(clampZoom(zoom + 1, MAX_ZOOM));
          else if (e.key === "-") setZoomOverride(clampZoom(zoom - 1, MAX_ZOOM));
        }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
        {tag && <div className="viewer-stage-tag">{tag}</div>}
      </div>
      <div className="viewer-controls">
        {actions.length > 0 && <div className="viewer-actions" role="group" aria-label="Actions">
          {actions.map(a => <button key={a.id} type="button" aria-pressed={animation === a.id} onClick={() => (animation === a.id ? setPlaying(p => !p) : choose(a.id))}>
            {animation === a.id && playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}{a.label}</button>)}
        </div>}
        <div className="viewer-tools">
          <div className="viewer-colors" role="radiogroup" aria-label="Player colour">
            {houseColors.map(c => <button key={c.id} type="button" role="radio" aria-checked={color === c.hex} aria-label={c.name} title={c.name} style={{ background: `#${c.hex}` }} onClick={() => onColor(c.hex)} />)}
          </div>
          {canTurn && <button type="button" className="viewer-tool" aria-pressed={spin} onClick={() => setSpin(s => !s)} title="Spin (Space)"><RotateCw size={15} aria-hidden="true" /><span>Spin</span></button>}
          <div className="viewer-zoom" role="group" aria-label="Zoom">
            <button type="button" className="viewer-tool" aria-label="Zoom out" onClick={() => setZoomOverride(clampZoom(zoom - 1, MAX_ZOOM))} disabled={zoom <= 1}><Minus size={15} aria-hidden="true" /></button>
            <span>{zoom}×</span>
            <button type="button" className="viewer-tool" aria-label="Zoom in" onClick={() => setZoomOverride(clampZoom(zoom + 1, MAX_ZOOM))} disabled={zoom >= MAX_ZOOM}><Plus size={15} aria-hidden="true" /></button>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
