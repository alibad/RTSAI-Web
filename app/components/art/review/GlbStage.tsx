"use client";
/* The "3D model" step of the asset chain: the generated GLB on the main stage, through the Studio's one shared
   WebGL engine (no second context). It replaces the former separate "3D model drafts" dialog. */
import { useEffect, useRef, useState } from "react";
import { Box, Download, RotateCcw } from "lucide-react";
import type { ModelOption } from "../../../../lib/art-lab/models";
import { houseColors } from "../../../../lib/art-lab/remap";
import type { FrameStore } from "./frames";
import type { MeshView } from "../mesh-view";
import type { VoxelEngine } from "../voxel-engine";
import { setLab, useLab } from "./lab-store";

/** Small pictures of each GLB, taken after its first draw, for the chain's 3D model thumbnail. */
const snapshots = new Map<string, string>();
const snapshotListeners = new Set<() => void>();
export const glbSnapshot = (url: string | null | undefined) => (url ? snapshots.get(url) ?? null : null);
export function useGlbSnapshots() {
  const [, bump] = useState(0);
  useEffect(() => { const l = () => bump(n => n + 1); snapshotListeners.add(l); return () => { snapshotListeners.delete(l); }; }, []);
}
const pending = new Set<string>();
// Reading pixels back from the WebGL canvas is synchronous wherever it happens; a worker keeps it off the main thread.
const ENCODER = `self.onmessage=async e=>{const{bitmap,w,h}=e.data;const c=new OffscreenCanvas(w,h);c.getContext("2d").drawImage(bitmap,0,0,w,h);bitmap.close();self.postMessage(await c.convertToBlob({type:"image/png"}));};`;
let encoder: Worker | null = null;
/** A small cover-cropped picture of the stage for the chain thumbnail, encoded in a worker. */
function takeSnapshot(url: string, canvas: HTMLCanvasElement) {
  if (snapshots.has(url) || pending.has(url) || !canvas.width || !canvas.height || typeof createImageBitmap !== "function" || typeof Worker !== "function") return;
  pending.add(url);
  const w = 224, h = 128;
  const scale = Math.max(w / canvas.width, h / canvas.height) * 1.5;
  const sw = Math.round(w / scale), sh = Math.round(h / scale);
  createImageBitmap(canvas, Math.round((canvas.width - sw) / 2), Math.round((canvas.height - sh) / 2), sw, sh)
    .then(bitmap => new Promise<Blob>((resolve, reject) => {
      encoder ??= new Worker(URL.createObjectURL(new Blob([ENCODER], { type: "text/javascript" })));
      const worker = encoder;
      const done = (e: MessageEvent<Blob>) => { worker.removeEventListener("message", done); resolve(e.data); };
      worker.addEventListener("message", done);
      worker.addEventListener("error", reject, { once: true });
      worker.postMessage({ bitmap, w, h }, [bitmap]);
    }))
    .then(blob => {
      pending.delete(url);
      snapshots.set(url, URL.createObjectURL(blob));
      for (const l of snapshotListeners) l();
    })
    .catch(() => { pending.delete(url); });
}

const colorHex = (c: string | null) => `#${c ?? houseColors[0].hex}`;

