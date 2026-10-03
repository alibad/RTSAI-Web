"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadHva, loadPlayerPalette, loadShp, loadVxl, normalsTable, renderInGame } from "../../../lib/art-lab/client";
import type { Palette } from "../../../lib/art-lab/pal";
import type { Shp } from "../../../lib/art-lab/shp";
import { partVisibleByDefault, type RenderSpec } from "../../../lib/art-lab/spec";
import { overlaySequence, pickAnimation, turretSequence } from "../../../lib/art-lab/sprite-anim";
import { blit, drawShpFrame, framePosition, indexFacing, sequenceFrame, sequenceLength } from "../../../lib/art-lab/sprite-render";
import type { SpriteArt, SpriteSequence } from "../../../lib/art-lab/types";
import { facingLabel, localToWorld, rotateYaw, screenVector } from "../../../lib/art-lab/voxel-math";
import { backdropRgb, PixelCanvas, type PixelImage } from "./PixelCanvas";
import { useNearViewport } from "./useInGameRenders";
import { tintFor, type CameraLink, type MapTint, type ViewSettings } from "./viewSettings";
import type { StageLabel, VoxelStage } from "./voxel-three";

export type StageProps = {
  spec: RenderSpec;
  sprite: SpriteArt | null;
  settings: ViewSettings;
  tints: MapTint[];
  /** Part visibility by part id (voxels); defaults follow the rules' conditions. */
  visible?: Record<string, boolean>;
  link?: CameraLink | null;
  /** Height of the 3D canvas; in-game views size themselves to the unit. */
  height?: number;
  /** Compare the WebGL frame with the CPU reference renderer and report it. */
  check?: boolean;
  /** Load immediately instead of when scrolled near. */
  eager?: boolean;
};

export const defaultVisibility = (spec: RenderSpec) => Object.fromEntries((spec.voxel?.parts ?? []).map(p => [p.id, partVisibleByDefault(p)]));

/** One item (current asset or candidate) drawn with the shared view settings. */
export function ArtStage(props: StageProps) {
  if (props.spec.voxel) return <VoxelStageView {...props} />;
  if (props.sprite) return <SpriteStageView {...props} />;
  return <p className="art-hint">No published art for this item.</p>;
}

function VoxelStageView({ spec, settings, tints, visible: visibleProp, link, height, check, eager }: StageProps) {
  const v = spec.voxel!;
  const visible = useMemo(() => visibleProp ?? defaultVisibility(spec), [visibleProp, spec]);
  const [wrapRef, near] = useNearViewport<HTMLDivElement>("300px");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<VoxelStage | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Loading the model…");
  const [labels, setLabels] = useState<StageLabel[]>([]);
  const [frame, setFrame] = useState(0);
  const [checkText, setCheckText] = useState<{ key: string; text: string } | null>(null);
  const tint = tintFor(settings.tintMap, tints);
  const maxFrames = Math.max(...v.parts.map(p => p.frames));
  const active = eager || near;

  useEffect(() => {
    if (!active || stageRef.current) return;
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
          mode: settings.mode, facing: settings.facing, turretFacing: settings.turretFacing, frame, zoom: settings.zoom, visible,
          shadow: settings.shadow, airborne: settings.airborne, background: backdropRgb(settings.backdrop), tint, palette,
        }, { height, link });
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
  }, [active]);
  useEffect(() => () => { stageRef.current?.dispose(); stageRef.current = null; }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !ready) return;
    let cancelled = false;
    loadPlayerPalette(spec.palette!, settings.color).then(palette => {
      if (cancelled) return;
      stage.setState({
        mode: settings.mode, facing: settings.facing, turretFacing: settings.turretFacing, frame, zoom: settings.zoom, visible,
        shadow: settings.shadow, airborne: settings.airborne, background: backdropRgb(settings.backdrop), tint, palette,
      });
    });
    return () => { cancelled = true; };
  }, [ready, settings.mode, settings.facing, settings.turretFacing, settings.color, settings.zoom, settings.backdrop, settings.shadow, settings.airborne, tint, frame, visible, spec.palette]);

  useEffect(() => {
    if (!settings.playing || maxFrames < 2) return;
    const tick = Math.max(1, v.parts.find(p => p.frames > 1)?.tickRate ?? 1) * 40;
    const timer = setInterval(() => setFrame(f => (f + 1) % maxFrames), tick);
    return () => clearInterval(timer);
  }, [settings.playing, maxFrames, v.parts]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => stageRef.current?.resize());
    observer.observe(el);
    return () => observer.disconnect();
  }, [wrapRef]);

  // Cross-check the WebGL in-game frame against the CPU reference renderer (the one compared with captures).
  const checkKey = JSON.stringify([settings.mode, settings.facing, settings.color, tint, settings.turretFacing, frame, visible, settings.shadow, settings.airborne, spec.id]);
  useEffect(() => {
    if (!check || !ready || settings.mode !== "ingame" || settings.spin) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const stage = stageRef.current;
      const gl = stage?.readInGame();
      if (!stage || !gl) return;
      const ref = await renderInGame(spec, { facing: settings.facing, turretFacing: settings.turretFacing, color: settings.color, frame, enabledParts: visible, airborne: settings.airborne, shadow: settings.shadow, frameBox: stage.inGameBox });
      if (cancelled) return;
      let model = 0, same = 0;
      for (let i = 0; i < ref.data.length; i += 4) {
        if (ref.data[i + 3] !== 255) continue;
        model++;
        if (Math.max(...[0, 1, 2].map(c => Math.abs(gl[i + c] - Math.min(255, Math.max(0, ref.data[i + c] * tint[c]))))) <= 2) same++;
      }
      if (model) setCheckText({ key: checkKey, text: `WebGL frame vs CPU reference: ${same.toLocaleString()} of ${model.toLocaleString()} model pixels match (${((100 * same) / model).toFixed(1)}%).` });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [check, ready, checkKey, settings, tint, frame, visible, spec]);

  return (
    <div className="art-stage-wrap" ref={wrapRef}>
      <div className={`art-stage is-${settings.mode}`} style={settings.mode === "ingame" ? undefined : { minHeight: height }}>
        <canvas ref={canvasRef} className="art-stage-canvas" aria-label={`${spec.name}, ${settings.mode === "ingame" ? "in-game view" : settings.mode === "orbit" ? "3D orbit view (drag to rotate)" : "exploded view"}, facing ${settings.facing} (${facingLabel(settings.facing)})`} />
        {settings.mode === "exploded" && labels.map(l => <span key={l.id} className={`art-stage-label is-${l.kind}`} style={{ left: l.x, top: l.y }}>{l.text}</span>)}
        {status && <p className="art-stage-status">{status}</p>}
      </div>
      {maxFrames > 1 && <p className="art-hint">HVA frame {frame + 1}/{maxFrames}{settings.playing ? " (playing)" : ""}</p>}
      {check && checkText && checkText.key === checkKey && settings.mode === "ingame" && <p className="art-check-line">{checkText.text}</p>}
    </div>
  );
}

