"use client";

import type { RenderSpec } from "../../../lib/art-lab/spec";
import type { SpriteArt } from "../../../lib/art-lab/types";
import type { MapTint } from "./ArtToolbar";
import { SpriteViewer } from "./SpriteViewer";
import { VoxelViewer } from "./VoxelViewer";
import "../../art-lab.css";

/**
 * The shared unit viewer: the Art Lab and the public unit pages embed this same component, fed from the
 * same published files. three.js loads only when a voxel viewer scrolls into view.
 */
export function UnitArt({ spec, sprite, tints, feedback, compact = false }: {
  spec: RenderSpec;
  sprite: SpriteArt | null;
  tints: MapTint[];
  feedback: { factionId: string; actorId: string } | null;
  compact?: boolean;
}) {
  if (spec.voxel) return <VoxelViewer spec={spec} tints={tints} feedback={feedback} compact={compact} />;
  if (sprite) return <SpriteViewer spec={spec} sprite={sprite} tints={tints} feedback={feedback} />;
  return <p className="art-hint">No published art for this unit.</p>;
}