export function GlbStage({ options, name, frames }: { options: ModelOption[]; name: string; frames: FrameStore }) {
  const [version, setVersion] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [wire, setWire] = useState(false);
  const [turret, setTurret] = useState(0);
  const color = useLab(s => s.color);
  const host = useRef<HTMLDivElement>(null), scene = useRef<MeshView | null>(null), engine = useRef<VoxelEngine | null>(null);
  const option = options.find(o => o.id === version) ?? options[0] ?? null;
  const url = option?.url ?? null;
  const loaded = Boolean(url && loadedUrl === url);

  // In-game frames keep rendering offscreen for the chain thumbnails; the engine's canvas shows the GLB.
  useEffect(() => () => { engine.current?.detach(); }, []);
  useEffect(() => {
    let alive = true, preparing = false;
    let view: MeshView | null = null;
    const start = setTimeout(() => { setLoadedUrl(null); setError(""); }, 0);
    if (url && host.current) void (async () => {
      const meshModule = await import("../mesh-view");
      view = new meshModule.MeshView();
      await view.load(url);
      if (!alive) { view.dispose(); return; }
      const shared = await frames.sharedEngine();
      if (!alive) { view.dispose(); return; }
      preparing = true;
      try { await shared.prepareMesh(view); } finally { preparing = false; }
      if (!alive || !host.current) { view.dispose(); return; }
      scene.current = view; engine.current = shared;
      shared.showMesh(view, host.current);
      setLoadedUrl(url);
    })().catch(e => { view?.dispose(); if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; clearTimeout(start); engine.current?.detach(); if (!preparing) view?.dispose(); scene.current = null; };
  }, [url, frames]);
  useEffect(() => {
    if (!loaded) return;
    scene.current?.color(colorHex(color));
    scene.current?.wireframe(wire);
    scene.current?.turret(turret);
    engine.current?.draw();
    if (url && engine.current && !wire) takeSnapshot(url, engine.current.canvas);
  }, [color, wire, turret, loaded, url]);
  useEffect(() => {
    const resize = new ResizeObserver(() => engine.current?.resize());
    if (host.current) resize.observe(host.current);
    return () => resize.disconnect();
  }, []);

  return (
    <div className="glb-stage">
      <div ref={host} className="glb-viewport" role="application" aria-label={`${name} 3D model: drag to orbit, scroll to zoom`}>
        {!option && <div className="glb-empty"><Box size={36} aria-hidden="true" /><b>No 3D model yet</b><small>The design has not been turned into a GLB for this actor.</small></div>}
        {option && !loaded && !error && <p className="glb-note">Loading the 3D model…</p>}
        {error && <p className="glb-note" role="alert">{error}</p>}
      </div>
      {options.length > 1 && <div className="lab-corner is-tl"><div className="lab-seg" role="radiogroup" aria-label="3D model version">
        {options.map(o => <button key={o.id} type="button" role="radio" aria-checked={o.id === option?.id} onClick={() => { setVersion(o.id); setTurret(0); }}>{o.label}</button>)}
      </div></div>}
      {option && <span className="lab-tag lab-pane-tag glb-tag">3D model · {option.triangles !== null ? `${Math.round(option.triangles / 1000)}k triangles` : "GLB"}{option.bytes ? ` · ${(option.bytes / 1048576).toFixed(1)} MB` : ""}</span>}
      {option && <div className="lab-corner is-br">
        <div className="lab-seg" role="radiogroup" aria-label="Player colour">
          {houseColors.map(c => <button key={c.id} type="button" role="radio" className="glb-swatch" aria-checked={(color ?? houseColors[0].hex) === c.hex} aria-label={c.name} title={c.name} style={{ ["--swatch" as string]: `#${c.hex}` }} onClick={() => setLab({ color: c.hex })} />)}
        </div>
        {option.turret && <label className="lab-seg glb-turret">Turret<input type="range" aria-label="Turret aim" min={-180} max={180} value={turret} onChange={e => setTurret(Number(e.target.value))} /></label>}
        <div className="lab-seg">
          <button type="button" aria-pressed={wire} onClick={() => setWire(w => !w)}>Wireframe</button>
          <button type="button" onClick={() => engine.current?.resetMesh()} title="Reset view"><RotateCcw size={14} /><span>Reset</span></button>
          <a className="glb-download" href={option.url} download={`${name.replace(/\s+/g, "-").toLowerCase()}.glb`} title="Download the GLB"><Download size={14} /></a>
        </div>
      </div>}
      {option && <p className="glb-evidence">{option.status.startsWith("Static") ? "Static source geometry, no rig or animation clips" : option.status}. The view fits the model, not battlefield size; the game draws the native model made from it.</p>}
    </div>
  );
}
