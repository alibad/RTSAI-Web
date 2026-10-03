"use client";

import { useEffect, useMemo, useState } from "react";
import { loadPlayerPalette, loadShp } from "../../../lib/art-lab/client";
import type { RenderSpec } from "../../../lib/art-lab/spec";
import type { Palette } from "../../../lib/art-lab/pal";
import type { Shp } from "../../../lib/art-lab/shp";
import { shpCompressionNames } from "../../../lib/art-lab/shp";
import { drawShpFrame, indexFacing, sequenceFrame, sequenceLength } from "../../../lib/art-lab/sprite-render";
import type { SpriteArt, SpriteSequence } from "../../../lib/art-lab/types";
import { PixelCanvas, type PixelImage } from "./PixelCanvas";
import { tintFor, type MapTint, type ViewSettings } from "./viewSettings";
import { useNearViewport } from "./useInGameRenders";

function frameImage(shp: Shp, index: number, palette: Palette): PixelImage {
  return { width: shp.width, height: shp.height, data: drawShpFrame(shp, index, palette), anchorX: shp.width / 2, anchorY: shp.height / 2 };
}

function useLoaded(file: string | null, active: boolean) {
  const [shp, setShp] = useState<Shp | null>(null);
  useEffect(() => {
    if (!file || !active) return;
    let cancelled = false;
    loadShp(file).then(s => { if (!cancelled) setShp(s); });
    return () => { cancelled = true; };
  }, [file, active]);
  return shp;
}

function usePalette(spec: RenderSpec, color: string | null) {
  const [palette, setPalette] = useState<Palette | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (spec.palette) loadPlayerPalette(spec.palette, color).then(p => { if (!cancelled) setPalette(p); });
    return () => { cancelled = true; };
  }, [spec.palette, color]);
  return palette;
}

