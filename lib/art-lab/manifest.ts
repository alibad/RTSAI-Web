/** Typed access to data/art-lab.json and the slim per-unit render specs sent to client components. */
import data from "../../data/art-lab.json";
import type { ActorArt, ArtCategory, ArtLabManifest, FactionArt, PaletteRef, SpriteSequence } from "./types";
import type { PaletteSpec, RenderSpec } from "./spec";
export type { PaletteSpec, RenderSpec } from "./spec";

export const artLab = data as unknown as ArtLabManifest;

export const artFactions: FactionArt[] = artLab.factions;
export const artFactionById = (id: string) => artFactions.find(f => f.id === id);
export const artFactionByCatalogId = (catalogId: string) => artFactions.find(f => f.catalogId === catalogId);
export const artActor = (id: string): ActorArt | undefined => artLab.actors[id];
export const artActorByCatalogUnit = (unitId: string) => Object.values(artLab.actors).find(a => a.catalogUnitId === unitId);
export const factionActors = (factionId: string) => (artFactionById(factionId)?.actors ?? []).map(id => artLab.actors[id]);
export const fileUrl = (key: string | null | undefined) => (key ? artLab.files[key]?.url ?? null : null);

export const categoryLabels: Record<ArtCategory, string> = {
  infantry: "Infantry", vehicle: "Vehicles", aircraft: "Aircraft", ship: "Ships", defense: "Defenses", structure: "Structures",
};

export function paletteSpec(name: string | undefined): PaletteSpec | null {
  const p: PaletteRef | undefined = name ? artLab.palettes[name] : undefined;
  const url = p?.file ? fileUrl(p.file) : null;
  return p && url ? { name: p.name, url, remap: p.remap, transparent: p.transparent, shadow: p.shadow } : null;
}

const withUrl = (s: SpriteSequence | undefined | null): SpriteSequence | null => (s && s.file ? { ...s, file: fileUrl(s.file) } : null);

export function renderSpec(actor: ActorArt): RenderSpec {
  const v = actor.voxel;
  const s = actor.sprite;
  const pick = (names: string[]) => names.map(n => s?.sequences.find(q => q.name === n)).find(q => q && q.file && !q.inherited);
  return {
    id: actor.id, factionId: actor.factionId, name: actor.name, category: actor.category, render: actor.render,
    cameo: fileUrl(actor.cameo.file),
    palette: paletteSpec(v?.palette ?? s?.palette),
    voxel: v ? {
      scale: v.scale, cameraPitch: v.cameraPitch, lightPitch: v.lightPitch, lightYaw: v.lightYaw, ambient: v.ambient, diffuse: v.diffuse,
      useClassicPerspectiveFudge: v.useClassicPerspectiveFudge, normals: v.normals.type, altitude: v.cruiseAltitude,
      parts: v.parts.filter(p => p.model.vxl && p.model.hva).map(p => ({
        id: p.id, label: p.label, trait: p.trait, vxl: fileUrl(p.model.vxl)!, hva: fileUrl(p.model.hva)!, offset: p.offset, showShadow: p.showShadow,
        requiresCondition: p.requiresCondition, turretOffset: p.turret?.offset ?? null, turretInitialFacing: p.turret?.initialFacing ?? null,
        tickRate: p.tickRate, frames: p.model.frames,
      })),
    } : null,
    sprite: s ? {
      stand: withUrl(pick(["stand", "idle"])),
      turret: s.turret ? withUrl(s.sequences.find(q => q.name === s.turret!.sequence)) : null,
      turretInitialFacing: s.turret?.initialFacing ?? null,
      overlay: withUrl(s.sequences.find(q => q.usedBy.some(u => u.startsWith("WithIdleOverlay")) && q.file && !q.inherited)),
    } : null,
  };
}

/** Map lighting presets: the mod's maps tint the whole battlefield with TintPostProcessEffect. */
export const neutralTint: [number, number, number] = [1, 1, 1];

/** The actor's sprite description with file keys turned into URLs, for the sprite viewer. */
export function spriteWithUrls(actor: ActorArt) {
  if (!actor.sprite) return null;
  return { ...actor.sprite, sequences: actor.sprite.sequences.map(s => ({ ...s, file: s.file ? fileUrl(s.file) : null })) };
}
