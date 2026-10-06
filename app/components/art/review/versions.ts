"use client";

import type { RenderSpec } from "../../../../lib/art-lab/spec";
import { candidateLight, candidateRenderSpec, candidateSprite, candidateVehicleSprite, candidatesForSlot, STOCK_VOXEL_LIGHT, type Candidate, type SlotId, type UnitWorkspace } from "../../../../lib/art-lab/review";
import { byCreation, kindTags, versionLabels } from "../../../../lib/art-lab/review-ui";
import type { SpriteArt } from "../../../../lib/art-lab/types";
import type { StageItem } from "./frames";
import type { ActorSources } from "../../../../lib/art-lab/asset-source";
import type { PreviewAnimation } from "../../../../lib/art-lab/chain";
import { withInstalledArmaments, type FireRules } from "../../../../lib/art-lab/fire";

export type ReviewUnit = {
  id: string; factionId: string; factionName: string; name: string; category: string; role: string;
  catalog: { name: string; role: string; story: string } | null;
  queue: string; order: number;
  spec: RenderSpec; sprite: SpriteArt | null;
  /** "new": our art in game today; "original": untouched RA2 art from the player's data; "modified": derived from it. */
  origin?: "new" | "original" | "modified";
  /** Original units: files read from the RA2 cache, and any the mod's own bits override. */
  files?: string[];
  fromModBits?: string[];
  sources?: ActorSources;
  /** The picture lists show for the unit: the cameo the local preview copy installs, else the release icon. */
  identity?: string | null;
  /** The release's own sources when `sources` describes the art the local preview installs instead. */
  releaseSources?: ActorSources;
  /** The last voxel release (the synced manifest) once the game plays a sprite: voxel candidates and History
   *  still draw on the turret offsets and light they were made for. */
  voxelBase?: RenderSpec;
};

/** One card in the filmstrip: what is in game now, the original RA2 unit it replaces, or one candidate. */
export type Version = {
  key: string;
  kind: "current" | "reference" | "candidate";
  candidate: Candidate | null;
  /** Reference versions: the original unit compared against, and why it was chosen. */
  reference?: ReviewUnit;
  referenceWhy?: string;
  /** "Current", "Voxel A", "Sprite B", "Icon C". */
  label: string;
  /** "VXL", "SHP", "PNG". */
  tag: string;
  /** Drawable model (model slot, and the in-game reference in the concept slot). */
  item: StageItem | null;
  /** Image file (icon and concept slots). */
  image: string | null;
  /** Short qualifier shown with the label on the stage, e.g. "stock light". */
  note?: string;
};

// Stable item objects per unit and candidate, so cached frames and models are reused across renders.
const itemCache = new Map<string, StageItem | null>();
/** `play`: the animations the local preview copy's rules give this actor (see candidateRenderSpec). */
export function stageItem(unit: ReviewUnit, candidate: Candidate | null, play: PreviewAnimation[] | null = null, fire: FireRules | null = null): StageItem | null {
  const fireKey = fire ? JSON.stringify(fire) : "";
  if (!candidate) {
    const key = `${unit.id}:current:${JSON.stringify(unit.spec)}:${fireKey}`;
    if (!itemCache.has(key)) itemCache.set(key, { key: "current", spec: unit.spec, sprite: unit.sprite, ...(fire ? { fire } : {}) });
    return itemCache.get(key)!;
  }
  // A voxel candidate for a unit the game now draws as a sprite builds on the last voxel release.
  const base = candidate.files.vxl?.length && !unit.spec.voxel && unit.voxelBase?.voxel ? unit.voxelBase : unit.spec;
  const key = `${unit.id}:${candidate.id}:${candidate.createdAt}:${JSON.stringify(base)}:${JSON.stringify(candidate.urls)}:${JSON.stringify(candidate.sprite)}:${JSON.stringify(candidate.voxelize)}:${candidate.rulesText ?? ""}:${play?.length ? JSON.stringify(play) : ""}:${fireKey}`;
  if (!itemCache.has(key)) {
    // Voxel candidates draw in the voxel slot; sprite candidates use their own frame layout (rules snippet or
    // meta.sprite) when the unit is a voxel today, else the unit's current sprite sequences.
    const voxel = candidateRenderSpec(base, candidate, play);
    const sprite = voxel ? null : candidateVehicleSprite(unit.spec, candidate, unit.sprite) ?? candidateSprite(unit.spec, unit.sprite, candidate);
    const fired = fire ? { fire } : {};
    itemCache.set(key, voxel ? { key: candidate.id, spec: voxel, sprite: null, ...fired } : sprite ? { key: candidate.id, spec: sprite.spec, sprite: sprite.sprite, ...fired } : null);
  }
  return itemCache.get(key)!;
}

