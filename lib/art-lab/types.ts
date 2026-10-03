/** Shape of data/art-lab.json, written by scripts/sync-mod-art.mjs from the RTSAI mod. */

export type Vec3 = [number, number, number];

export type ArtCategory = "infantry" | "vehicle" | "aircraft" | "ship" | "structure" | "defense";
export const artCategories: ArtCategory[] = ["infantry", "vehicle", "aircraft", "ship", "defense", "structure"];

export type ProvenanceSummary = {
  sha256: string;
  type: string;
  origin: string;
  generator: string;
  script?: string;
  geometry?: string;
  source?: { repo: string; path: string; commit: string; date?: string };
  tool?: string;
  date?: string;
  generation?: { model: string; model_revision?: string; seed: number; variant: number; prompt: string; subject?: string; runtime?: string };
  replaced?: string;
};

export type ArtFile = {
  /** URL path under the site root, e.g. /art-lab/voxels/r2qilin.vxl */
  url: string;
  /** Path inside the mod repository. */
  modPath: string;
  bytes: number;
  sha256: string;
  provenance: ProvenanceSummary;
};

export type PaletteRef = {
  /** OpenRA palette name, e.g. modern or chinaplayer. */
  name: string;
  /** Base palette file (URL key into files) when this palette comes from a .pal. */
  file: string | null;
  /** Player remap indices (PlayerColorPalette RemapIndex); empty for fixed palettes. */
  remap: number[];
  basePalette: string | null;
  transparent: number[];
  shadow: number[];
  /** Where the palette is defined in the rules. */
  definedBy: string;
};

export type ExternalRef = { ref: string; reason: string };

export type VoxelSection = { name: string; scale: number; size: Vec3; bounds: number[]; normalsMode: number; voxels: number; remapVoxels: number };

export type VoxelModelRef = {
  sequence: string;
  vxl: string | null;
  hva: string | null;
  external: ExternalRef | null;
  sections: VoxelSection[];
  frames: number;
  problems: string[];
};

export type VoxelPart = {
  id: string;
  label: string;
  trait: string;
  model: VoxelModelRef;
  /** WithVoxelBody.Offset (WVec, local). */
  offset: Vec3;
  showShadow: boolean;
  requiresCondition: string | null;
  turret: { name: string; offset: Vec3; initialFacing: number; turnSpeed: number; realignDelay: number } | null;
  barrel: { armament: string; localOffset: Vec3; localOrientation: Vec3; recoil: number; recoilRecovery: number } | null;
  /** Helicopter rotor animation tick rate (WithVoxelHelicopterBody). */
  tickRate: number | null;
};

export type ArmamentRef = { name: string; weapon: string | null; turret: string; localOffset: Vec3[]; recoil: number; recoilRecovery: number; muzzleSequence: string | null };

export type VoxelArt = {
  image: string;
  scale: number;
  lightPitch: number;
  lightYaw: number;
  ambient: Vec3;
  diffuse: Vec3;
  palette: string;
  normals: { palette: string; type: "RedAlert2" | "TiberianSun" };
  shadowPalette: string;
  cameraPitch: number;
  quantizedFacings: number;
  useClassicPerspectiveFudge: boolean;
  parts: VoxelPart[];
  /** Model sequences defined for the image but drawn by no trait. */
  unusedSequences: { sequence: string; vxl: string | null; external: ExternalRef | null }[];
  armaments: ArmamentRef[];
  /** Cruise altitude (world units) for aircraft. */
  cruiseAltitude: number | null;
};

export type SpriteSequence = {
  name: string;
  file: string | null;
  external: ExternalRef | null;
  start: number;
  length: number | "*";
  stride: number;
  facings: number;
  reverseFacings: boolean;
  transpose: boolean;
  tick: number;
  zOffset: number;
  shadowStart: number;
  offset: Vec3;
  frames: number[] | null;
  reverses: boolean;
  /** Which rules trait draws it (e.g. WithInfantryBody stand). */
  usedBy: string[];
  /** Inherited from a sequence template, e.g. ^MindControllable. */
  inherited: boolean;
};

export type SpriteArt = {
  image: string;
  palette: string;
  shp: { width: number; height: number; frames: number; compression: number[] } | null;
  sequences: SpriteSequence[];
  quantizedFacings: number | null;
  turret: { sequence: string; name: string; offset: Vec3; initialFacing: number } | null;
};

export type GeneratorRef = {
  repo: string;
  commit: string;
  script: string;
  functions: { name: string; file: string; line: number; url: string; part?: string }[];
  scriptUrl: string;
  geometry: string | null;
  note: string | null;
};

export type ActorArt = {
  id: string;
  factionId: string;
  name: string;
  description: string;
  category: ArtCategory;
  domain: string | null;
  roles: string[];
  queue: string[];
  buildPaletteOrder: number;
  cost: number | null;
  catalogUnitId: string | null;
  cameo: { file: string | null; external: ExternalRef | null; sequence: string };
  render: "voxel" | "sprite";
  voxel: VoxelArt | null;
  sprite: SpriteArt | null;
  generator: GeneratorRef[];
  /** Files this actor's art reads, all present in ART-PROVENANCE.json. */
  files: string[];
  definedIn: string;
};

export type FactionArt = { id: string; catalogId: string | null; name: string; side: string; accent: string; actors: string[] };

export type ArtLabManifest = {
  schemaVersion: 1;
  generatedBy: string;
  mod: { repo: string; commit: string; provenanceGeneratedBy: string; provenanceSha256: string; commercialRa2Data: string };
  render: {
    tileSize: [number, number];
    tileScale: number;
    shadowColor: [number, number, number, number];
    presetColors: string[];
    /** Maps whose rules tint the battlefield (TintPostProcessEffect: Ambient x Red/Green/Blue). */
    mapTints: { map: string; title: string; tint: [number, number, number] }[];
  };
  palettes: Record<string, PaletteRef>;
  factions: FactionArt[];
  actors: Record<string, ActorArt>;
  files: Record<string, ArtFile>;
};
