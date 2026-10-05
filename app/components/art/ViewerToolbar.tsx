"use client";

import { Box, ChevronLeft, ChevronRight, Eye, Layers, Link2, Link2Off, Pause, Play, RotateCw } from "lucide-react";
import { houseColors } from "../../../lib/art-lab/remap";
import { facingLabel } from "../../../lib/art-lab/voxel-math";
import { backdrops, type Backdrop } from "./PixelCanvas";
import type { MapTint, ViewMode, ViewSettings } from "./viewSettings";

export type ToolbarFeatures = {
  modes?: boolean;
  turret?: boolean;
  shadow?: boolean;
  airborne?: boolean;
  link?: boolean;
  animations?: { id: string; label: string }[];
  frames?: boolean;
  /** Offer the auto-spin turntable (off for long rosters, which redraw every unit per step). */
  spin?: boolean;
};

const modeButtons: { id: ViewMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: "ingame", label: "In-game", icon: <Eye size={15} />, hint: "The battlefield camera, 1 game pixel per pixel, scaled without smoothing" },
  { id: "orbit", label: "3D orbit", icon: <Box size={15} />, hint: "Drag to rotate, scroll to zoom" },
  { id: "exploded", label: "Exploded", icon: <Layers size={15} />, hint: "Parts pulled apart, labelled, pivots marked" },
];

/** The one toolbar that drives every viewer on the page (all columns of a comparison together). */
export function ViewerToolbar({ settings, update, tints, features = {}, extra, className }: {
  settings: ViewSettings;
  update: (patch: Partial<ViewSettings>) => void;
  tints: MapTint[];
  features?: ToolbarFeatures;
  extra?: React.ReactNode;
  className?: string;
}) {
  const steps = 32;
  const index = Math.round(settings.facing / (1024 / steps)) % steps;
  return (
    <div className={`art-toolbar ${className ?? ""}`} role="toolbar" aria-label="View settings for every viewer on this page">
      {features.modes !== false && (
        <div className="art-control art-modes" role="group" aria-label="View">
          {modeButtons.map(m => <button key={m.id} type="button" aria-pressed={settings.mode === m.id} title={m.hint} onClick={() => update({ mode: m.id })}>{m.icon} {m.label}</button>)}
        </div>
      )}
      <div className="art-control art-facing">
        <span>Facing</span>
        <button type="button" aria-label="Turn counter-clockwise" onClick={() => update({ facing: (settings.facing + 32) & 1023, spin: false })}><ChevronLeft size={15} /></button>
        <input type="range" min={0} max={steps - 1} value={index} aria-label="Facing" aria-valuetext={`${settings.facing} (${facingLabel(settings.facing)})`}
          onChange={e => update({ facing: (Number(e.target.value) * (1024 / steps)) & 1023, spin: false })} />
        <button type="button" aria-label="Turn clockwise" onClick={() => update({ facing: (settings.facing - 32 + 1024) & 1023, spin: false })}><ChevronRight size={15} /></button>
        <output aria-live="off">{settings.facing} {facingLabel(settings.facing)}</output>
        {features.spin !== false && <button type="button" aria-pressed={settings.spin} onClick={() => update({ spin: !settings.spin })} title="Turntable (Space)"><RotateCw size={14} /> Auto-spin</button>}
      </div>
      {features.turret && (
        <label className="art-control">
          <span>Turret</span>
          <input type="range" min={-512} max={480} step={32} value={settings.turretFacing} onChange={e => update({ turretFacing: Number(e.target.value) })} aria-label="Turret angle relative to the body" />
          <output>{settings.turretFacing > 0 ? "+" : ""}{settings.turretFacing}</output>
        </label>
      )}
      {!!features.animations?.length && (
        <div className="art-control" role="group" aria-label="Animation">
          <span>Animation</span>
          <select value={settings.animation} onChange={e => update({ animation: e.target.value })} aria-label="Sprite animation">
            {features.animations.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
      )}
      {(features.frames || !!features.animations?.length) && (
        <button type="button" className="art-check" aria-pressed={settings.playing} onClick={() => update({ playing: !settings.playing })}>{settings.playing ? <Pause size={13} /> : <Play size={13} />} {settings.playing ? "Pause" : "Play"}</button>
      )}
      <div className="art-control" role="group" aria-label="House colour">
        <span>House</span>
        {houseColors.map(c => (
          <button key={c.id} type="button" className="art-swatch" style={{ background: `#${c.hex}` }} aria-pressed={settings.color === c.hex} aria-label={c.name} title={`${c.name} #${c.hex}`} onClick={() => update({ color: c.hex })} />
        ))}
        <button type="button" className="art-swatch is-raw" aria-pressed={settings.color === null} aria-label="No remap (palette as shipped)" title="No remap: indices 16–31 as shipped" onClick={() => update({ color: null })}>∅</button>
      </div>
      <div className="art-control" role="group" aria-label="Pixel scale">
        <span>Scale</span>
        {([1, 2, 4] as const).map(z => <button key={z} type="button" aria-pressed={settings.zoom === z} onClick={() => update({ zoom: z })}>{z}×</button>)}
      </div>
      <label className="art-control">
        <span>Ground</span>
        <select value={settings.backdrop} onChange={e => update({ backdrop: e.target.value as Backdrop })}>
          {backdrops.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      </label>
      <label className="art-control">
        <span>Map light</span>
        <select value={settings.tintMap} onChange={e => update({ tintMap: e.target.value })}>
          <option value="">Neutral</option>
          {tints.map(t => <option key={t.map} value={t.map}>{t.title}</option>)}
        </select>
      </label>
      {features.shadow && <label className="art-check"><input type="checkbox" checked={settings.shadow} onChange={e => update({ shadow: e.target.checked })} /> Shadow</label>}
      {features.airborne && <label className="art-check"><input type="checkbox" checked={settings.airborne} onChange={e => update({ airborne: e.target.checked })} /> At cruise altitude</label>}
      {features.link && settings.mode !== "ingame" && (
        <button type="button" className="art-check" aria-pressed={settings.linkCameras} onClick={() => update({ linkCameras: !settings.linkCameras })} title="Rotate all 3D views together">
          {settings.linkCameras ? <Link2 size={14} /> : <Link2Off size={14} />} {settings.linkCameras ? "Cameras linked" : "Cameras unlinked"}
        </button>
      )}
      {extra}
    </div>
  );
}
