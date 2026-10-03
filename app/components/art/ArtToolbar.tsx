"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { facingLabel } from "../../../lib/art-lab/voxel-math";
import { houseColors } from "../../../lib/art-lab/remap";
import { backdrops, type Backdrop } from "./PixelCanvas";

export type MapTint = { map: string; title: string; tint: [number, number, number] };

export type ArtSettings = {
  color: string | null;
  zoom: 1 | 2 | 4;
  backdrop: Backdrop;
  tintMap: string;
  facing: number;
};

const defaults: ArtSettings = { color: "F21818", zoom: 2, backdrop: "sand", tintMap: "", facing: 896 };
const storageKey = "rtsai-art-lab-view";

/** View settings shared by the Art Lab pages, remembered per browser (a convenience only). */
export function useArtSettings(initial?: Partial<ArtSettings>) {
  const [settings, setSettings] = useState<ArtSettings>({ ...defaults, ...initial });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}") as Partial<ArtSettings>;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore after hydration to avoid a mismatch
      setSettings(s => ({ ...s, ...pick(saved), ...initial }));
    } catch { /* storage unavailable */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const update = (patch: Partial<ArtSettings>) => setSettings(s => {
    const next = { ...s, ...patch };
    try { localStorage.setItem(storageKey, JSON.stringify({ color: next.color, zoom: next.zoom, backdrop: next.backdrop, tintMap: next.tintMap })); } catch { /* ignore */ }
    return next;
  });
  return [settings, update] as const;
}

function pick(saved: Partial<ArtSettings>): Partial<ArtSettings> {
  const out: Partial<ArtSettings> = {};
  if (saved.color === null || (typeof saved.color === "string" && /^[0-9A-F]{6}$/i.test(saved.color))) out.color = saved.color;
  if (saved.zoom === 1 || saved.zoom === 2 || saved.zoom === 4) out.zoom = saved.zoom;
  if (backdrops.some(b => b.id === saved.backdrop)) out.backdrop = saved.backdrop;
  if (typeof saved.tintMap === "string") out.tintMap = saved.tintMap;
  return out;
}

const NEUTRAL: [number, number, number] = [1, 1, 1];
/** The selected map's tint; stable references so effects keyed on it do not re-run every render. */
export function tintFor(settings: ArtSettings, tints: MapTint[]): [number, number, number] {
  return tints.find(t => t.map === settings.tintMap)?.tint ?? NEUTRAL;
}

export function ArtToolbar({ settings, update, tints, facingStep = 32, showFacing = true, extra }: {
  settings: ArtSettings;
  update: (patch: Partial<ArtSettings>) => void;
  tints: MapTint[];
  facingStep?: number;
  showFacing?: boolean;
  extra?: React.ReactNode;
}) {
  const step = 1024 / facingStep;
  const index = Math.round(settings.facing / step) % facingStep;
  return (
    <div className="art-toolbar" role="toolbar" aria-label="View settings">
      {showFacing && (
        <div className="art-control">
          <span>Facing</span>
          <button type="button" aria-label="Turn counter-clockwise" onClick={() => update({ facing: (settings.facing + step) & 1023 })}><ChevronLeft size={15} /></button>
          <output aria-live="polite">{settings.facing} · {facingLabel(settings.facing)} · {index + 1}/{facingStep}</output>
          <button type="button" aria-label="Turn clockwise" onClick={() => update({ facing: (settings.facing - step + 1024) & 1023 })}><ChevronRight size={15} /></button>
        </div>
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
          <option value="">Neutral (no map tint)</option>
          {tints.map(t => <option key={t.map} value={t.map}>{t.title} ×{t.tint.map(v => v.toFixed(2)).join("/")}</option>)}
        </select>
      </label>
      {extra}
    </div>
  );
}
