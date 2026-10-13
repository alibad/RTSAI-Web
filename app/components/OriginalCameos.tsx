"use client";
/* Cameos are 60x48 pixel art, drawn at whole scales; next/image would resample them. */
/* eslint-disable @next/next/no-img-element */
import { useOriginalArt } from "../../lib/original-art";

/** Westwood's build icons for original-roster units (the Faction Studio's published art); blank tiles until loaded. */
export function OriginalCameos({ ids, mode = "ra2", className = "cameo-strip" }: { ids: string[]; mode?: "ra2" | "ra"; className?: string }) {
  const art = useOriginalArt(ids.length > 0, mode);
  return <div className={className} aria-hidden="true">{ids.map(id => {
    const src = art[id.toLowerCase()]?.spec.cameo;
    return src ? <img key={id} className="unit-cameo" src={src} width={60} height={48} alt="" loading="lazy" decoding="async" /> : <span key={id} className="unit-cameo is-pending" />;
  })}</div>;
}

/** One unit's Westwood build icon (nothing until loaded, or when the unit has none). */
export function OriginalCameo({ id, mode = "ra2" }: { id: string; mode?: "ra2" | "ra" }) {
  const src = useOriginalArt(true, mode)[id.toLowerCase()]?.spec.cameo;
  return src ? <img className="unit-cameo is-inline" src={src} width={30} height={24} alt="" loading="lazy" decoding="async" /> : null;
}
