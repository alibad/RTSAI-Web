/**
 * Dev-only, read-only: an actor's firing rules (Armament, Turreted, WithSpriteTurret Recoils, WithVoxelBarrel,
 * WithMuzzleOverlay) from a mod checkout's merged rules: RTSAI-Mod main for what is in game now, the local preview
 * copy (its art-preview overlay included) for candidates. Rules only: muzzle art goes through the originals cache
 * (`/api/art-review/visual`), never through here.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FireArmament, FireRules } from "./fire";
import { child, childValue, traits } from "./miniyaml";
import { loadModData, parseVec3, parseWDist, type ModData, type ModReader } from "./resolve";

const reader = (root: string): ModReader => {
  const path = (p: string) => join(root, existsSync(join(root, "engine")) ? p : p.replace(/^engine\//, ""));
  return { text: p => readFileSync(path(p), "utf8"), bytes: p => new Uint8Array(readFileSync(path(p))), exists: p => existsSync(path(p)) };
};

// Parsing every rule and sequence file takes a moment; other tools change them while the owner reviews.
const TTL_MS = 20_000;
const cache = new Map<string, { at: number; data: ModData }>();
function modData(root: string) {
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const data = loadModData(reader(root));
  cache.set(root, { at: Date.now(), data });
  return data;
}

const list3 = (value: string | null): [number, number, number][] => {
  const n = (value ?? "").split(",").map(s => Number(s.trim())).filter(Number.isFinite);
  const out: [number, number, number][] = [];
  for (let i = 0; i + 2 < n.length; i += 3) out.push([n[i], n[i + 1], n[i + 2]]);
  return out;
};

export function fireRules(root: string, actorId: string, source: "main" | "preview"): FireRules | null {
  const data = modData(root);
  const actor = data.rules.get(actorId.toLowerCase());
  if (!actor) return null;
  const turrets: Record<string, [number, number, number]> = {};
  for (const [instance, node] of traits(actor, "Turreted")) turrets[childValue(node.value, "Turret") ?? (instance || "primary")] = parseVec3(childValue(node.value, "Offset"));
  const armaments: FireArmament[] = traits(actor, "Armament").map(([instance, node]) => {
    const turret = childValue(node.value, "Turret") ?? "primary";
    return {
      name: childValue(node.value, "Name") ?? (instance || "primary"),
      turret: turrets[turret] ? turret : null,
      localOffset: list3(childValue(node.value, "LocalOffset")),
      recoil: parseWDist(childValue(node.value, "Recoil"), 0),
      recoilRecovery: parseWDist(childValue(node.value, "RecoilRecovery"), 9),
      muzzle: childValue(node.value, "MuzzleSequence"),
      muzzlePalette: childValue(node.value, "MuzzlePalette") ?? "effect",
    };
  });
  const spriteTurret = traits(actor, "WithSpriteTurret")[0]?.[1];
  const barrel = traits(actor, "WithVoxelBarrel")[0]?.[1];
  const image = childValue(child(actor, "RenderSprites")?.value, "Image") ?? childValue(child(actor, "RenderVoxels")?.value, "Image") ?? actorId.toLowerCase();
  return {
    source, image, armaments,
    muzzleOverlay: traits(actor, "WithMuzzleOverlay").length > 0,
    spriteRecoils: !/^false$/i.test(childValue(spriteTurret?.value, "Recoils") ?? "true"),
    voxelBarrel: barrel ? { armament: childValue(barrel.value, "Armament") ?? "primary", localOffset: parseVec3(childValue(barrel.value, "LocalOffset")) } : null,
    turrets,
  };
}
