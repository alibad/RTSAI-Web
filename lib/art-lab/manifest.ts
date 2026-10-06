/** Typed access to data/art-lab.json and the slim per-unit render specs sent to client components. */
import data from "../../data/art-lab.json";
import type { ActorArt, ArtCategory, ArtLabManifest, FactionArt, PaletteRef } from "./types";
import { buildRenderSpec, spriteWithUrlsOf } from "./render-spec";
import type { PaletteSpec, RenderSpec } from "./spec";
import type { PreviousRelease, ReleaseArt } from "./installed-art";
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

export function renderSpec(actor: ActorArt): RenderSpec {
  return buildRenderSpec(actor, fileUrl, paletteSpec);
}

/**
 * The release art this manifest was synced from, with its provenance: what History shows as the release before a
 * promotion replaced it (until `npm run sync:art` refreshes the manifest from the promoted mod).
 */
export function releaseRecord(actor: ActorArt): PreviousRelease {
  const art = (key: string): ReleaseArt | null => {
    const f = artLab.files[key];
    if (!f) return null;
    const p = f.provenance;
    return { file: f.modPath, url: f.url, sha256: f.sha256, origin: p?.origin ?? "unknown", generator: p?.generation?.model ?? p?.tool ?? p?.generator ?? null, date: p?.date ?? p?.source?.date ?? null };
  };
  const icon = actor.cameo.file ? art(actor.cameo.file) : null;
  const model = actor.files.filter(k => /\.(vxl|shp)$/i.test(k) && k !== actor.cameo.file).flatMap(k => { const a = art(k); return a ? [a] : []; });
  return { icon, model };
}

/** Map lighting presets: the mod's maps tint the whole battlefield with TintPostProcessEffect. */
export const neutralTint: [number, number, number] = [1, 1, 1];

/** The actor's sprite description with file keys turned into URLs, for the sprite viewer. */
export function spriteWithUrls(actor: ActorArt) {
  return spriteWithUrlsOf(actor.sprite, fileUrl);
}
