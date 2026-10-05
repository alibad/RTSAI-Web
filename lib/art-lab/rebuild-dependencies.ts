/** Read-only rules graph. Art IDs and sequence contracts only; never reads art pixels. */
import { child, childValue, traits, type Yaml } from "./miniyaml";
import type { ModData } from "./resolve";

const actorFields = new Set(["Actor", "Actors", "IntoActor", "HuskActor", "SpawnActor", "SpawnActors", "ReplaceWithActor", "RearmActors", "InitialActors", "InitialUnits", "SupportActors", "BaseActor", "Slaves", "UnitType", "UnitTypes", "DropItems"]);
const weaponFields = new Set(["Weapon", "Explosion", "DeathWeapon"]);
const values = (s: string | null) => (s ?? "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
type Reference = { kind: "actor" | "weapon" | "image"; id: string; field: string; resolved: boolean };

function references(data: ModData, yaml: Yaml, prefix = ""): Reference[] {
  const out: Reference[] = [];
  for (const node of yaml.nodes) {
    const field = `${prefix}${node.key}`;
    if (actorFields.has(node.key)) for (const id of values(node.value.value)) out.push({ kind: "actor", id, field, resolved: data.rules.has(id) });
    else if (weaponFields.has(node.key)) for (const id of values(node.value.value)) out.push({ kind: "weapon", id, field, resolved: data.weapons?.has(id) ?? false });
    else if (node.key === "Image") for (const id of values(node.value.value)) out.push({ kind: "image", id, field, resolved: data.sequences.has(id) || data.modelSequences.has(id) });
    out.push(...references(data, node.value, `${field}/`));
  }
  return out;
}

export function rebuildDependencies(data: ModData, roots: string[]) {
  const actors: Record<string, { buildable: boolean; references: Reference[]; renderImages: string[]; source: string }> = {};
  const weapons: Record<string, { references: Reference[]; projectile: string }> = {};
  const images: Record<string, { sequences: string[]; modelSequences: string[] }> = {};
  const queue: { kind: "actor" | "weapon" | "image"; id: string }[] = roots.map(id => ({ kind: "actor", id }));
  const seen = new Set<string>(), rootSet = new Set(roots);
  while (queue.length) {
    const { kind, id } = queue.shift()!, key = `${kind}:${id}`;
    if (seen.has(key)) continue; seen.add(key);
    if (kind === "image") {
      images[id] = { sequences: (data.sequences.get(id)?.nodes ?? []).map(n => n.key), modelSequences: (data.modelSequences.get(id)?.nodes ?? []).map(n => n.key) };
      continue;
    }
    const yaml = kind === "actor" ? data.rules.get(id) : data.weapons?.get(id);
    if (!yaml) continue;
    const refs = references(data, yaml);
    if (kind === "actor") {
      const renderImages = ["RenderSprites", "RenderVoxels"].flatMap(t => traits(yaml, t).map(([, n]) => childValue(n.value, "Image")?.toLowerCase() ?? id));
      for (const image of renderImages) refs.push({ kind: "image", id: image, field: "render/default-or-explicit", resolved: data.sequences.has(image) || data.modelSequences.has(image) });
      actors[id] = { buildable: rootSet.has(id), references: refs, renderImages, source: data.ruleSources.get(id) ?? "merged rules" };
    } else weapons[id] = { references: refs, projectile: child(yaml, "Projectile")?.value.value ?? "Instant" };
    for (const ref of refs) if (ref.resolved) queue.push(ref);
  }
  return { evidence: "measured" as const, coverage: "Explicit named actor/weapon/image fields in merged rules, recursively reachable from current build rosters. Passenger type eligibility, implicit engine defaults, scripting and effect variants still need manual verification.", actors, weapons, images };
}
