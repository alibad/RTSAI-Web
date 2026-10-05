"use client";

/* Candidate images come from the local dev route at their own sizes; next/image cannot serve them. */
/* eslint-disable @next/next/no-img-element */
import { Columns2, Maximize, Minus, Plus, Rows3, Square, SquareSplitHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clampZoom } from "../../../../lib/art-lab/review-ui";
import { setLab, useLab, type Compare } from "./lab-store";
import { comparePair, type ReviewUnit, type Version } from "./versions";
import { usePlayerColorImage } from "./usePlayerColorImage";

const CAMEO_W = 60, CAMEO_H = 48;

const images = new Map<string, HTMLImageElement>();
/** A decoded image from the cache, or null (it starts loading and `onLoad` fires once). */
function cachedImage(url: string, onLoad: () => void) {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.src = url;
    images.set(url, img);
  }
  if (img.complete && img.naturalWidth) return img;
  img.addEventListener("load", onLoad, { once: true });
  return null;
}

/** Warms the browser cache for images the user is likely to look at next. */
export function preloadImages(urls: (string | null | undefined)[]) {
  for (const url of urls) if (url) cachedImage(url, () => undefined);
}

function useSize<T extends HTMLElement>() {
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

const compareModes: { id: Compare; label: string; icon: React.ReactNode }[] = [
  { id: "single", label: "Single", icon: <Square size={14} /> },
  { id: "side", label: "Side by side", icon: <Columns2 size={14} /> },
  { id: "swipe", label: "Swipe", icon: <SquareSplitHorizontal size={14} /> },
  { id: "lineup", label: "Lineup", icon: <Rows3 size={14} /> },
];

export function CompareToggle({ compare, enabled }: { compare: Compare; enabled: boolean }) {
  return (
    <div className="lab-seg" role="radiogroup" aria-label="Compare">
      {compareModes.map(m => (
        <button key={m.id} type="button" role="radio" aria-checked={compare === m.id} disabled={m.id !== "single" && !enabled} onClick={() => setLab({ compare: m.id, zoom: null })} title={m.label}>
          {m.icon}<span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The faction's build palette around this unit, at 1x, with this slot showing the focused icon. */
function SidebarStrip({ unit, units, cameo }: { unit: ReviewUnit; units: ReviewUnit[]; cameo: string | null }) {
  const queue = useMemo(() => units.filter(u => u.factionId === unit.factionId && u.queue === unit.queue).sort((a, b) => a.order - b.order), [units, unit]);
  const at = queue.findIndex(u => u.id === unit.id);
  const start = Math.max(0, Math.min(at - 3, queue.length - 7));
  const shown = queue.slice(start, start + 7);
  return (
    <div className="lab-sidebar" title="In the build sidebar (1×)">
      <div className="lab-sidebar-row">
        {shown.map(u => {
          const src = u.id === unit.id ? cameo : u.spec.cameo;
          return <span key={u.id} className={u.id === unit.id ? "is-this" : undefined}>{src ? <img src={src} width={CAMEO_W} height={CAMEO_H} alt={u.id === unit.id ? `${u.name} (this slot)` : u.name} /> : null}</span>;
        })}
      </div>
      <span className="lab-chip">Sidebar 1×</span>
    </div>
  );
}

/**
 * The icon slot: the focused cameo huge and pixel-perfect (whole-number zoom up to 6x), the build sidebar at 1x,
 * and the same compare modes as the model stage.
 */
export function IconStage({ versions, focus, unit, units, onFocus }: { versions: Version[]; focus: number; unit: ReviewUnit; units: ReviewUnit[]; onFocus: (i: number) => void }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const zoomRef = useRef<HTMLSpanElement>(null);
  const drawn = useRef({ zoom: 1, max: 6, cells: [] as { x0: number; x1: number; y0: number; y1: number; index: number }[] });
  const compareRaw = useLab(s => s.compare);
  const pair = comparePair(versions, focus);
  const compare: Compare = pair ? compareRaw : "single";
  const focused = versions[Math.min(focus, versions.length - 1)];
  const [, setLoaded] = useState(0);

  const draw = () => {
    const canvas = canvasRef.current;
    const W = size.width, H = size.height;
    if (!canvas || !W || !H) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.round(W * dpr), h = Math.round(H * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    const s = useLab.getState();
    const onLoad = () => setLoaded(n => n + 1);
    const icon = (v: Version | undefined, cx: number, cy: number, zoom: number) => {
      if (!v?.image) return;
      const img = cachedImage(v.image, onLoad);
      if (!img) return;
      const z = Math.max(1, Math.round(zoom * dpr));
      const iw = img.naturalWidth * z, ih = img.naturalHeight * z;
      ctx.drawImage(img, Math.round(cx * dpr - iw / 2), Math.round(cy * dpr - ih / 2), iw, ih);
    };
    const fitFor = (pw: number, ph: number) => Math.max(1, Math.min(6, Math.floor(Math.min((pw * 0.62) / CAMEO_W, (ph * 0.6) / CAMEO_H))));
    const setZoom = (zoom: number, max: number) => {
      drawn.current.zoom = zoom; drawn.current.max = max;
      if (zoomRef.current) zoomRef.current.textContent = `${zoom}×`;
    };
    if (handleRef.current) handleRef.current.style.left = `${Math.round(s.swipe * W)}px`;
    if (compare === "lineup") {
      const n = versions.length;
      let best = { cols: n, zoom: 1 };
      for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const zoom = Math.max(1, Math.min(6, Math.floor(Math.min((W - 48) / cols / (CAMEO_W + 8), (H - 112) / rows / (CAMEO_H + 16)))));
        if (zoom > best.zoom) best = { cols, zoom };
      }
      const zoom = clampZoom(s.zoom ?? best.zoom, best.zoom);
      setZoom(zoom, best.zoom);
      const cols = best.cols, rows = Math.ceil(n / cols);
      const cellW = (W - 48) / cols, cellH = (H - 112) / rows;
      const cells: typeof drawn.current.cells = [];
      ctx.font = `600 ${Math.round(14 * dpr)}px ${getComputedStyle(canvas).fontFamily}`;
      ctx.textAlign = "center";
      versions.forEach((v, i) => {
        const x0 = 24 + (i % cols) * cellW, y0 = 64 + Math.floor(i / cols) * cellH;
        const cx = Math.round(x0 + cellW / 2), cy = Math.round(y0 + cellH / 2 - 8);
        icon(v, cx, cy, zoom);
        const bw = CAMEO_W * zoom, bh = CAMEO_H * zoom;
        if (i === focus) {
          ctx.strokeStyle = "#f1d28b"; ctx.lineWidth = Math.round(2 * dpr);
          ctx.strokeRect(Math.round((cx - bw / 2 - 4) * dpr), Math.round((cy - bh / 2 - 4) * dpr), Math.round((bw + 8) * dpr), Math.round((bh + 8) * dpr));
        }
        ctx.fillStyle = i === focus ? "#f0eee6" : "#9c9c91";
        ctx.fillText(v.label, Math.round(cx * dpr), Math.round((cy + bh / 2 + 22) * dpr));
        cells.push({ x0, x1: x0 + cellW, y0, y1: y0 + cellH, index: i });
      });
      drawn.current.cells = cells;
      return;
    }
    if (compare === "side" && pair) {
      const fit = fitFor(W / 2, H);
      const zoom = clampZoom(s.zoom ?? fit, fit);
      setZoom(zoom, fit);
      pair.forEach((index, k) => icon(versions[index], W / 4 + (k * W) / 2, H / 2, zoom));
      ctx.fillStyle = "rgba(240, 238, 230, 0.14)";
      ctx.fillRect(Math.round((W / 2) * dpr), 0, Math.max(1, Math.round(dpr)), h);
      return;
    }
    const fit = fitFor(W, H);
    const zoom = clampZoom(s.zoom ?? fit, fit);
    setZoom(zoom, fit);
    if (compare === "swipe" && pair) {
      const x = Math.round(s.swipe * w);
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, x, h); ctx.clip(); icon(versions[pair[0]], W / 2, H / 2, zoom); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.rect(x, 0, w - x, h); ctx.clip(); icon(versions[pair[1]], W / 2, H / 2, zoom); ctx.restore();
      ctx.fillStyle = "#f0eee6";
      ctx.fillRect(x - Math.round(dpr), 0, Math.max(2, Math.round(2 * dpr)), h);
      return;
    }
    icon(focused, W / 2, H / 2, zoom);
  };
  const drawRef = useRef(draw);
  useLayoutEffect(() => { drawRef.current = draw; drawRef.current(); });
  useEffect(() => useLab.subscribe((s, p) => { if (s.swipe !== p.swipe || s.zoom !== p.zoom) drawRef.current(); }), []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".lab-corner")) return;
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < 40) return;
      const dir = acc < 0 ? 1 : -1;
      acc = 0;
      const next = clampZoom(drawn.current.zoom + dir, drawn.current.max);
      if (next !== drawn.current.zoom) setLab({ zoom: next });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);

  const dragging = useRef<number | null>(null);
  return (
    <div ref={ref} className={`lab-stage is-icon is-${compare}`} role="application" aria-label={`${focused?.label ?? "Icon"}: scroll to zoom`}
      onPointerDown={e => {
        const target = e.target as HTMLElement;
        if (target.closest(".lab-corner")) return;
        if (target.closest(".lab-swipe-handle")) { dragging.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); return; }
        if (compare === "lineup") {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left, y = e.clientY - rect.top;
          const hit = drawn.current.cells.find(c => x >= c.x0 && x < c.x1 && y >= c.y0 && y < c.y1);
          if (hit && hit.index !== focus) onFocus(hit.index);
        }
      }}
      onPointerMove={e => {
        if (dragging.current !== e.pointerId) return;
        const rect = e.currentTarget.getBoundingClientRect();
        setLab({ swipe: Math.min(0.98, Math.max(0.02, (e.clientX - rect.left) / rect.width)) });
      }}
      onPointerUp={() => { dragging.current = null; }}>
      <canvas ref={canvasRef} className="lab-stage-canvas" />
      {compare === "side" && pair ? (
        <><span className="lab-tag lab-pane-tag">{versions[pair[0]].label}</span><span className="lab-tag lab-pane-tag is-right-half">{versions[pair[1]].label}</span></>
      ) : compare === "swipe" && pair ? (
        <><span className="lab-tag lab-pane-tag">{versions[pair[0]].label}</span><span className="lab-tag lab-pane-tag is-right">{versions[pair[1]].label}</span>
          <button ref={handleRef} type="button" className="lab-swipe-handle" aria-label="Drag to compare" /></>
      ) : compare === "single" ? <span className="lab-tag lab-pane-tag">{focused?.label}</span> : null}
      <div className="lab-corner is-tr"><CompareToggle compare={compare} enabled={Boolean(pair)} /></div>
      {compare !== "lineup" && <div className="lab-corner is-bl"><SidebarStrip unit={unit} units={units} cameo={focused?.image ?? null} /></div>}
      <div className="lab-corner is-br">
        <div className="lab-seg" role="group" aria-label="Zoom">
          <button type="button" onClick={() => setLab({ zoom: clampZoom(drawn.current.zoom - 1, drawn.current.max) })} aria-label="Zoom out"><Minus size={14} /></button>
          <span ref={zoomRef} className="lab-readout" />
          <button type="button" onClick={() => setLab({ zoom: clampZoom(drawn.current.zoom + 1, drawn.current.max) })} aria-label="Zoom in"><Plus size={14} /></button>
        </div>
      </div>
    </div>
  );
}

/** The concept slot: a large image, wheel to zoom about the pointer, drag to pan, double-click to fit. */
export function ConceptStage({ version }: { version: Version }) {
  const colored = usePlayerColorImage(version);
  const [ref, size] = useSize<HTMLDivElement>();
  const imgRef = useRef<HTMLImageElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const view = useRef({ scale: 1, x: 0, y: 0, fit: 1, natural: { w: 0, h: 0 }, fitted: false });
  const apply = () => {
    const v = view.current;
    if (imgRef.current) imgRef.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
    if (readoutRef.current) readoutRef.current.textContent = Math.abs(v.scale - v.fit) < 1e-3 ? "Fit" : `${Math.round(v.scale * 100)}%`;
  };
  const fit = () => {
    const v = view.current;
    if (!v.natural.w || !size.width) return;
    v.fit = Math.min(size.width / v.natural.w, size.height / v.natural.h) * 0.94;
    v.scale = v.fit;
    v.x = (size.width - v.natural.w * v.scale) / 2;
    v.y = (size.height - v.natural.h * v.scale) / 2;
    apply();
  };
  const zoomAt = (factor: number, px: number, py: number) => {
    const v = view.current;
    const next = Math.min(Math.max(v.fit, 0.05) * 8, Math.max(v.fit * 0.5, v.scale * factor));
    v.x = px - ((px - v.x) * next) / v.scale;
    v.y = py - ((py - v.y) * next) / v.scale;
    v.scale = next;
    apply();
  };
  const fitRef = useRef(fit);
  const zoomAtRef = useRef(zoomAt);
  useLayoutEffect(() => { fitRef.current = fit; zoomAtRef.current = zoomAt; });
  useEffect(() => { fitRef.current(); }, [size.width, size.height, version.image]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".lab-corner")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAtRef.current(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);
  const pan = useRef<{ x: number; y: number; vx: number; vy: number; id: number } | null>(null);
  return (
    <div ref={ref} className="lab-stage is-concept" role="application" aria-label={`${version.label}: scroll to zoom, drag to pan, double-click to fit`}
      onPointerDown={e => {
        if ((e.target as HTMLElement).closest(".lab-corner")) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pan.current = { x: e.clientX, y: e.clientY, vx: view.current.x, vy: view.current.y, id: e.pointerId };
      }}
      onPointerMove={e => {
        const p = pan.current;
        if (!p || p.id !== e.pointerId) return;
        view.current.x = p.vx + e.clientX - p.x;
        view.current.y = p.vy + e.clientY - p.y;
        apply();
      }}
      onPointerUp={() => { pan.current = null; }}
      onDoubleClick={e => {
        const v = view.current;
        const rect = e.currentTarget.getBoundingClientRect();
        if (Math.abs(v.scale - v.fit) < 1e-3) zoomAt(1 / v.scale, e.clientX - rect.left, e.clientY - rect.top); else fit();
      }}>
      {version.image && (
        <img ref={imgRef} src={colored.image ?? version.image} alt={`${version.label} concept`} className="lab-concept-img" draggable={false}
          onLoad={e => { view.current.natural = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }; fit(); }} />
      )}
      <span className="lab-tag lab-pane-tag">{version.label}</span>
      <span className="lab-tag lab-pane-tag is-right">{colored.error ?? (colored.supported ? "Player color preview" : "Static draft · remap pending")}</span>
      <div className="lab-corner is-br">
        <div className="lab-seg" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.25, size.width / 2, size.height / 2)}><Minus size={14} /></button>
          <span ref={readoutRef} className="lab-readout">Fit</span>
          <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.25, size.width / 2, size.height / 2)}><Plus size={14} /></button>
          <button type="button" aria-label="Fit" title="Fit (double-click)" onClick={fit}><Maximize size={14} /></button>
        </div>
      </div>
    </div>
  );
}
