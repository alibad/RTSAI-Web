"use client";

import { Box, Layers, Minus, Plus, RotateCw } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cellZoom, clampZoom, dragFacing, dragTurret, fitZoom, lineupFacings } from "../../../../lib/art-lab/review-ui";
import { pickAnimation, spriteAnimations } from "../../../../lib/art-lab/sprite-anim";
import { facingLabel } from "../../../../lib/art-lab/voxel-math";
import { voxelAnimationParts,voxelAnimationFrames } from "../../../../lib/art-lab/voxel-animation";
import { houseColors } from "../../../../lib/art-lab/remap";
import { tintFor, type MapTint } from "../viewSettings";
import type { StageLabel } from "../voxel-three";
import { defaultVisibility, frameRadius, type Frame, type FrameStore, type Pose, type StageItem } from "./frames";
import { groundStrip, groundTile, groundWidth } from "./ground";
import { CompareToggle } from "./ImageStages";
import { setLab, useLab, type Compare, type LabView } from "./lab-store";
import { comparePair, type Version } from "./versions";
import { AnimationTransport } from "./AnimationTransport";

export const DEFAULT_FACING = 896;

/** "Reference · Grizzly Battle Tank" for the original unit compared against; else the version's label. */
export const tagText = (v: Version | null | undefined) => (v?.reference ? `Reference · ${v.reference.name}` : v?.kind === "candidate" ? `${v.label} · candidate` : v?.label ?? "");
/** The light note sits under the pane tag, so it never runs into the compare switch. */
const TagNote = ({ v, right = false }: { v: Version | null | undefined; right?: boolean }) => (v?.note ? <span className={`lab-tag-note${right ? " is-right-half" : ""}`}>{v.note}</span> : null);

export const poseFrom = (s: LabView, tints: MapTint[], facing = s.facing, tick = 0): Pose => ({
  facing, turret: s.turret, tick,timeMs:s.animationTime,loop:!/(^die|^make$|deploy|takeoff|^land$|^liedown$|^standup$)/.test(s.animation), animation: s.animation, color: s.color, shadow: s.shadow, tint: tintFor(s.tintMap, tints),
});

/** The unit's turning circle at 1x (from what is in game now at the default facing); null while loading. */
export function useUnitRadius(frames: FrameStore, item: StageItem | null, tints: MapTint[]) {
  const [found, setFound] = useState<{ id: string; radius: number } | null>(null);
  useEffect(() => {
    if (!item) return;
    let off = () => {};
    const check = () => {
      const f = frames.get(item, poseFrom({ ...useLab.getState(), turret: 0 }, tints, DEFAULT_FACING));
      if (!f) return;
      const radius = Math.max(8, Math.ceil(frameRadius(f)));
      setFound(prev => (prev?.id === item.spec.id && prev.radius === radius ? prev : { id: item.spec.id, radius }));
      off();
    };
    off = frames.subscribe(check);
    queueMicrotask(check);
    return () => off();
  }, [frames, item, tints]);
  return item && found?.id === item.spec.id ? found.radius : null;
}

