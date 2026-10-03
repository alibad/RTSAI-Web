"use client";

import { useMemo, useState } from "react";
import type { RenderSpec } from "../../../lib/art-lab/spec";
import { spriteAnimations } from "../../../lib/art-lab/sprite-anim";
import type { SpriteArt } from "../../../lib/art-lab/types";
import { facingLabel } from "../../../lib/art-lab/voxel-math";
import { ArtStage, defaultVisibility } from "./ArtStage";
import { FeedbackButton } from "./FeedbackButton";
import { SpriteSheet } from "./SpriteSheet";
import { ViewerToolbar, type ToolbarFeatures } from "./ViewerToolbar";
import { useViewSettings, type MapTint, type ViewSettings } from "./viewSettings";
import "../../art-lab.css";

export function toolbarFeatures(items: { spec: RenderSpec; sprite: SpriteArt | null }[]): ToolbarFeatures {
  const animations = new Map<string, string>();
  for (const item of items) if (!item.spec.voxel) for (const a of spriteAnimations(item.sprite)) animations.set(a.id, a.label);
  return {
    modes: true,
    turret: items.some(i => i.spec.voxel?.parts.some(p => p.turretOffset) || i.spec.sprite?.turret),
    shadow: items.some(i => i.spec.voxel || i.sprite?.sequences.some(s => s.shadowStart >= 0)),
    airborne: items.some(i => i.spec.voxel?.altitude !== null && i.spec.voxel?.altitude !== undefined),
    frames: items.some(i => i.spec.voxel?.parts.some(p => p.frames > 1)),
    animations: [...animations].map(([id, label]) => ({ id, label })),
  };
}

/** Keyboard on a viewer: arrows turn, Space toggles the turntable. */
export function viewerKeys(settings: ViewSettings, update: (patch: Partial<ViewSettings>) => void) {
  return (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest("input, select, textarea, button")) return;
    if (event.key === "ArrowLeft") { update({ facing: (settings.facing + 32) & 1023, spin: false }); event.preventDefault(); }
    else if (event.key === "ArrowRight") { update({ facing: (settings.facing - 32 + 1024) & 1023, spin: false }); event.preventDefault(); }
    else if (event.key === " ") { update({ spin: !settings.spin }); event.preventDefault(); }
  };
}

/**
 * The full viewer for one unit (the Art Lab unit pages, the quick-view drawer and the public unit pages):
 * In-game / 3D orbit / Exploded, the shared toolbar, part toggles, and for sprites every sequence and frame.
 */
export function UnitViewer({ spec, sprite, tints, feedback = null, check = false, sheet = false, height, eager = false }: {
  spec: RenderSpec;
  sprite: SpriteArt | null;
  tints: MapTint[];
  feedback?: { factionId: string; actorId: string } | null;
  check?: boolean;
  /** Show every sequence and the frame grid below (sprites). */
  sheet?: boolean;
  height?: number;
  eager?: boolean;
}) {
  const [settings, update] = useViewSettings({ animation: spec.voxel ? "stand" : spriteAnimations(sprite)[0]?.id ?? "stand" });
  const [visible, setVisible] = useState<Record<string, boolean>>(() => defaultVisibility(spec));
  const [focusPart, setFocusPart] = useState<string | null>(null);
  const features = useMemo(() => toolbarFeatures([{ spec, sprite }]), [spec, sprite]);
  const parts = spec.voxel?.parts ?? [];
  const view = settings.mode === "ingame" ? "in-game view" : settings.mode === "orbit" ? "3D orbit view" : "exploded view";
  const partText = spec.voxel
    ? (focusPart ? parts.find(p => p.id === focusPart)?.label : parts.filter(p => visible[p.id] !== false).map(p => p.label).join("+"))
    : `${settings.animation} animation`;
  const title = `[art] ${feedback?.factionId}/${feedback?.actorId} — ${view}, facing ${settings.facing} (${facingLabel(settings.facing)})${features.turret ? `, turret ${settings.turretFacing}` : ""}, part: ${partText}`;
  return (
    <div className="art-viewer">
      <div className="art-viewer-head">
        <span className="art-viewer-kind">{spec.voxel ? "Voxel model" : "Pre-rendered sprite (no 3D: shown at every facing)"}</span>
        {feedback && <FeedbackButton title={title} />}
      </div>
      <ViewerToolbar settings={settings} update={update} tints={tints} features={features} />
      {parts.length > 0 && (
        <div className="art-parts" role="group" aria-label="Parts">
          <span>Parts</span>
          {parts.map(p => (
            <label key={p.id} className={`art-check ${focusPart === p.id ? "is-focus" : ""}`}>
              <input type="checkbox" checked={visible[p.id] !== false} onChange={e => setVisible(s => ({ ...s, [p.id]: e.target.checked }))} />
              {p.label}{p.requiresCondition ? <small> ({p.requiresCondition})</small> : null}
              {feedback && <button type="button" className="art-focus" onClick={() => setFocusPart(f => (f === p.id ? null : p.id))} aria-pressed={focusPart === p.id} title="Name this part in the feedback title">◎</button>}
            </label>
          ))}
        </div>
      )}
      {/* The stage is a facing control: arrow keys turn the unit, Space starts the turntable. */}
      <div className="art-viewer-stage" tabIndex={0} role="slider" aria-label={`${spec.name} facing. Left and right arrows turn it, Space spins it.`}
        aria-valuemin={0} aria-valuemax={1023} aria-valuenow={settings.facing} aria-valuetext={`${settings.facing} (${facingLabel(settings.facing)})`} onKeyDown={viewerKeys(settings, update)}>
        <ArtStage spec={spec} sprite={sprite} settings={settings} tints={tints} visible={visible} check={check} height={height} eager={eager} />
      </div>
      {sheet && sprite && <SpriteSheet spec={spec} sprite={sprite} tints={tints} settings={settings} />}
    </div>
  );
}
