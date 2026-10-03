"use client";

import { Box, Eye, Layers, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadHva, loadPlayerPalette, loadVxl, normalsTable, renderInGame } from "../../../lib/art-lab/client";
import { partVisibleByDefault, type RenderSpec } from "../../../lib/art-lab/spec";
import { facingLabel } from "../../../lib/art-lab/voxel-math";
import { ArtToolbar, tintFor, useArtSettings, type MapTint } from "./ArtToolbar";
import { backdropRgb } from "./PixelCanvas";
import { useNearViewport } from "./useInGameRenders";
import type { StageLabel, StageMode, VoxelStage } from "./voxel-three";
import { FeedbackButton } from "./FeedbackButton";

const modes: { id: StageMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "ingame", label: "In-game", icon: <Eye size={15} />, hint: "Orthographic camera at the battlefield angle (CameraPitch), 1 game pixel per pixel, nearest-neighbour scaling." },
  { id: "orbit", label: "Free orbit", icon: <Box size={15} />, hint: "Drag to orbit, scroll to zoom. Same transforms as the game; the grid is the ground plane, the arrow the body's front." },
  { id: "exploded", label: "Exploded", icon: <Layers size={15} />, hint: "Parts pulled apart vertically, labelled, with pivot points and turret axes. Toggle parts below." },
];

