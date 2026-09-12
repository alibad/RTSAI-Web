"use client";
/* Images are pre-compressed, content-hashed WebP assets with manifest dimensions. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowUpRight, Check, ImageIcon, Search, X } from "lucide-react";
import {
  factionProfiles,
  gameMedia,
  mediaCategoryLabels,
  factionContent,
  type FactionId,
  type GameMedia,
  type GameMediaCategory,
} from "../../lib/game-media";

type CategoryFilter = GameMediaCategory | "all";
const categoryOrder: GameMediaCategory[] = ["concept", "live", "mission", "cameo", "unit", "audit", "effects"];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 1024 * 100 ? 1 : 0)} KB`;
}

function sourceUrl(asset: GameMedia) {
  const path = asset.sourcePath.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/alibad/OpenRA-AI/blob/main/${path}`;
}

export function FactionArchive() {
  const [factionId, setFactionId] = useState<FactionId>("red-sea");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(18);
  const [selectedAsset, setSelectedAsset] = useState<GameMedia | null>(null);
  const profile = factionProfiles.find((item) => item.id === factionId) ?? factionProfiles[0];
  const hero = gameMedia.find((asset) => asset.id === profile.heroAssetId) ?? gameMedia[0];

  const factionAssets = useMemo(() => gameMedia
    .filter((asset) => asset.faction === factionId)
    .slice()
    .sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category) || a.title.localeCompare(b.title)), [factionId]);
  const categoryCounts = useMemo(() => factionAssets.reduce<Record<string, number>>((counts, asset) => {
    counts[asset.category] = (counts[asset.category] ?? 0) + 1;
    return counts;
  }, {}), [factionAssets]);
  const availableCategories = useMemo(() => Object.entries(mediaCategoryLabels)
    .filter(([id]) => id === "all" || categoryCounts[id]) as [CategoryFilter, string][], [categoryCounts]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredAssets = useMemo(() => factionAssets.filter((asset) => {
    if (category !== "all" && asset.category !== category) return false;
    if (!normalizedQuery) return true;
    return [asset.title, asset.detail, asset.category, asset.validation, asset.sourcePath].join(" ").toLowerCase().includes(normalizedQuery);
  }), [category, factionAssets, normalizedQuery]);
  const visibleAssets = filteredAssets.slice(0, visibleCount);

  useEffect(() => {
    if (!selectedAsset) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedAsset(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedAsset]);

  return (
    <section className="asset-archive" id="build-archive" aria-labelledby="archive-title">
      <div className="archive-heading">
        <div>
          <span className="section-number">THE BUILD ARCHIVE</span>
          <h2 id="archive-title">See the factions.<br />Inspect the work.</h2>
        </div>
        <div>
          <p>Concepts, production cameos, directional sprites, effects, missions, and live OpenRA evidence—collected from the game repository and labeled by what each image actually proves.</p>
          <span><b>{gameMedia.length}</b> optimized visual artifacts · {factionProfiles.length} faction tracks</span>
        </div>
      </div>

      <div className="faction-tabs" role="tablist" aria-label="Preview a faction">
        {factionProfiles.map((item, index) => {
          const preview = gameMedia.find((asset) => asset.id === item.heroAssetId);
          const count = gameMedia.filter((asset) => asset.faction === item.id).length;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={factionId === item.id}
              aria-controls="faction-panel"
              onClick={() => { setFactionId(item.id); setCategory("all"); setQuery(""); setVisibleCount(18); }}
              style={{ "--faction-accent": item.accent } as CSSProperties}
            >
              {preview && <img src={preview.src} width={preview.width} height={preview.height} loading="lazy" alt="" />}
              <span><i>{String(index + 1).padStart(2, "0")}</i><b>{item.shortLabel}</b><small>{count} artifacts</small></span>
            </button>
          );
        })}
      </div>

      <div className="faction-panel" id="faction-panel" role="tabpanel" style={{ "--faction-accent": profile.accent } as CSSProperties}>
        <button className="faction-hero" type="button" onClick={() => setSelectedAsset(hero)} aria-label={`Open ${hero.title}`}>
          <img src={hero.src} width={hero.width} height={hero.height} alt={hero.title} />
          <span><ImageIcon size={14} /> Open featured evidence</span>
        </button>
        <div className="faction-dossier">
          <div className="faction-dossier-meta"><span>{profile.subtitle}</span><i>{profile.status}</i></div>
          <h3>{profile.title}</h3>
          <p>{profile.doctrine}</p>
          {factionContent[profile.id] && (
            <div className="faction-story-thread">
              <span>STORY THREAD · WORLD WAR III</span>
              <p>{factionContent[profile.id].story.premise}</p>
              <small>{factionContent[profile.id].story.objective}</small>
            </div>
          )}
          <div className="faction-metrics">
            {profile.metrics.map(([value, label]) => <div key={label}><b>{value}</b><span>{label}</span></div>)}
          </div>
          <ul>{profile.highlights.map((highlight) => <li key={highlight}><Check size={12} />{highlight}</li>)}</ul>
          <a href={profile.docsUrl} target="_blank" rel="noreferrer">Read the faction dossier <ArrowUpRight size={14} /></a>
        </div>
      </div>

      <div className="archive-library-heading">
        <div><span className="section-number">ASSET LIBRARY</span><h3>From source board to live proof.</h3></div>
        <p>Showing <b>{Math.min(visibleAssets.length, filteredAssets.length)}</b> of {filteredAssets.length} matching assets for {profile.shortLabel}.</p>
      </div>
      <div className="archive-controls">
        <label className="archive-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search this faction&apos;s assets</span>
          <input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(18); }} placeholder="Search units, missions, effects..." />
        </label>
        <div className="archive-filters" aria-label="Filter asset types">
          {availableCategories.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={category === id} onClick={() => { setCategory(id); setVisibleCount(18); }}>
              {label}<span>{id === "all" ? factionAssets.length : categoryCounts[id]}</span>
            </button>
          ))}
        </div>
      </div>

      {visibleAssets.length ? (
        <>
          <div className="archive-grid">
            {visibleAssets.map((asset) => (
              <button className="archive-card" data-category={asset.category} type="button" key={asset.id} onClick={() => setSelectedAsset(asset)}>
                <span className="archive-card-image"><img src={asset.src} width={asset.width} height={asset.height} loading="lazy" alt={asset.title} /></span>
                <span className="archive-card-copy">
                  <i>{mediaCategoryLabels[asset.category]} · {formatBytes(asset.bytes)}</i>
                  <b>{asset.title}</b>
                  <small>{asset.validation}</small>
                </span>
              </button>
            ))}
          </div>
          {visibleAssets.length < filteredAssets.length && (
            <button className="archive-show-all" type="button" onClick={() => setVisibleCount(filteredAssets.length)}>
              Show all {filteredAssets.length} {profile.shortLabel} assets
            </button>
          )}
        </>
      ) : (
        <div className="archive-empty"><Search size={18} /><b>No matching artifact.</b><button type="button" onClick={() => { setQuery(""); setCategory("all"); }}>Clear filters</button></div>
      )}

      <div className="archive-provenance">
        <span><Check size={13} /> Content-hashed files</span>
        <span><Check size={13} /> Lazy-loaded gallery</span>
        <span><Check size={13} /> Source path on every asset</span>
        <a href="/game-media/manifest.json" target="_blank">Open public manifest <ArrowUpRight size={13} /></a>
      </div>

      {selectedAsset && (
        <div className="asset-lightbox">
          <button className="asset-lightbox-backdrop" type="button" onClick={() => setSelectedAsset(null)} aria-label="Close asset preview" />
          <div className="asset-lightbox-panel" role="dialog" aria-modal="true" aria-labelledby="asset-dialog-title">
            <button className="asset-lightbox-close" type="button" onClick={() => setSelectedAsset(null)} aria-label="Close asset preview"><X size={18} /></button>
            <div className="asset-lightbox-image"><img src={selectedAsset.src} width={selectedAsset.width} height={selectedAsset.height} alt={selectedAsset.title} /></div>
            <div className="asset-lightbox-copy">
              <span>{mediaCategoryLabels[selectedAsset.category]} · {selectedAsset.validation}</span>
              <h3 id="asset-dialog-title">{selectedAsset.title}</h3>
              <p>{selectedAsset.detail}</p>
              <dl><div><dt>Canvas</dt><dd>{selectedAsset.width} × {selectedAsset.height}</dd></div><div><dt>Optimized size</dt><dd>{formatBytes(selectedAsset.bytes)}</dd></div></dl>
              <small>Source: {selectedAsset.sourcePath}</small>
              <a href={sourceUrl(selectedAsset)} target="_blank" rel="noreferrer">Inspect source in the game repository <ArrowUpRight size={14} /></a>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
