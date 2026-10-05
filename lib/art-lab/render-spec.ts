/**
 * Builds the slim client RenderSpec for any resolved actor, given how file keys become URLs and how palette
 * names become palettes. The public manifest maps provenance keys to /art-lab/ files; the dev-only Review maps
 * original RA2 files to its local route.
 */
import type { PaletteSpec, RenderSpec } from "./spec";
import type { ActorArt, SpriteArt, SpriteSequence } from "./types";
import { spriteOverlays } from "./sprite-anim";

type Resolved = Pick<ActorArt, "id" | "factionId" | "name" | "category" | "render" | "cameo" | "voxel" | "sprite">;
export type UrlOf = (key: string | null | undefined) => string | null;

const withUrl = (s: SpriteSequence | undefined | null, urlOf: UrlOf): SpriteSequence | null => (s && s.file ? { ...s, file: urlOf(s.file) } : null);

export function buildRenderSpec(actor: Resolved, urlOf: UrlOf, paletteOf: (name: string | undefined) => PaletteSpec | null, cameoUrl?: string | null): RenderSpec {
  const v = actor.voxel;
  const s = actor.sprite;
  const pick = (names: string[]) => names.map(n => s?.sequences.find(q => q.name === n)).find(q => q && q.file && !q.inherited);
  return {
    id: actor.id, factionId: actor.factionId, name: actor.name, category: actor.category, render: actor.render,
    cameo: cameoUrl !== undefined ? cameoUrl : urlOf(actor.cameo.file),
    palette: paletteOf(v?.palette ?? s?.palette),
    voxel: v ? {
      scale: v.scale, cameraPitch: v.cameraPitch, lightPitch: v.lightPitch, lightYaw: v.lightYaw, ambient: v.ambient, diffuse: v.diffuse,
      useClassicPerspectiveFudge: v.useClassicPerspectiveFudge, normals: v.normals.type, altitude: v.cruiseAltitude,
      parts: v.parts.filter(p => p.model.vxl && p.model.hva).map(p => ({
        id: p.id, label: p.label, trait: p.trait, vxl: urlOf(p.model.vxl)!, hva: urlOf(p.model.hva)!, offset: p.offset, showShadow: p.showShadow,
        requiresCondition: p.requiresCondition, turretOffset: p.turret?.offset ?? null, turretInitialFacing: p.turret?.initialFacing ?? null,
        tickRate: p.tickRate, frames: p.model.frames, sequence: p.model.sequence,
      })),
    } : null,
    sprite: s ? {
      stand: withUrl(pick(["stand", "idle"]), urlOf),
      turret: s.turret ? withUrl(s.sequences.find(q => q.name === s.turret!.sequence), urlOf) : null,
      turretInitialFacing: s.turret?.initialFacing ?? null,
      overlay: withUrl(s.sequences.find(q => q.usedBy.some(u => u.startsWith("WithIdleOverlay")) && q.file && !q.inherited), urlOf),
      overlays: spriteOverlays(s).filter(o => o.mode !== "activity").map(o => ({ seq: withUrl(o.seq, urlOf)!, offset: o.offset, animated: o.mode === "loop" })),
    } : null,
  };
}

/** The actor's sprite description with file keys turned into URLs, for the sprite viewer. */
export function spriteWithUrlsOf(sprite: SpriteArt | null, urlOf: UrlOf): SpriteArt | null {
  if (!sprite) return null;
  return { ...sprite, sequences: sprite.sequences.map(s => ({ ...s, file: s.file ? urlOf(s.file) : null })) };
}