export function VoxelViewer({ spec, tints, feedback, compact = false }: {
  spec: RenderSpec;
  tints: MapTint[];
  feedback: { factionId: string; actorId: string } | null;
  compact?: boolean;
}) {
  const v = spec.voxel!;
  const [settings, update] = useArtSettings();
  const [mode, setMode] = useState<StageMode>("ingame");
  const [turretFacing, setTurretFacing] = useState(0);
  const [frame, setFrame] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [airborne, setAirborne] = useState(false);
  const [shadow, setShadow] = useState(true);
  const [visible, setVisible] = useState<Record<string, boolean>>(() => Object.fromEntries(v.parts.map(p => [p.id, partVisibleByDefault(p)])));
  const [focusPart, setFocusPart] = useState<string | null>(null);
  const [labels, setLabels] = useState<StageLabel[]>([]);
  const [status, setStatus] = useState<string>("Loading the model…");
  const [check, setCheck] = useState<{ key: string; text: string } | null>(null);
  const [wrapRef, near] = useNearViewport<HTMLDivElement>("200px");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<VoxelStage | null>(null);
  const [ready, setReady] = useState(false);
  const hasTurret = v.parts.some(p => p.turretOffset);
  const maxFrames = Math.max(...v.parts.map(p => p.frames));
  const tint = tintFor(settings, tints);

  // Load files and three.js only once the viewer is near the viewport.
  useEffect(() => {
    if (!near || stageRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ VoxelStage }, parts, palette] = await Promise.all([
          import("./voxel-three"),
          Promise.all(v.parts.map(async p => ({ id: p.id, label: p.label, vxl: await loadVxl(p.vxl), hva: await loadHva(p.hva), offset: p.offset, turretOffset: p.turretOffset, showShadow: p.showShadow }))),
          loadPlayerPalette(spec.palette!, settings.color),
        ]);
        if (cancelled || !canvasRef.current) return;
        stageRef.current = new VoxelStage(canvasRef.current, { ...v, normals: normalsTable(v.normals) }, parts, {
          mode, facing: settings.facing, turretFacing, frame, zoom: settings.zoom, visible, shadow, airborne,
          background: backdropRgb(settings.backdrop), tint, palette,
        });
        stageRef.current.setLabelListener(setLabels);
        setReady(true);
        setStatus("");
      } catch (error) {
        setStatus(`Could not load the model: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    return () => { cancelled = true; };
    // Initial values only; later changes flow through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near]);
  useEffect(() => () => { stageRef.current?.dispose(); stageRef.current = null; }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !ready) return;
    let cancelled = false;
    loadPlayerPalette(spec.palette!, settings.color).then(palette => {
      if (cancelled) return;
      stage.setState({ mode, facing: settings.facing, turretFacing, frame, zoom: settings.zoom, visible, shadow, airborne, background: backdropRgb(settings.backdrop), tint, palette });
    });
    return () => { cancelled = true; };
  }, [ready, mode, settings.facing, settings.color, settings.zoom, settings.backdrop, tint, turretFacing, frame, visible, shadow, airborne, spec.palette]);

  useEffect(() => {
    if (!animate || maxFrames < 2) return;
    const tick = Math.max(1, v.parts.find(p => p.frames > 1)?.tickRate ?? 1) * 40;
    const timer = setInterval(() => setFrame(f => (f + 1) % maxFrames), tick);
    return () => clearInterval(timer);
  }, [animate, maxFrames, v.parts]);

  useEffect(() => {
    const onResize = () => stageRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Cross-check the WebGL in-game frame against the CPU reference renderer (the one compared with captures).
  const checkKey = JSON.stringify([mode, settings.facing, settings.color, tint, turretFacing, frame, visible, shadow, airborne, spec.id]);
  useEffect(() => {
    if (!ready || mode !== "ingame" || compact) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const stage = stageRef.current;
      if (!stage) return;
      const gl = stage.readInGame();
      if (!gl) return;
      const box = stage.inGameBox;
      const ref = await renderInGame(spec, { facing: settings.facing, turretFacing, color: settings.color, frame, enabledParts: visible, airborne, shadow, frameBox: box });
      if (cancelled) return;
      let model = 0, same = 0;
      for (let i = 0; i < ref.data.length; i += 4) {
        if (ref.data[i + 3] !== 255) continue;
        model++;
        const d = Math.max(...[0, 1, 2].map(c => Math.abs(gl[i + c] - Math.min(255, Math.max(0, ref.data[i + c] * tint[c])))));
        if (d <= 2) same++;
      }
      if (model) setCheck({ key: checkKey, text: `WebGL frame vs CPU reference: ${same.toLocaleString()} of ${model.toLocaleString()} model pixels match (${((100 * same) / model).toFixed(1)}%).` });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ready, compact, checkKey, mode, settings.facing, settings.color, settings.zoom, settings.backdrop, tint, turretFacing, frame, visible, shadow, airborne, spec]);

  const onKey = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "ArrowLeft") { update({ facing: (settings.facing + 32) & 1023 }); event.preventDefault(); }
    if (event.key === "ArrowRight") { update({ facing: (settings.facing - 32 + 1024) & 1023 }); event.preventDefault(); }
  }, [settings.facing, update]);

  const feedbackTitle = useMemo(() => {
    const view = modes.find(m => m.id === mode)!.label.toLowerCase() + " view";
    const parts = focusPart ? v.parts.find(p => p.id === focusPart)?.label : v.parts.filter(p => visible[p.id] !== false).map(p => p.label).join("+");
    return `[art] ${feedback?.factionId}/${feedback?.actorId} — ${view}, facing ${settings.facing} (${facingLabel(settings.facing)})${hasTurret ? `, turret ${turretFacing}` : ""}, part: ${parts}`;
  }, [feedback, mode, settings.facing, hasTurret, turretFacing, focusPart, visible, v.parts]);

  return (
    <div className={`art-viewer ${compact ? "is-compact" : ""}`} ref={wrapRef}>
      <div className="art-viewer-head">
        <div className="art-tabs" role="tablist" aria-label="Viewer mode">
          {modes.map(m => <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)}>{m.icon} {m.label}</button>)}
        </div>
        {feedback && <FeedbackButton title={feedbackTitle} />}
      </div>
      <ArtToolbar settings={settings} update={update} tints={tints} extra={<>
        {hasTurret && (
          <label className="art-control">
            <span>Turret</span>
            <input type="range" min={-512} max={480} step={32} value={turretFacing} onChange={e => setTurretFacing(Number(e.target.value))} aria-label="Turret facing relative to the body" />
            <output>{turretFacing}</output>
          </label>
        )}
        {mode === "ingame" && <label className="art-check"><input type="checkbox" checked={shadow} onChange={e => setShadow(e.target.checked)} /> Shadow</label>}
        {v.altitude !== null && <label className="art-check"><input type="checkbox" checked={airborne} onChange={e => setAirborne(e.target.checked)} /> At cruise altitude</label>}
        {maxFrames > 1 && <button type="button" className="art-check" onClick={() => setAnimate(a => !a)} aria-pressed={animate}>{animate ? <Pause size={13} /> : <Play size={13} />} HVA frames ({frame + 1}/{maxFrames})</button>}
      </>} />
      <div className="art-parts" role="group" aria-label="Parts">
        <span>Parts</span>
        {v.parts.map(p => (
          <label key={p.id} className={`art-check ${focusPart === p.id ? "is-focus" : ""}`}>
            <input type="checkbox" checked={visible[p.id] !== false} onChange={e => setVisible(s => ({ ...s, [p.id]: e.target.checked }))} />
            {p.label}{p.requiresCondition ? <small> ({p.requiresCondition})</small> : null}
            <button type="button" className="art-focus" onClick={() => setFocusPart(f => (f === p.id ? null : p.id))} aria-pressed={focusPart === p.id} title="Use this part in the feedback title">◎</button>
          </label>
        ))}
      </div>
      <p className="art-hint">{modes.find(m => m.id === mode)!.hint}{mode !== "ingame" && hasTurret ? " Off-centre turret offsets are applied in screen space, as OpenRA does, so they line up only at the battlefield angle." : ""}</p>
      <div className={`art-stage is-${mode}`} role="slider" tabIndex={0} onKeyDown={onKey} aria-label={`${spec.name} facing. Left and right arrows turn the unit.`}
        aria-valuemin={0} aria-valuemax={1023} aria-valuenow={settings.facing} aria-valuetext={`${settings.facing} (${facingLabel(settings.facing)})`}>
        <canvas ref={canvasRef} className="art-stage-canvas" />
        {mode === "exploded" && labels.map(l => <span key={l.id} className={`art-stage-label is-${l.kind}`} style={{ left: l.x, top: l.y }}>{l.text}</span>)}
        {status && <p className="art-stage-status">{status}</p>}
      </div>
      {check && check.key === checkKey && mode === "ingame" && !compact && <p className="art-check-line">{check.text}</p>}
    </div>
  );
}
