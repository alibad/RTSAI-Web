/**
 * Public unit art: the modern factions' own art, committed under public/art-lab after the provenance check
 * (scripts/sync-mod-art.mjs; see README "Faction Art Lab"). It has no original RA2 files, so actors without an
 * entry (the original RA2 units, and every Classic actor) have no public art and are drawn as placeholders.
 */
import { artLab, renderSpec, spriteWithUrls } from "../art-lab/manifest";
import type { ActorRef, ArtItem } from "./types";

export function publicItem(actor: ActorRef): ArtItem | null {
  if (actor.mode !== "ra2") return null;
  const art = artLab.actors[actor.id];
  return art ? { spec: renderSpec(art), sprite: spriteWithUrls(art), fire: null } : null;
}
