/**
 * The art manifest as it was synced before the 2026-10-06 promotion: voxel units (Qilin, Karrar, Crane, Mohajer…) and
 * the first sprite sheets. The shipped game now draws prerendered sprites, but the Studio still renders voxels
 * (voxel candidates, original RA2 units), so its pipeline tests keep these as fixtures: a pruned copy of
 * data/art-lab.json at RTSAI-Web e809f53 and the few files the tests decode (tests/fixtures/legacy-art/).
 */
import { readFileSync } from "node:fs";
import data from "./fixtures/legacy-art/manifest.json";
import { buildRenderSpec, spriteWithUrlsOf } from "../lib/art-lab/render-spec";
import type { PaletteSpec } from "../lib/art-lab/spec";
import type { ActorArt, ArtLabManifest } from "../lib/art-lab/types";

export const legacyArt = data as unknown as ArtLabManifest;
export const legacyFileUrl = (key: string | null | undefined) => (key ? legacyArt.files[key]?.url ?? null : null);
function legacyPalette(name: string | undefined): PaletteSpec | null {
  const p = name ? legacyArt.palettes[name] : undefined;
  const url = p?.file ? legacyFileUrl(p.file) : null;
  return p && url ? { name: p.name, url, remap: p.remap, transparent: p.transparent, shadow: p.shadow } : null;
}
export const legacyRenderSpec = (actor: ActorArt) => buildRenderSpec(actor, legacyFileUrl, legacyPalette);
export const legacySpriteWithUrls = (actor: ActorArt) => spriteWithUrlsOf(actor.sprite, legacyFileUrl);
/** A fixture file by manifest key ("voxels/r2qilin.vxl") or URL ("/art-lab/voxels/r2qilin.vxl"). */
export const legacyBytes = (keyOrUrl: string) => new Uint8Array(readFileSync(new URL(`./fixtures/legacy-art/files/${keyOrUrl.replace(/^\/art-lab\//, "")}`, import.meta.url)));
