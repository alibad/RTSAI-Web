"use client";

/* Cameos are static 60x48 PNGs shown at native size; next/image would resample them. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RenderSpec } from "../../../lib/art-lab/spec";
import type { SpriteArt } from "../../../lib/art-lab/types";
import { PixelCanvas } from "./PixelCanvas";
import { UnitViewer } from "./UnitViewer";
import { useInGameRenders, useNearViewport } from "./useInGameRenders";
import { ViewerToolbar } from "./ViewerToolbar";
import { tintFor, useViewSettings, type MapTint, type ViewSettings } from "./viewSettings";
import "../../art-lab.css";

export type RosterTile = { spec: RenderSpec; sprite: SpriteArt | null; href: string | null; hrefLabel?: string; role: string; feedback?: { factionId: string; actorId: string } | null };
export type RosterGroup = { id: string; label: string; note?: string; columns?: { id: string; label: string; tiles: RosterTile[] }[]; tiles?: RosterTile[] };

function Group({ group, settings, tints, open }: { group: RosterGroup; settings: ViewSettings; tints: MapTint[]; open: (tile: RosterTile) => void }) {
  const [ref, near] = useNearViewport<HTMLElement>();
  const tiles = group.tiles ?? group.columns!.flatMap(c => c.tiles);
  const result = useInGameRenders(tiles.map(t => t.spec), { facing: settings.facing, color: settings.color }, near);
  const tint = tintFor(settings.tintMap, tints);
  const tile = (t: RosterTile) => {
    const image = result?.images[t.spec.id] ?? null;
    const error = result?.errors[t.spec.id];
    return (
      <button key={t.spec.id} type="button" className="art-tile" onClick={() => open(t)} aria-haspopup="dialog" title={`Open ${t.spec.name} in the viewer`}>
        <span className="art-tile-stage" style={{ minHeight: image ? undefined : 64 }}>
          {image ? <PixelCanvas image={image} zoom={settings.zoom} backdrop={settings.backdrop} tint={tint} diamond label={`${t.spec.name} at in-game scale, facing ${settings.facing}`} />
            : <span className="art-tile-wait">{error ? `Could not draw: ${error}` : "Rendering…"}</span>}
        </span>
        <span className="art-tile-meta">
          {t.spec.cameo && <img src={t.spec.cameo} width={60} height={48} alt="" className="art-cameo-native" loading="lazy" />}
          <span><b>{t.spec.name}</b><small>{t.role} · <code>{t.spec.id}</code></small></span>
        </span>
      </button>
    );
  };
  return (
    <section ref={ref} className="art-group" aria-label={group.label}>
      <header><h3>{group.label}</h3>{group.note && <p>{group.note}</p>}</header>
      {group.columns ? (
        <div className="art-matrix-row" style={{ gridTemplateColumns: `repeat(${group.columns.length}, minmax(0, 1fr))` }}>
          {group.columns.map(c => (
            <div key={c.id} className="art-matrix-cell"><span className="art-matrix-label">{c.label}</span><div className="art-tiles">{c.tiles.length ? c.tiles.map(tile) : <span className="art-empty">None</span>}</div></div>
          ))}
        </div>
      ) : <div className="art-tiles">{group.tiles!.map(tile)}</div>}
    </section>
  );
}

/** Quick view: the full viewer for one unit in a drawer, without leaving the overview. */
export function QuickView({ tile, tints, onClose }: { tile: RosterTile; tints: MapTint[]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="art-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="art-drawer" role="dialog" aria-modal="true" aria-label={`${tile.spec.name} viewer`}>
        <header>
          {tile.spec.cameo && <img src={tile.spec.cameo} width={60} height={48} alt="" className="art-cameo-native" />}
          <div><b>{tile.spec.name}</b><small>{tile.role} · <code>{tile.spec.id}</code></small></div>
          {tile.href && <Link href={tile.href} className="art-drawer-link">{tile.hrefLabel ?? "Open unit page"} →</Link>}
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close viewer"><X size={18} /></button>
        </header>
        <UnitViewer spec={tile.spec} sprite={tile.sprite} tints={tints} feedback={tile.feedback ?? null} height={420} eager />
      </aside>
    </div>
  );
}

/** Units side by side at true in-game scale: one shared pixel scale, centres aligned per row, a 1-cell diamond under each. Click one for the full viewer. */
export function RosterBoard({ groups, tints, title }: { groups: RosterGroup[]; tints: MapTint[]; title?: string }) {
  const [settings, update] = useViewSettings();
  const [open, setOpen] = useState<RosterTile | null>(null);
  return (
    <div className="art-board">
      {title && <h2 className="art-board-title">{title}</h2>}
      <ViewerToolbar settings={settings} update={update} tints={tints} features={{ modes: false, spin: false }} className="is-sticky" />
      <p className="art-board-note">Every unit is drawn from the mod&apos;s own files at 1 game pixel = {settings.zoom}×{settings.zoom} screen pixels, with its centre on the same point in each row. The outline is one 60×30 terrain cell. Click a unit for the full viewer.</p>
      {groups.map(g => <Group key={g.id} group={g} settings={settings} tints={tints} open={setOpen} />)}
      {open && <QuickView tile={open} tints={tints} onClose={() => setOpen(null)} />}
    </div>
  );
}
