"use client";

/* Cameos are static 60x48 PNGs shown at native size; next/image would resample them. */
/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import type { RenderSpec } from "../../../lib/art-lab/spec";
import { ArtToolbar, tintFor, useArtSettings, type ArtSettings, type MapTint } from "./ArtToolbar";
import { PixelCanvas } from "./PixelCanvas";
import { useInGameRenders, useNearViewport } from "./useInGameRenders";
import "../../art-lab.css";

export type RosterTile = { spec: RenderSpec; href: string | null; role: string };
export type RosterGroup = { id: string; label: string; note?: string; columns?: { id: string; label: string; tiles: RosterTile[] }[]; tiles?: RosterTile[] };

function Group({ group, settings, tints }: { group: RosterGroup; settings: ArtSettings; tints: MapTint[] }) {
  const [ref, near] = useNearViewport<HTMLElement>();
  const tiles = group.tiles ?? group.columns!.flatMap(c => c.tiles);
  const result = useInGameRenders(tiles.map(t => t.spec), { facing: settings.facing, color: settings.color }, near);
  const tint = tintFor(settings, tints);
  const tile = (t: RosterTile) => {
    const image = result?.images[t.spec.id] ?? null;
    const error = result?.errors[t.spec.id];
    const body = (
      <>
        <div className="art-tile-stage" style={{ minHeight: image ? undefined : 64 }}>
          {image ? <PixelCanvas image={image} zoom={settings.zoom} backdrop={settings.backdrop} tint={tint} diamond label={`${t.spec.name} at in-game scale, facing ${settings.facing}`} />
            : <span className="art-tile-wait">{error ? `Could not draw: ${error}` : "Rendering…"}</span>}
        </div>
        <div className="art-tile-meta">
          {t.spec.cameo && <img src={t.spec.cameo} width={60} height={48} alt="" className="art-cameo-native" loading="lazy" />}
          <span><b>{t.spec.name}</b><small>{t.role} · <code>{t.spec.id}</code></small></span>
        </div>
      </>
    );
    return t.href ? <Link key={t.spec.id} href={t.href} className="art-tile">{body}</Link> : <div key={t.spec.id} className="art-tile">{body}</div>;
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

/** Units side by side at true in-game scale: one shared pixel scale, centres aligned per row, a 1-cell diamond under each. */
export function RosterBoard({ groups, tints, title, compact = false }: { groups: RosterGroup[]; tints: MapTint[]; title?: string; compact?: boolean }) {
  const [settings, update] = useArtSettings(compact ? { zoom: 2 } : undefined);
  return (
    <div className={`art-board ${compact ? "is-compact" : ""}`}>
      {title && <h2 className="art-board-title">{title}</h2>}
      <ArtToolbar settings={settings} update={update} tints={tints} facingStep={8} />
      <p className="art-board-note">Every unit is drawn from the mod&apos;s own files at 1 game pixel = {settings.zoom}×{settings.zoom} screen pixels, with its centre on the same point in each row. The outline is one 60×30 terrain cell.</p>
      {groups.map(g => <Group key={g.id} group={g} settings={settings} tints={tints} />)}
    </div>
  );
}
