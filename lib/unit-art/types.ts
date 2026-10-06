/**
 * Shared shapes for unit art on a battlefield: which art an actor uses, and the frames drawn from it. Used by the
 * rasterizing worker (worker.ts), the main-thread service (service.ts) and the sprite atlas (atlas.ts). DOM-free.
 */
import type { FireRules } from "../art-lab/fire";
import type { RenderSpec } from "../art-lab/spec";
import type { SpriteArt } from "../art-lab/types";

/** What a piece is doing; the worker maps it to the art's own sequence (WithInfantryBody attack, a defence's fire). */
export type ArtAction = "stand" | "move" | "attack" | "die" | "damaged";

/**
 * Where an actor's art comes from.
 * - public: the project's own published art (public/art-lab, provenance-checked): the only source on rtsai.net.
 * - preview: the candidate the local preview mod installs (what the game now plays locally).
 * - game: the local RTSAI-Mod main checkout through the dev-only API.
 * - original: an original RA2/RA unit from the player's private local cache. Never published, bundled or deployed.
 */
export type ArtSource = "public" | "preview" | "game" | "original";

/** One drawable art item: the render spec and sprite description the Studio uses, plus local firing rules. */
export type ArtItem = { spec: RenderSpec; sprite: SpriteArt | null; fire: FireRules | null };

export type ActionMeta = { anim: string; frames: number; tickMs: number; facings: number };

/** Everything the main thread needs to request frames for an actor's art, without decoding anything itself. */
export type ArtMeta = {
  /** Art identity (several actors can share one, e.g. the same original unit in two factions). */
  art: string;
  source: ArtSource;
  render: "voxel" | "sprite";
  /** Body facings the art distinguishes (32 for voxels; the stand sequence's facings for sprites). */
  facings: number;
  /** A turret that aims independently of the body. */
  turret: boolean;
  actions: Partial<Record<ArtAction, ActionMeta>>;
  /** Shot length (ms) of the voxel Fire action (recoil and muzzle flash), when the art has firing rules. */
  firePeriodMs: number | null;
  /** Cruise altitude of an aircraft, in screen pixels at 1x. */
  altitudePx: number;
};

/** A frame request. Angles are WAngle (0..1023, 0 = north, counter-clockwise), already quantized by the caller. */
export type FrameRequest = {
  art: string;
  action: ArtAction | "gunfire";
  facing: number;
  /** World facing the turret points at, or -1 (no turret or not aiming). */
  aim: number;
  /** Animation frame index (or, for gunfire, the 40 ms tick since the shot). */
  frame: number;
  /** House colour (hex without #) for the player remap, or null for the art's own colours. */
  color: string | null;
  /** Brightness multiplier (1 = as drawn; wrecks are darker). */
  tint: number;
  shadow: boolean;
};

export type FrameImage = { width: number; height: number; anchorX: number; anchorY: number; data: Uint8ClampedArray };

export const frameKey = (r: FrameRequest) => `${r.art}|${r.action}|${r.facing}|${r.aim}|${r.frame}|${r.color ?? "-"}|${r.tint}|${r.shadow ? 1 : 0}`;

export type ActorRef = { key: string; id: string; mode: "ra" | "ra2"; category: string };

export type ToWorker =
  | { type: "init"; mode: "ra" | "ra2"; probeLocal: boolean }
  | { type: "resolve"; actors: ActorRef[] }
  | { type: "register"; art: string; item: ArtItem; meta: ArtMeta }
  | { type: "frame"; id: number; request: FrameRequest };

export type FromWorker =
  | { type: "ready"; local: boolean; detail: string }
  | { type: "resolved"; entries: { key: string; meta: ArtMeta | null; item: ArtItem | null }[] }
  | { type: "frame"; id: number; image: FrameImage | null; error?: string };
