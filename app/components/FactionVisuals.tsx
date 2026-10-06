/* Content-hashed, pre-sized images from public/faction-art/: explicit width/height keep layout stable. */
/* eslint-disable @next/next/no-img-element */
import type { CSSProperties, ReactNode } from "react";
import { Anchor, Building2, Plane, Shield, Truck, Users } from "lucide-react";
import { factionLineup, flagSrc, srcSets, unitArt, type UnitStat } from "../../lib/faction-art";

const categoryIcons: Record<string, typeof Users> = { infantry: Users, vehicle: Truck, aircraft: Plane, ship: Anchor, defense: Shield, structure: Building2 };
export function CategoryIcon({ category, size = 16 }: { category: string; size?: number }) {
  const Icon = categoryIcons[category] ?? Shield;
  return <Icon size={size} aria-hidden="true" />;
}

/**
 * Original faction marks, drawn for this site from simple geometry in the faction colour. They carry no national,
 * party or organisational symbol. Non-state factions use one in place of a flag (docs/faction-art.md).
 */
const emblemGlyphs: Record<string, ReactNode> = {
  // Haitan Network: coordination, nodes linked into one net.
  china: <><path d="M32 17 47 41H17Z" fill="none" strokeWidth="3" /><circle cx="32" cy="17" r="5" /><circle cx="47" cy="41" r="5" /><circle cx="17" cy="41" r="5" /><circle cx="32" cy="33" r="3.5" /><path d="M32 22v8M20 39l9-4M44 39l-9-4" strokeWidth="2" /></>,
  // Distributed Denial: overlapping arcs of coverage.
  iran: <><path d="M14 44a18 18 0 0 1 36 0" fill="none" strokeWidth="3" /><path d="M21 44a11 11 0 0 1 22 0" fill="none" strokeWidth="3" /><circle cx="32" cy="44" r="4" /><circle cx="16" cy="22" r="2.5" /><circle cx="48" cy="22" r="2.5" /><circle cx="32" cy="16" r="2.5" /></>,
  // Anatolian Guard: keep the initiative, keep moving.
  turkey: <><path d="M16 18l14 14-14 14" fill="none" strokeWidth="5" strokeLinejoin="miter" /><path d="M31 18l14 14-14 14" fill="none" strokeWidth="5" strokeLinejoin="miter" /><path d="M46 22v20" strokeWidth="3" /></>,
  // Red Sea Command: hold the corridor.
  "saudi-arabia": <><path d="M14 18h36M14 46h36" strokeWidth="4" /><path d="M14 32c5-6 9-6 12 0s7 6 12 0 7-6 12 0" fill="none" strokeWidth="3.5" /></>,
  // Red Sea Resistance: a coastline and the chosen moment.
  yemen: <><path d="M12 44l10-12 8 7 12-17 10 22Z" fill="none" strokeWidth="3" strokeLinejoin="round" /><circle cx="44" cy="15" r="4" /></>,
  // Precision support: a reticle inside the formation.
  israel: <><path d="M32 12 52 32 32 52 12 32Z" fill="none" strokeWidth="3" /><circle cx="32" cy="32" r="7" fill="none" strokeWidth="3" /><path d="M32 18v8M32 38v8M18 32h8M38 32h8" strokeWidth="2.5" /></>,
  // Concealed defense: a ridge line with a firing slit beneath. Original mark; never the organisation's flag or emblem.
  hezbollah: <><path d="M10 38 22 22l8 9 8-13 16 20" fill="none" strokeWidth="3.5" strokeLinejoin="round" /><path d="M14 46h36" strokeWidth="3" /><path d="M24 46h16" strokeWidth="6" /></>,
};

export function FactionEmblem({ factionId, accent, size = 56, label }: { factionId: string; accent: string; size?: number; label?: string }) {
  const glyph = emblemGlyphs[factionId];
  if (!glyph) return null;
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return <svg className="faction-emblem" viewBox="0 0 64 64" width={size} height={size} {...a11y} style={{ color: accent }}>
    <path d="M12 4h40l8 8v40l-8 8H12l-8-8V12Z" fill="#141814" stroke="currentColor" strokeOpacity=".55" strokeWidth="2" />
    <g fill="currentColor" stroke="currentColor" strokeLinecap="square">{glyph}</g>
  </svg>;
}