/** How a voxel candidate is lit on the stage when it declares its own light (never the current rules silently). */
function lightNote(c: Candidate) {
  const light = candidateLight(c);
  if (!Object.keys(light).length) return undefined;
  const same = (a: number[] | undefined, b: number[]) => Boolean(a && a.every((v, i) => Math.abs(v - b[i]) < 1e-6));
  const stock = light.scale === STOCK_VOXEL_LIGHT.scale && same(light.ambient, STOCK_VOXEL_LIGHT.ambient) && same(light.diffuse, STOCK_VOXEL_LIGHT.diffuse);
  return stock ? "stock RA2 light" : "its own light";
}

const fileUrl = (c: Candidate, file: string | null | undefined) => (file ? c.urls[file.replace(/\\/g, "/")] ?? null : null);

/**
 * Current first (labelled "Original" for untouched RA2 units), then for new units the original RA2 unit they
 * replace as "Reference", then the slot's candidates oldest first, labelled by kind and creation order.
 */
/**
 * Firing rules for the Fire action: what is in game now plays RTSAI-Mod main's rules; a candidate plays the local
 * preview copy's, with the Armament and Turreted blocks its install agent recorded (meta.previewInstall.rules) first.
 */
export type FireSources = { main: FireRules | null; preview: FireRules | null };
export const candidateFire = (fire: FireSources | null | undefined, c: Candidate) => (fire?.preview ? withInstalledArmaments(fire.preview, c.previewInstall?.rules) : null);

export function slotVersions(unit: ReviewUnit, ws: UnitWorkspace | undefined, slot: SlotId, reference: ReviewUnit | null = null, referenceWhy?: string, play: PreviewAnimation[] | null = null, fire: FireSources | null = null): Version[] {
  const candidates = [...candidatesForSlot(ws, slot)].sort(byCreation);
  const labels = versionLabels(candidates);
  const original = unit.origin === "original";
  const current: Version = {
    key: "current", kind: "current", candidate: null, label: original ? "Original" : "In game now",
    tag: slot === "icon" ? "PNG" : unit.spec.voxel ? "VXL" : "SHP",
    item: slot === "icon" ? null : stageItem(unit, null, null, fire?.main ?? null),
    image: slot === "icon" ? unit.spec.cameo : null,
  };
  const ref: Version[] = reference && slot !== "concept" ? [{
    key: `ref:${reference.id}`, kind: "reference", candidate: null, reference, referenceWhy, label: "Reference", tag: slot === "icon" ? "PNG" : reference.spec.voxel ? "VXL" : "SHP",
    item: slot === "icon" ? null : stageItem(reference, null),
    image: slot === "icon" ? reference.spec.cameo : null,
  }] : [];
  return [current, ...ref, ...candidates.map(c => ({
    key: c.id, kind: "candidate" as const, candidate: c, label: labels.get(c.id) ?? c.id, tag: kindTags[c.kind] ?? String(c.kind).toUpperCase(),
    item: slot === "model" ? stageItem(unit, c, play, candidateFire(fire, c)) : null,
    note: slot === "model" && c.files.vxl?.length ? lightNote(c) : undefined,
    image: slot === "icon" ? fileUrl(c, c.files.cameo) : slot === "concept" ? fileUrl(c, c.files.concept) : null,
  }))];
}

/** The side-by-side and swipe pair: Current against the focused version (or the next one: Reference or a candidate). */
export function comparePair(versions: Version[], focus: number): [number, number] | null {
  if (versions.length < 2) return null;
  return [0, focus > 0 ? focus : 1];
}