function SequenceCard({ seq, shp, palette, facing, settings, tint, selected, onSelect }: {
  seq: SpriteSequence; shp: Shp; palette: Palette; facing: number; settings: ViewSettings; tint: [number, number, number]; selected: boolean; onSelect: () => void;
}) {
  const length = sequenceLength(seq, shp);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (length < 2) return;
    const timer = setInterval(() => setFrame(f => (f + 1) % (seq.reverses ? 2 * length - 2 : length)), Math.max(20, seq.tick));
    return () => clearInterval(timer);
  }, [length, seq.tick, seq.reverses]);
  const shown = seq.reverses && frame >= length ? 2 * length - 2 - frame : frame;
  const range = useMemo(() => {
    const used: number[] = [];
    for (let f = 0; f < seq.facings; f++) for (let i = 0; i < length; i++) used.push(sequenceFrame(seq, i, (f * 1024) / seq.facings));
    const lo = Math.min(...used), hi = Math.max(...used);
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  }, [seq, length]);
  const index = sequenceFrame(seq, shown, facing);
  const image = useMemo(() => frameImage(shp, index, palette), [shp, index, palette]);
  const shadowIndex = seq.shadowStart >= 0 ? sequenceFrame(seq, shown, facing, true) : -1;
  const shadow = useMemo(() => (shadowIndex >= 0 ? frameImage(shp, shadowIndex, palette) : null), [shp, shadowIndex, palette]);
  return (
    <button type="button" className={`art-seq ${selected ? "is-selected" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <span className="art-seq-stage">
        <PixelCanvas image={image} zoom={settings.zoom} backdrop={settings.backdrop} tint={tint} label={`${seq.name} frame ${index}`} />
        {shadow && <PixelCanvas image={shadow} zoom={settings.zoom} backdrop={settings.backdrop} tint={tint} label={`${seq.name} shadow frame ${shadowIndex}`} />}
      </span>
      <span className="art-seq-meta">
        <b>{seq.name}</b>
        <small>{seq.usedBy.length ? seq.usedBy.join(" · ") : "not drawn by any rules trait"}</small>
        <small>frames {range} · length {String(seq.length)} · facings {seq.facings}{seq.reverseFacings ? " (reversed)" : ""} · tick {seq.tick} ms · offset {seq.offset.join(",")}{seq.zOffset ? ` · ZOffset ${seq.zOffset}` : ""}</small>
        <small>showing frame {index} (facing {facing} → index {indexFacing(facing, seq.facings)}){shadowIndex >= 0 ? `, shadow ${shadowIndex}` : ""}</small>
      </span>
    </button>
  );
}

/** Every sequence (animated at the shared facing), the shadow frames and the full frame grid of a sprite. */
export function SpriteSheet({ spec, sprite, tints, settings }: {
  spec: RenderSpec;
  sprite: SpriteArt;
  tints: MapTint[];
  settings: ViewSettings;
}) {
  const [ref, near] = useNearViewport<HTMLDivElement>("200px");
  const [selected, setSelected] = useState<string>(spec.sprite?.stand?.name ?? "stand");
  const tint = tintFor(settings.tintMap, tints);
  const own = sprite.sequences.filter(s => s.file && !s.inherited && !s.file.endsWith(".png"));
  const shpFile = own[0]?.file ?? null;
  const shp = useLoaded(shpFile, near);
  const palette = usePalette(spec, settings.color);
  const bodyFacings = spec.sprite?.stand?.facings ?? 1;
  const hasTurret = Boolean(spec.sprite?.turret);
  const turretAngle = ((spec.sprite?.turretInitialFacing ?? 0) + settings.turretFacing) & 1023;
  const shadowSeqs = own.filter(s => s.shadowStart >= 0);
  const external = sprite.sequences.filter(s => !s.file || s.inherited);
  const selectedSeq = own.find(s => s.name === selected) ?? own[0];
  // Buildings have one body facing; their multi-facing sequences follow the turret.
  const seqFacing = bodyFacings > 1 || !hasTurret ? settings.facing : turretAngle;
  const highlight = { set: new Set<number>(), current: new Set<number>() };
  if (selectedSeq && shp) {
    const length = sequenceLength(selectedSeq, shp);
    for (let f = 0; f < selectedSeq.facings; f++) for (let i = 0; i < length; i++) {
      const index = sequenceFrame(selectedSeq, i, (f * 1024) / selectedSeq.facings);
      highlight.set.add(index);
      if (indexFacing(seqFacing, selectedSeq.facings) === f) highlight.current.add(index);
    }
  }
  return (
    <div className="art-sheet" ref={ref}>
      <h3 className="art-viewer-title">Sequences</h3>
      {sprite.shp && <p className="art-hint">SHP {sprite.shp.width}×{sprite.shp.height}, {sprite.shp.frames} frames, compression {sprite.shp.compression.map(c => shpCompressionNames[c] ?? c).join(", ")}. Palette <code>{sprite.palette}</code>. Each card animates at the toolbar&apos;s facing.</p>}
      <div className="art-seqs">
        {shp && palette ? own.map(seq => (
          <SequenceCard key={seq.name} seq={seq} shp={shp} palette={palette} facing={seqFacing} settings={settings} tint={tint} selected={selectedSeq?.name === seq.name} onSelect={() => setSelected(seq.name)} />
        )) : <p className="art-stage-status">Loading frames…</p>}
      </div>
      {external.length > 0 && (
        <p className="art-hint">Also attached by rules templates, from RA2 game data and not published here: {external.map(s => <code key={s.name}>{s.name}</code>).reduce<React.ReactNode[]>((a, c, i) => (i ? [...a, ", ", c] : [c]), [])}.</p>
      )}
      <h3 className="art-viewer-title">Shadow frames</h3>
      <p className="art-hint">{shadowSeqs.length ? `ShadowStart is set on ${shadowSeqs.map(s => s.name).join(", ")}; the shadow copies are drawn next to each frame above.` : "No sequence sets ShadowStart, so the game draws no separate sprite shadow for this unit. Any darkness under the figure is painted into the frames themselves."}</p>
      <h3 className="art-viewer-title">Every frame</h3>
      <p className="art-hint">Highlighted: frames of “{selectedSeq?.name}” (bright: the current facing).</p>
      <div className="art-frame-grid">
        {shp && palette && shp.frames.map((_, i) => (
          <figure key={i} className={`art-frame ${highlight.current.has(i) ? "is-current" : highlight.set.has(i) ? "is-in-seq" : ""}`}>
            <FrameThumb shp={shp} index={i} palette={palette} settings={settings} tint={tint} />
            <figcaption>{i}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function FrameThumb({ shp, index, palette, settings, tint }: { shp: Shp; index: number; palette: Palette; settings: ViewSettings; tint: [number, number, number] }) {
  const image = useMemo(() => frameImage(shp, index, palette), [shp, index, palette]);
  return <PixelCanvas image={image} zoom={settings.zoom === 4 ? 2 : 1} backdrop={settings.backdrop} tint={tint} label={`frame ${index}`} />;
}