/** The faction's national flag (flag-icons, MIT), or its original emblem when it is not a state. */
export function FactionFlag({ factionId, name, accent, size = "md", eager = false }: { factionId: string; name: string; accent: string; size?: "sm" | "md" | "lg"; eager?: boolean }) {
  const src = flagSrc(factionId);
  const px = { sm: 32, md: 48, lg: 96 }[size];
  if (src) return <img className={`faction-flag is-${size}`} src={src} width={px} height={px * 3 / 4} alt={`Flag of ${name}`} loading={eager ? "eager" : "lazy"} decoding="async" />;
  return <span className={`faction-flag is-${size} is-emblem`} style={{ "--faction-accent": accent } as CSSProperties} role="img" aria-label={`${name} faction emblem`}>
    <FactionEmblem factionId={factionId} accent={accent} size={px * 0.66} />
  </span>;
}

/** A unit's 3D render, avif with a webp fallback, sized by `sizes`. */
export function UnitRender({ actorId, alt, sizes, priority = false, className }: { actorId: string; alt: string; sizes: string; priority?: boolean; className?: string }) {
  const art = unitArt(actorId);
  if (!art) return null;
  const set = srcSets(art.render);
  return <picture className={className}>
    <source type="image/avif" srcSet={set.avif} sizes={sizes} />
    <source type="image/webp" srcSet={set.webp} sizes={sizes} />
    <img src={set.fallback} width={art.render.width} height={art.render.height} alt={alt} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} decoding="async" />
  </picture>;
}

export function LineupImage({ factionId, alt, sizes, priority = false }: { factionId: string; alt: string; sizes: string; priority?: boolean }) {
  const lineup = factionLineup(factionId);
  if (!lineup) return null;
  const set = srcSets(lineup);
  return <picture className="faction-lineup">
    <source type="image/avif" srcSet={set.avif} sizes={sizes} />
    <source type="image/webp" srcSet={set.webp} sizes={sizes} />
    <img src={set.fallback} width={lineup.width} height={lineup.height} alt={alt} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : undefined} decoding="async" />
  </picture>;
}

/** The installed 60x48 build-menu cameo, name bar included, drawn pixel-exact at an integer scale. */
export function Cameo({ actorId, alt, scale = 1 }: { actorId: string; alt: string; scale?: number }) {
  const art = unitArt(actorId);
  if (!art) return null;
  return <img className="unit-cameo" src={art.cameo.src} width={art.cameo.width * scale} height={art.cameo.height * scale} alt={alt} loading="lazy" decoding="async" />;
}

/** The in-game sprite, animated from one strip with CSS steps (paused for reduced motion). */
export function SpriteLoop({ actorId, alt, scale = 2 }: { actorId: string; alt: string; scale?: number }) {
  const sprite = unitArt(actorId)?.sprite;
  if (!sprite) return null;
  const w = sprite.frameWidth * scale, h = sprite.frameHeight * scale;
  return <span className="sprite-loop" style={{ width: w, height: h, "--frames": sprite.frames, "--duration": `${sprite.frames * sprite.frameMs}ms`, "--strip": `${-w * sprite.frames}px` } as CSSProperties}>
    <img src={sprite.src} width={w * sprite.frames} height={h} alt={alt} loading="lazy" decoding="async" />
  </span>;
}

export function StatBars({ stats, compact = false }: { stats: UnitStat[]; compact?: boolean }) {
  return <dl className={`stat-bars ${compact ? "is-compact" : ""}`}>{stats.map(s =>
    <div key={s.id} title={`${s.label}: ${s.display}`}><dt>{s.label}</dt><dd><span className="stat-bar"><i style={{ width: `${Math.round(s.value * 100)}%` }} /></span>{!compact && <small>{s.display}</small>}</dd></div>)}</dl>;
}

export function CountChips({ counts }: { counts: { category: string; label: string; count: number }[] }) {
  return <ul className="count-chips" aria-label="Roster size">{counts.filter(c => c.count).map(c =>
    <li key={c.category} title={c.label}><CategoryIcon category={c.category} size={14} /><b>{c.count}</b><span>{c.label}</span></li>)}</ul>;
}
