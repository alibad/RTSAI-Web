/**
 * Client-safe shapes for drawing a unit. Client components import from here, never from manifest.ts,
 * which pulls in the whole data/art-lab.json.
 */
import type { ArtCategory, SpriteSequence, Vec3 } from "./types";

export type PaletteSpec = { name: string; url: string; remap: number[]; transparent: number[]; shadow: number[] };

/** Everything a client needs to draw one unit's in-game look; file keys are already URLs. */
export type RenderSpec = {
  id: string;
  factionId: string;
  name: string;
  category: ArtCategory;
  render: "voxel" | "sprite";
  /** Aircraft.CruiseAltitude (WDist) for a sprite aircraft (a voxel one keeps it in `voxel.altitude`). */
  airAltitude?: number | null;
  cameo: string | null;
  palette: PaletteSpec | null;
  voxel: null | {
    scale: number; cameraPitch: number; lightPitch: number; lightYaw: number; ambient: Vec3; diffuse: Vec3;
    useClassicPerspectiveFudge: boolean; normals: "RedAlert2" | "TiberianSun"; altitude: number | null;
    parts: { id: string; label: string; trait: string; vxl: string; hva: string; offset: Vec3; showShadow: boolean;
      requiresCondition: string | null; turretOffset: Vec3 | null; turretInitialFacing: number | null; tickRate: number | null; frames: number;
      /** The model sequence the trait draws (e.g. a helicopter body's "rotor"). */
      sequence?: string;
      /** What its HVA frames turn, when known: "rotor", "propeller" or "radar" (see action-labels.ts). */
      spin?: string;
      /** Overrides the condition-based default (review candidates with alternative parts). */
      defaultVisible?: boolean }[];
  };
  sprite: null | {
    stand: SpriteSequence | null;
    turret: SpriteSequence | null;
    turretInitialFacing: number | null;
    overlay: SpriteSequence | null;
    overlays?: { seq: SpriteSequence; offset: Vec3; animated: boolean }[];
  };
};

/** Parts drawn by default (conditions such as `reloading` are off; `!reloading` is on). */
export const drawnByDefault = (condition: string | null) => !condition || condition.trim().startsWith("!");
export const partVisibleByDefault = (part: { requiresCondition: string | null; defaultVisible?: boolean }) => part.defaultVisible ?? drawnByDefault(part.requiresCondition);