/** Calls `draw` at most once per animation frame, only when asked (never on a loop). */
function useDrawScheduler(draw: () => void) {
  const drawRef = useRef(draw);
  const pending = useRef(0);
  useLayoutEffect(() => { drawRef.current = draw; });
  const schedule = useMemo(() => () => {
    if (pending.current) return;
    pending.current = requestAnimationFrame(() => { pending.current = 0; drawRef.current(); });
  }, []);
  useEffect(() => () => cancelAnimationFrame(pending.current), []);
  return schedule;
}

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const r = entries[0].contentRect;
      setSize(s => (s.width === Math.round(r.width) && s.height === Math.round(r.height) ? s : { width: Math.round(r.width), height: Math.round(r.height) }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/**
 * Sizes a canvas to its CSS box at the device pixel ratio and returns a context in DEVICE pixels, so every game
 * pixel lands on a whole number of device pixels at any display scale.
 */
function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  return { ctx, dpr };
}

type Picture = { canvas: HTMLCanvasElement; width: number; height: number; anchorX: number; anchorY: number };
/** Draws a 1x picture with its anchor at CSS point (cx, cy), `zoom` CSS pixels per game pixel. */
function put(ctx: CanvasRenderingContext2D, dpr: number, p: Picture, cx: number, cy: number, zoom: number) {
  const z = Math.max(1, Math.round(zoom * dpr));
  ctx.drawImage(p.canvas, Math.round(cx * dpr) - p.anchorX * z, Math.round(cy * dpr) - p.anchorY * z, p.width * z, p.height * z);
}

/** The 1x inset: the focused version at true player size. */
function Inset({ item, frames, tints, radius }: { item: StageItem | null; frames: FrameStore; tints: MapTint[]; radius: number | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const draw = () => {
    const canvas = ref.current;
    if (!canvas || !item) return;
    const s = useLab.getState();
    const pose = poseFrom(s, tints);
    const f = frames.get(item, pose);
    if (!f) return;
    const { ctx, dpr } = prepareCanvas(canvas, 152, 104);
    put(ctx, dpr, groundTile(s.ground, pose.tint, groundWidth(radius)), 76, 60, 1);
    put(ctx, dpr, f, 76, 60, 1);
  };
  const schedule = useDrawScheduler(draw);
  useEffect(() => {
    schedule();
    const offLab = useLab.subscribe((s, p) => { if (s.facing !== p.facing || s.turret !== p.turret || s.color !== p.color || s.shadow !== p.shadow || s.tintMap !== p.tintMap || s.ground !== p.ground || s.animation !== p.animation||s.animationTime!==p.animationTime) schedule(); });
    const offFrames = frames.subscribe(schedule);
    return () => { offLab(); offFrames(); };
  }, [schedule, frames, item, radius]);
  return (
    <div className="lab-inset" title="True player size (1×)">
      <canvas ref={ref} style={{ width: 152, height: 104 }} aria-label="At true size" role="img" />
      <span className="lab-chip">1×</span>
    </div>
  );
}

function FacingReadout() {
  const facing = useLab(s => s.facing);
  return <span className="lab-readout" title={`Facing ${facing}`}>{facingLabel(facing)}</span>;
}

/**
 * The model stage: the focused version large and pixel-perfect on a ground tile. Drag turns it, Shift+drag (or
 * right-drag) turns the turret, the wheel zooms in whole steps, Space spins. Voxels can switch to a 3D orbit or
 * an exploded view. Compare modes put Current next to (or under) a candidate, or every version in a lineup.
 */
export function ModelStage({ versions, focus, allowCompare, frames, tints, unitId, radius, onFocus }: {
  versions: Version[];
  focus: number;
  allowCompare: boolean;
  frames: FrameStore;
  tints: MapTint[];
  unitId: string;
  radius: number | null;
  onFocus: (index: number) => void;
}) {
  const [stageRef, size] = useElementSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glHostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);
  const tick = useRef(0);
  const drawn = useRef({ zoom: 1, max: 6, rows: [] as { y0: number; y1: number; index: number }[] });
  const lineupZoom = useRef(new Map<string, { fit: number; up: number; down: number; cols: { left: number; right: number }[] }>());
  /** The last picture drawn per item: shown while the next facing or turret angle is on its way from the GPU. */
  const lastFrame = useRef(new Map<string, Frame>());
  const compareRaw = useLab(s => s.compare);
  const view3d = useLab(s => s.view3d);
  const playing = useLab(s => s.playing);
  const animation = useLab(s => s.animation);
  const lineupCount = useLab(s => s.lineupFacings);
  const assets = useSyncExternalStore(frames.subscribeAssets, frames.getAssetsVersion, frames.getAssetsVersion);
  const focused = versions[Math.min(focus, versions.length - 1)];
  const pair = comparePair(versions, focus);
  const compare: Compare = allowCompare && pair ? compareRaw : "single";
  const isVoxel = Boolean(focused?.item?.spec.voxel);
  const canTurn = isVoxel || Math.abs(pickAnimation(focused?.item?.sprite ?? null, animation)?.body?.facings ?? 1) > 1;
  const canAim = isVoxel ? Boolean(focused?.item?.spec.voxel?.parts.some(p => p.turretOffset !== null)) : Boolean(focused?.item?.sprite?.turret);
  const is3d = compare === "single" && view3d !== "off" && isVoxel;
  const animations = useMemo(() => (focused?.item ? focused.item.spec.voxel ? voxelAnimationParts(focused.item.spec).length?[{id:"body",label:"HVA cycle"}]:[] : spriteAnimations(focused.item.sprite) : []), [focused]);
  const anim = useMemo(() => (focused?.item ? frames.animationInfo(focused.item, animation) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `assets` re-reads the cache after loads
    [frames, focused, animation, assets]);
  const error = focused?.item ? frames.failed(focused.item) : focused ? "This version has no files the game could draw" : null;

  const draw = () => {
    const canvas = canvasRef.current;
    const W = size.width, H = size.height;
    if (!canvas || !W || !H || !focused) return;
    const { ctx, dpr } = prepareCanvas(canvas, W, H);
    const s = useLab.getState();
    const base = poseFrom(s, tints, s.facing, tick.current);
    const ground = groundTile(s.ground, base.tint, groundWidth(radius));
    const r = radius ?? 40;
    // The focused pictures render on demand (1-2 ms each); lineup cells come from the warmed cache.
    const unit = (v: Version | undefined, cx: number, cy: number, zoom: number, facing = s.facing, t = tick.current, now = true) => {
      if (!v?.item) return;
      const pose = { ...base, facing, tick: t };
      const f = now ? frames.get(v.item, pose) ?? lastFrame.current.get(v.item.spec.id) : frames.peek(v.item, pose);
      if (f) { put(ctx, dpr, f, cx, cy, zoom); if (now) lastFrame.current.set(v.item.spec.id, f); }
      else if (!now) frames.want(v.item, pose, true);
    };
    const setZoom = (zoom: number, max: number) => {
      drawn.current.zoom = zoom; drawn.current.max = max;
      if (zoomRef.current) zoomRef.current.textContent = `${zoom}×`;
    };
    if (handleRef.current) handleRef.current.style.left = `${Math.round(s.swipe * W)}px`;
    if (is3d) return;

    if (compare === "lineup") {
      const facings = lineupFacings(s.lineupFacings, s.facing - DEFAULT_FACING);
      const rows = versions.filter(v => v.item);
      const gutter = 96, pad = 16, top = 64;
      const gridW = W - gutter - 2 * pad, gridH = H - top - pad;
      const cellW = gridW / facings.length, cellH = gridH / Math.max(1, rows.length);
      // One zoom and row baseline per unit and layout, from every version at the base facings (so dragging never
      // re-zooms); each picture's real extents above and below its centre decide how tall a row must be.
      const lockKey = `${unitId}|${rows.length}|${facings.length}|${W}x${H}`;
      let lock = lineupZoom.current.get(lockKey);
      if (!lock) {
        const base4 = lineupFacings(s.lineupFacings);
        const cols = base4.map(() => ({ left: 0, right: 0 }));
        let up = 0, down = 0, all = true;
        for (const v of rows) base4.forEach((facing, ci) => {
          const pose = { ...base, facing, tick: 0 };
          const f = frames.peek(v.item!, pose);
          if (!f) { all = false; frames.want(v.item!, pose, true); return; }
          cols[ci].left = Math.max(cols[ci].left, -f.left); cols[ci].right = Math.max(cols[ci].right, f.right);
          up = Math.max(up, -f.top); down = Math.max(down, f.bottom);
        });
        // Until every picture is cached, estimate from the turning circle.
        if (!up) { up = r * 0.65; down = r * 0.45; for (const c of cols) { c.left = r * 0.9; c.right = r * 0.9; } }
        const fit = Math.min(...cols.map(c => cellZoom(c.left + c.right + 2, up + down + 2, cellW, cellH)));
        lock = { fit, up, down, cols };
        if (all) lineupZoom.current.set(lockKey, lock);
      }
      const fit = lock.fit;
      const zoom = clampZoom(s.zoom ?? fit, fit + 1);
      setZoom(zoom, fit + 1);
      // The centre sits so the tallest picture's top and the lowest shadow both fit the row.
      const baseline = Math.max(3 + lock.up * zoom, (cellH - (lock.up + lock.down) * zoom) / 2 + lock.up * zoom);
      const x0 = gutter + pad, gridBottom = top + cellH * rows.length;
      const strip = groundStrip(s.ground, base.tint, Math.ceil(gridW / zoom) + 1, Math.ceil((gridBottom - top) / zoom) + 1);
      ctx.save();
      ctx.beginPath(); ctx.rect(Math.round(x0 * dpr), Math.round(top * dpr), Math.round(gridW * dpr), Math.round((gridBottom - top) * dpr)); ctx.clip();
      put(ctx, dpr, strip, x0, top, zoom);
      const hits: { y0: number; y1: number; index: number }[] = [];
      rows.forEach((v, ri) => {
        const y0 = top + ri * cellH;
        // Each column centres its pictures' bounding box (a long barrel does not push the hull off-centre).
        for (let ci = 0; ci < facings.length; ci++) {
          const c = lock.cols[ci];
          unit(v, x0 + (ci + 0.5) * cellW + ((c.left - c.right) / 2) * zoom, y0 + baseline, zoom, facings[ci], 0, false);
        }
        hits.push({ y0, y1: y0 + cellH, index: versions.indexOf(v) });
      });
      ctx.restore();
      ctx.font = `600 ${Math.round(14 * dpr)}px ${getComputedStyle(canvas).fontFamily}`;
      ctx.textBaseline = "middle";
      for (const h of hits) {
        const isFocus = h.index === focus;
        if (isFocus) {
          ctx.strokeStyle = "#f1d28b";
          ctx.lineWidth = Math.round(2 * dpr);
          ctx.strokeRect(Math.round(x0 * dpr), Math.round(h.y0 * dpr) + ctx.lineWidth / 2, Math.round(gridW * dpr), Math.round((h.y1 - h.y0) * dpr) - ctx.lineWidth);
        }
        const v = versions[h.index];
        const mid = Math.round(((h.y0 + h.y1) / 2) * dpr);
        ctx.fillStyle = isFocus ? "#f0eee6" : "#9c9c91";
        ctx.fillText(v.label, Math.round(pad * dpr), v.reference ? mid - Math.round(9 * dpr) : mid);
        if (v.reference) {
          // The original unit's name under "Reference", cut to the gutter.
          ctx.font = `500 ${Math.round(12 * dpr)}px ${getComputedStyle(canvas).fontFamily}`;
          let name = v.reference.name;
          while (name.length > 3 && ctx.measureText(name).width > (gutter + pad - 16) * dpr) name = name.slice(0, -2).trimEnd() + "…";
          ctx.fillStyle = "#73776d";
          ctx.fillText(name, Math.round(pad * dpr), mid + Math.round(9 * dpr));
          ctx.font = `600 ${Math.round(14 * dpr)}px ${getComputedStyle(canvas).fontFamily}`;
        }
      }
      drawn.current.rows = hits;
      return;
    }

    if (compare === "side" && pair) {
      const paneW = W / 2;
      const fit = fitZoom(r, paneW, H, 6, 0.8);
      const max = Math.max(fit, fitZoom(r, paneW, H, 6, 0.98));
      const zoom = clampZoom(s.zoom ?? fit, max);
      setZoom(zoom, max);
      pair.forEach((index, k) => {
        const cx = Math.round(paneW * k + paneW / 2), cy = Math.round(H * 0.54);
        ctx.save();
        ctx.beginPath(); ctx.rect(Math.round(paneW * k * dpr), 0, Math.round(paneW * dpr), Math.round(H * dpr)); ctx.clip();
        put(ctx, dpr, ground, cx, cy, zoom);
        unit(versions[index], cx, cy, zoom);
        ctx.restore();
      });
      ctx.fillStyle = "rgba(240, 238, 230, 0.14)";
      ctx.fillRect(Math.round(paneW * dpr), 0, Math.max(1, Math.round(dpr)), Math.round(H * dpr));
      return;
    }

    const fit = fitZoom(r, W, H, 6, 0.8);
    const max = Math.max(fit, fitZoom(r, W, H, 6, 0.98));
    const zoom = clampZoom(s.zoom ?? fit, max);
    setZoom(zoom, max);
    const cx = Math.round(W / 2), cy = Math.round(H * 0.54);
    put(ctx, dpr, ground, cx, cy, zoom);
    if (compare === "swipe" && pair) {
      const x = Math.round(s.swipe * W * dpr);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, x, H * dpr); ctx.clip(); unit(versions[pair[0]], cx, cy, zoom); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(x, 0, W * dpr - x, H * dpr); ctx.clip(); unit(versions[pair[1]], cx, cy, zoom); ctx.restore();
      ctx.fillStyle = "#f0eee6";
      ctx.fillRect(x - Math.round(dpr), 0, Math.max(2, Math.round(2 * dpr)), Math.round(H * dpr));
      return;
    }
    unit(focused, cx, cy, zoom);
  };
  const schedule = useDrawScheduler(draw);

  // Redraw on any change that affects the picture; never on a timer.
  useLayoutEffect(() => { schedule(); });
  useEffect(() => {
    const offLab = useLab.subscribe((s, p) => {
      if (s.facing !== p.facing || s.turret !== p.turret || s.color !== p.color || s.shadow !== p.shadow || s.tintMap !== p.tintMap
        || s.ground !== p.ground || s.swipe !== p.swipe || s.lineupFacings !== p.lineupFacings || s.animation !== p.animation || s.animationTime!==p.animationTime||s.zoom !== p.zoom) schedule();
    });
    const offFrames = frames.subscribe(schedule);
    return () => { offLab(); offFrames(); };
  }, [frames, schedule]);

  // Warm the cache: every version at this facing (the filmstrip), then every facing of the focused version
  // nearest first (dragging). Other versions warm when they are focused; the lineup asks for its own cells.
  useEffect(() => {
    const warm = () => {
      frames.clearQueue();
      const s = useLab.getState();
      versions.forEach((v, i) => { if (v.item && i !== focus) frames.want(v.item, poseFrom(s, tints, s.facing, 0)); });
      const item = versions[focus]?.item;
      if (!item) return;
      for (let i = 0; i < 32; i++) frames.want(item, poseFrom(s, tints, (s.facing + 32 * (i % 2 ? -(i + 1) / 2 : i / 2) + 2048) % 1024, 0));
    };
    warm();
    return useLab.subscribe((s, p) => { if (s.color !== p.color || s.shadow !== p.shadow || s.tintMap !== p.tintMap || s.animation !== p.animation || s.turret !== p.turret) warm(); });
  }, [frames, versions, focus, tints]);

  // Sprite animation: advance only while the picture changes, the stage is visible and Play is on.
  useEffect(() => {
    const visible=compare==="single"?[focused]:versions;
    const infos=visible.flatMap(v=>v.item?[frames.animationInfo(v.item,animation)].filter((i):i is NonNullable<typeof i>=>Boolean(i)):[]);
    const animated=infos.filter(i=>i.animates);
    if (!playing || !animated.length) return;
    const interval=Math.max(16,Math.min(...animated.map(i=>i.tickMs))),duration=Math.max(...infos.map(i=>i.durationMs));
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      if (!document.hidden) { tick.current++;setLab(s=>({animationTime:s.animationTime+interval}));schedule(); }
      if (/(^die|^make$|deploy|takeoff|^land$|^liedown$|^standup$)/.test(animation)&&useLab.getState().animationTime>=duration){setLab({playing:false});return;}
      timer = setTimeout(step, interval);
    };
    timer = setTimeout(step, interval);
    return () => clearTimeout(timer);
  }, [playing, anim, is3d, schedule,compare,focused,versions,frames,animation,assets]);
  useEffect(() => { tick.current = 0;setLab({animationTime:0}); }, [focused, animation]);

  // 3D orbit / exploded view through the page's single WebGL context.
  useEffect(() => {
    if (!is3d || !focused?.item) return;
    const host = glHostRef.current;
    const labelHost = labelsRef.current;
    const item = focused.item;
    let attached = false;
    const labels = (list: StageLabel[]) => {
      const el = labelHost;
      if (!el) return;
      el.replaceChildren(...list.map(l => {
        const span = document.createElement("span");
        span.className = `lab-part-label is-${l.kind}`;
        span.textContent = l.text.replace(/\s*\(.*\)\s*$/, "");
        span.style.left = `${l.x}px`;
        span.style.top = `${l.y}px`;
        return span;
      }));
    };
    const show = () => {
      const s = useLab.getState();
      const loaded = frames.model(item, s.color);
      const engine = frames.engine;
      if (!loaded || !engine || !host) return;
      if (!attached) { engine.attach(host); attached = true; }
      engine.show({
        model: loaded.model, palette: loaded.palette, onLabels: s.view3d === "exploded" ? labels : () => labels([]),
        pose: { mode: s.view3d === "exploded" ? "exploded" : "orbit", facing: s.facing, turretFacing: s.turret, frame: 0,partFrames:voxelAnimationFrames(item.spec,s.animationTime), visible: defaultVisibility(item.spec), shadow: false, airborne: false },
      });
    };
    show();
    const offLab = useLab.subscribe((s, p) => { if (s.facing !== p.facing || s.turret !== p.turret || s.color !== p.color || s.view3d !== p.view3d||s.animationTime!==p.animationTime) show(); });
    const offFrames = frames.subscribe(kind => { if (kind === "assets") show(); });
    const observer = new ResizeObserver(() => frames.engine?.resize());
    if (host) observer.observe(host);
    return () => {
      offLab(); offFrames(); observer.disconnect();
      if (attached) frames.engine?.detach();
      labelHost?.replaceChildren();
    };
  }, [is3d, focused, frames]);

  // Wheel: whole zoom steps (the canvas redraws at the new scale; nothing scrolls). In 3D the orbit camera zooms.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if (is3d || (e.target as HTMLElement).closest(".lab-corner, .lab-animation-row")) return;
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 40) return;
      const dir = acc < 0 ? 1 : -1;
      acc = 0;
      const { zoom, max } = drawn.current;
      const next = clampZoom(zoom + dir, max);
      if (next !== zoom) setLab({ zoom: next });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stageRef, is3d]);

  const drag = useRef<{ x: number; facing: number; turret: number; turn: "body" | "turret" | "swipe"; moved: boolean; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (is3d || target.closest(".lab-corner, .lab-animation-row, button, input, select") || (e.button !== 0 && e.button !== 2)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = useLab.getState();
    const turn = target.closest(".lab-swipe-handle") ? "swipe" : e.shiftKey || e.button === 2 ? "turret" : "body";
    drag.current = { x: e.clientX, facing: s.facing, turret: s.turret, turn, moved: false, id: e.pointerId };
    if (s.spin) setLab({ spin: false });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    if (d.turn === "swipe") {
      const rect = e.currentTarget.getBoundingClientRect();
      setLab({ swipe: Math.min(0.98, Math.max(0.02, (e.clientX - rect.left) / rect.width)) });
    } else if (d.turn === "turret" && canAim) setLab({ turret: dragTurret(d.turret, dx) });
    else if (d.turn === "body" && canTurn) setLab({ facing: dragFacing(d.facing, dx) });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved && compare === "lineup") {
      const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
      const hit = drawn.current.rows.find(r => y >= r.y0 && y < r.y1);
      if (hit && hit.index !== focus) onFocus(hit.index);
    }
  };

  const partner = pair ? versions[pair[1]] : null;
  const playable = animations.length > 0;
  return (
    <div ref={stageRef} className={`lab-stage is-${compare}${is3d ? " is-3d" : ""}${canTurn ? "" : " is-fixed"}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onContextMenu={e => e.preventDefault()} role="application" aria-label={`${focused?.label ?? "Unit"}: ${canTurn ? "drag to turn" : "fixed authored view"}${canAim ? ", Shift+drag turns the turret" : ""}, scroll to zoom`}>
      <canvas ref={canvasRef} className="lab-stage-canvas" />
      <div ref={glHostRef} className="lab-stage-gl" hidden={!is3d} />
      <div ref={labelsRef} className="lab-stage-labels" hidden={!is3d} />
      {error && <p className="lab-stage-note">{error}</p>}

      {compare === "side" && pair ? (
        <>
          <span className="lab-tag lab-pane-tag">{versions[pair[0]].label}</span>
          <span className="lab-tag lab-pane-tag is-right-half">{tagText(partner)}</span>
          <TagNote v={partner} right />
        </>
      ) : compare === "swipe" && pair ? (
        <>
          <span className="lab-tag lab-pane-tag">{versions[pair[0]].label}</span>
          <span className="lab-tag lab-pane-tag is-right">{tagText(partner)}</span>
          <button ref={handleRef} type="button" className="lab-swipe-handle" aria-label="Drag to compare" />
        </>
      ) : compare === "single" ? <><span className="lab-tag lab-pane-tag">{tagText(focused)}</span><TagNote v={focused} /></> : null}

      {allowCompare && (
        <div className="lab-corner is-tr">
          <CompareToggle compare={compare} enabled={Boolean(pair)} />
          {compare === "lineup" && (
            <div className="lab-seg" role="radiogroup" aria-label="Facings">
              {([4, 8] as const).map(n => <button key={n} type="button" role="radio" aria-checked={lineupCount === n} onClick={() => setLab({ lineupFacings: n })}>{n}</button>)}
            </div>
          )}
        </div>
      )}

      {compare !== "lineup" && <div className="lab-corner is-bl"><Inset item={focused?.item ?? null} frames={frames} tints={tints} radius={radius} /></div>}
      {anim?.animates&&compare!=="lineup"&&<div className="lab-animation-row"><AnimationTransport info={anim}/></div>}

      <div className="lab-corner is-br">
        <PlayerColours />
        {playable && (
          <div className="lab-seg">
            <select aria-label="Animation" value={animations.some(a => a.id === animation) ? animation : animations[0]?.id} onChange={e => setLab({ animation: e.target.value, playing: true })}>
              {animations.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
        )}
        {isVoxel && compare === "single" && (
          <div className="lab-seg" role="group" aria-label="3D">
            <button type="button" aria-pressed={view3d !== "off"} onClick={() => setLab({ view3d: view3d === "off" ? "orbit" : "off" })} title="Free orbit"><Box size={14} /><span>3D</span></button>
            <button type="button" aria-pressed={view3d === "exploded"} onClick={() => setLab({ view3d: view3d === "exploded" ? "orbit" : "exploded" })} title="Separate the parts"><Layers size={14} /><span>Explode</span></button>
          </div>
        )}
        <div className="lab-seg">
          <SpinButton disabled={!canTurn} />
          {canTurn ? <FacingReadout /> : <span className="lab-readout">Fixed view</span>}
        </div>
        {!is3d && (
          <div className="lab-seg" role="group" aria-label="Zoom">
            <button type="button" onClick={() => setLab({ zoom: clampZoom(drawn.current.zoom - 1, drawn.current.max) })} aria-label="Zoom out"><Minus size={14} /></button>
            <span ref={zoomRef} className="lab-readout" aria-live="off" />
            <button type="button" onClick={() => setLab({ zoom: clampZoom(drawn.current.zoom + 1, drawn.current.max) })} aria-label="Zoom in"><Plus size={14} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The six lobby colours, one click each (P cycles them). */
function PlayerColours() {
  const color = useLab(s => s.color);
  return <div className="lab-seg lab-colours" role="radiogroup" aria-label="Player colour">
    {houseColors.map(c => <button key={c.id} type="button" role="radio" className="glb-swatch" aria-checked={color === c.hex} aria-label={c.name} title={`${c.name} (P)`} style={{ ["--swatch" as string]: `#${c.hex}` }} onClick={() => setLab({ color: c.hex })} />)}
  </div>;
}

function SpinButton({ disabled = false }: { disabled?: boolean }) {
  const spin = useLab(s => s.spin);
  return <button type="button" disabled={disabled} aria-pressed={!disabled && spin} onClick={() => setLab({ spin: !spin })} title={disabled ? "One authored view; a flat building sprite cannot rotate" : "Spin (Space)"}><RotateCw size={14} /><span>Spin</span></button>;
}