function useShp(file: string | null | undefined, active: boolean) {
  const [shp, setShp] = useState<{ file: string; shp: Shp } | null>(null);
  useEffect(() => {
    if (!file || !active) return;
    let cancelled = false;
    loadShp(file).then(s => { if (!cancelled) setShp({ file, shp: s }); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [file, active]);
  return shp && shp.file === file ? shp.shp : null;
}

function usePalette(spec: RenderSpec, color: string | null) {
  const [palette, setPalette] = useState<Palette | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (spec.palette) loadPlayerPalette(spec.palette, color).then(p => { if (!cancelled) setPalette(p); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [spec.palette, color]);
  return palette;
}

type Layer = { shp: Shp; seq: SpriteSequence; facing: number; frame: number; dx?: number; dy?: number };

/**
 * Draws sprite layers around a fixed actor centre so frames never jitter: every layer's ShadowStart frame
 * first (the shadow palette index draws black at alpha 140), then body, turret and overlays in order.
 */
function compose(layers: Layer[], palette: Palette, base: Shp, baseSeq: SpriteSequence, shadows: boolean): PixelImage {
  const margin = 8 + Math.max(0, ...layers.map(l => Math.max(Math.abs(l.dx ?? 0), Math.abs(l.dy ?? 0))));
  const width = base.width + 2 * margin, height = base.height + 2 * margin;
  const anchorX = Math.round(base.width / 2 + margin - baseSeq.offset[0]);
  const anchorY = Math.round(base.height / 2 + margin - baseSeq.offset[1]);
  const data = new Uint8ClampedArray(4 * width * height);
  const draw = (layer: Layer, index: number) => {
    if (index < 0 || index >= layer.shp.frames.length) return;
    const at = framePosition(layer.shp, layer.seq, anchorX + (layer.dx ?? 0), anchorY + (layer.dy ?? 0));
    blit(data, width, height, drawShpFrame(layer.shp, index, palette), layer.shp.width, layer.shp.height, at.x, at.y);
  };
  if (shadows) for (const layer of layers) if (layer.seq.shadowStart >= 0) draw(layer, sequenceFrame(layer.seq, layer.frame, layer.facing, true));
  for (const layer of layers) draw(layer, sequenceFrame(layer.seq, layer.frame, layer.facing));
  return { width, height, data, anchorX, anchorY };
}

/** Turreted.Position for a sprite actor: the offset rotated by the quantized body facing, in screen pixels. */
function turretScreenOffset(offset: [number, number, number] | undefined, bodyFacing: number) {
  if (!offset || (offset[0] === 0 && offset[1] === 0 && offset[2] === 0)) return { dx: 0, dy: 0 };
  const v = screenVector(localToWorld(rotateYaw(offset, bodyFacing), false, 85));
  return { dx: Math.round(v[0]), dy: Math.round(v[1]) };
}

function SpriteStageView({ spec, sprite, settings, tints, eager }: StageProps) {
  const [wrapRef, near] = useNearViewport<HTMLDivElement>("300px");
  const active = eager || near;
  const animation = pickAnimation(sprite, settings.animation);
  const body = animation?.body ?? null;
  const turret = animation?.id === "make" ? null : turretSequence(sprite);
  const overlay = animation?.id === "make" ? null : overlaySequence(sprite);
  const bodyShp = useShp(body?.file, active);
  const turretShp = useShp(turret?.file, active);
  const overlayShp = useShp(overlay?.file, active);
  const palette = usePalette(spec, settings.color);
  const tint = tintFor(settings.tintMap, tints);
  const [tick, setTick] = useState(0);
  const length = body && bodyShp ? sequenceLength(body, bodyShp) : 1;
  useEffect(() => {
    if (!settings.playing || !body) return;
    const timer = setInterval(() => setTick(t => t + 1), Math.max(40, body.tick));
    return () => clearInterval(timer);
  }, [settings.playing, body]);
  const frame = body?.reverses && length > 1 ? (() => { const p = tick % (2 * length - 2); return p >= length ? 2 * length - 2 - p : p; })() : tick % Math.max(1, length);
  const facings = body?.facings ?? 1;
  // A vehicle's turret turns with its body (Turreted: world = body + local); a defence's body never turns.
  const vehicle = facings > 1 && Boolean(turret);
  const quantize = (f: number) => (indexFacing(f, facings) * 1024) / facings;
  const turretAngleFor = (bodyFacing: number) => (vehicle ? (quantize(bodyFacing) + settings.turretFacing) & 1023 : ((sprite?.turret?.initialFacing ?? 0) + settings.turretFacing) & 1023);
  const turretAngle = turretAngleFor(settings.facing);
  const turretOffset = sprite?.turret?.offset;
  const layersAt = (bodyFacing: number, bodyFrame: number): Layer[] => {
    const layers: Layer[] = [{ shp: bodyShp!, seq: body!, facing: bodyFacing, frame: bodyFrame }];
    if (turret && turretShp) layers.push({ shp: turretShp, seq: turret, facing: turretAngleFor(bodyFacing), frame: 0, ...turretScreenOffset(turretOffset, vehicle ? quantize(bodyFacing) : 0) });
    if (overlay && overlayShp) layers.push({ shp: overlayShp, seq: overlay, facing: 0, frame: tick });
    return layers;
  };
  const image = !body || !bodyShp || !palette ? null : compose(layersAt(settings.facing, frame), palette, bodyShp, body, settings.shadow);
  const stripCount = Math.max(facings, turret ? turret.facings : 1);
  const strip = settings.mode === "ingame" || !body || !bodyShp || !palette ? [] : Array.from({ length: stripCount }, (_, i) => {
    const facing = (i * 1024) / stripCount;
    return { facing, image: compose(layersAt(facings > 1 ? facing : settings.facing, frame).map(l => (l.seq === turret && facings === 1 ? { ...l, facing } : l)), palette, bodyShp, body, settings.shadow) };
  });
  const facingIndex = body ? indexFacing(settings.facing, facings) : 0;
  return (
    <div className="art-stage-wrap" ref={wrapRef}>
      <div className="art-stage is-sprite">
        {image ? <PixelCanvas image={image} zoom={settings.zoom} backdrop={settings.backdrop} tint={tint} diamond label={`${spec.name}, ${animation?.label ?? "sprite"}, facing ${settings.facing}`} /> : <p className="art-stage-status">{active ? "Loading the sprite…" : ""}</p>}
      </div>
      <p className="art-hint">
        <b className="art-sprite-tag">Pre-rendered sprite: no 3D{settings.mode !== "ingame" ? ", shown at every facing" : ""}. </b>
        {animation ? `${animation.label}: sequence “${body?.name}”, frame ${frame + 1}/${length}` : ""}{facings > 1 ? `, facing ${facingIndex + 1}/${facings}` : ""}
        {turret ? `, turret ${turretAngle} (${facingLabel(turretAngle)})` : ""}{turretOffset && turretOffset.some(v => v !== 0) ? `, Turreted.Offset ${turretOffset.join(",")}` : ""}.{animation?.note ? ` ${animation.note}` : ""}
      </p>
      {strip.length > 0 && (
        <div className="art-facing-strip" aria-label="Every facing">
          {strip.map((s, i) => <PixelCanvas key={s.facing} image={s.image} zoom={1} backdrop={settings.backdrop} tint={tint} label={`facing ${s.facing}`} className={i === indexFacing(settings.facing, strip.length) ? "is-current" : undefined} />)}
        </div>
      )}
    </div>
  );
}
