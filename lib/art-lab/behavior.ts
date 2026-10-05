/** Read-only combat and action facts from merged game rules. Values are configured, not balance measurements. */
import { child, childValue, traits, type Yaml } from "./miniyaml";
import { parseWDist, type ModData } from "./resolve";

export type WeaponFacts = { id: string; range: number; minRange: number; reload: number; burst: number; targets: string[]; projectile: string; damage: number | null; versus: Record<string, number>; condition: string | null };
export type BehaviorFacts = { health: number | null; armor: string; speed: number | null; targetTypes: string[]; weapons: WeaponFacts[]; actions: { id: string; label: string; detail: string }[]; footprint: string | null; source: string; description: string; evidence: "configured" };
const list = (v: string | null | undefined) => (v ?? "").split(",").map(x => x.trim()).filter(Boolean);
const n = (v: string | null | undefined) => v === null || v === undefined || v === "" ? null : Number(v);
const v = (actor: Yaml | undefined, trait: string, key: string) => childValue(child(actor, trait)?.value, key);

export function behaviorFacts(data: ModData, id: string): BehaviorFacts {
  const actor = data.rules.get(id) ?? { value: null, nodes: [] };
  const actions: BehaviorFacts["actions"] = [];
  const add = (trait: string, label: string, detail: string) => { if (traits(actor, trait).length) actions.push({ id: trait, label, detail }); };
  add("GrantConditionOnDeploy", "Deploy", "Switches the actor’s deployed condition; weapon and mobility changes follow the conditions in its rules.");
  add("Transforms", "Transform", `Becomes ${v(actor, "Transforms", "IntoActor") ?? "another actor"}.`);
  add("Aircraft", "Flight", `Cruise altitude ${parseWDist(v(actor, "Aircraft", "CruiseAltitude"), 1280) / 1024} cells; turn speed ${v(actor, "Aircraft", "TurnSpeed") ?? "engine default"}.`);
  add("AttackAircraft", "Attack run", "Aircraft attack activity controls approach, firing and the next pass.");
  add("AmmoPool", "Rearm", `${v(actor, "AmmoPool", "Ammo") ?? "Configured"} ammunition; rearming and landing follow the aircraft’s service rules.`);
  add("FallsToEarth", "Crash", `Falls after destruction; configured fall velocity ${v(actor, "FallsToEarth", "Velocity") ?? "engine default"}.`);
  add("SpawnActorOnDeath", "Wreck", `Spawns ${v(actor, "SpawnActorOnDeath", "Actor") ?? "a configured actor"} when destroyed.`);
  for (const [, death] of traits(actor, "SpawnActorOnDeath")) {
    const huskId = childValue(death.value, "Actor");
    const husk = huskId && data.rules.get(huskId.toLowerCase());
    if (husk && traits(husk, "FallsToEarth").length) actions.push({ id: `crash:${huskId}`, label: "Falling wreck", detail: `${huskId} uses FallsToEarth: velocity ${v(husk, "FallsToEarth", "Velocity") ?? "engine default"}, explosion ${v(husk, "FallsToEarth", "Explosion") ?? "configured"}. The Arena records its altitude after destruction.` });
  }
  add("WithDeathAnimation", "Death animation", "Death sequences vary with the damage type.");
  add("WithMakeAnimation", "Construction", "Plays the make sequence before the finished building appears.");
  add("Cargo", "Transport", `${v(actor, "Cargo", "MaxWeight") ?? "Configured"} capacity; passengers have their own weight and unloading rules.`);
  add("Garrisonable", "Garrison", "Infantry can occupy this structure and fire from its configured ports.");
  add("Cloak", "Cloak", "Visibility changes with cloak conditions and detector coverage.");
  add("Power", "Power", `${v(actor, "Power", "Amount") ?? "Configured"} power; low-power conditions can alter operation.`);
  for (const [instance, t] of traits(actor, "ProximityExternalCondition")) actions.push({ id: `aura:${instance}`, label: "Support aura", detail: `Grants ${childValue(t.value, "Condition")} within ${parseWDist(childValue(t.value, "Range")) / 1024} cells to ${childValue(t.value, "ValidRelationships") ?? "engine-default relationships"}${childValue(t.value, "RequiresCondition") ? ` when ${childValue(t.value, "RequiresCondition")}` : ""}.` });
  for (const [instance, t] of traits(actor, "DetectCloaked")) actions.push({ id: `detector:${instance}`, label: "Detection", detail: `${childValue(t.value, "DetectionTypes") ?? "Cloak"} detection within ${parseWDist(childValue(t.value, "Range")) / 1024} cells${childValue(t.value, "RequiresCondition") ? ` when ${childValue(t.value, "RequiresCondition")}` : ""}.` });
  for (const trait of ["FirepowerMultiplier", "ReloadDelayMultiplier", "RangeMultiplier", "DamageMultiplier", "SpeedMultiplier"]) for (const [instance, t] of traits(actor, trait)) actions.push({ id: `${trait}:${instance}`, label: trait.replace(/([a-z])([A-Z])/g, "$1 $2"), detail: `${childValue(t.value, "Modifier") ?? "Configured"}% when ${childValue(t.value, "RequiresCondition") ?? "active"}.` });
  const weapons = traits(actor, "Armament").map(([, arm]): WeaponFacts => {
    const id = childValue(arm.value, "Weapon") ?? "";
    const w = data.weapons?.get(id.toLowerCase()) ?? { value: null, nodes: [] };
    const warhead = traits(w, "Warhead").find(([, q]) => child(q.value, "Damage"))?.[1].value;
    return { id, range: parseWDist(childValue(w, "Range")) / 1024, minRange: parseWDist(childValue(w, "MinRange")) / 1024,
      reload: Number(childValue(w, "ReloadDelay") ?? 1), burst: Number(childValue(w, "Burst") ?? 1), targets: list(childValue(w, "ValidTargets") ?? "Ground, Water"),
      projectile: child(w, "Projectile")?.value.value ?? "Instant", damage: n(childValue(warhead, "Damage")),
      versus: Object.fromEntries((child(warhead, "Versus")?.value.nodes ?? []).map(q => [q.key, Number(q.value.value)])), condition: childValue(arm.value, "RequiresCondition") };
  });
  return { health: n(v(actor, "Health", "HP")), armor: v(actor, "Armor", "Type") ?? "None", speed: n(v(actor, "Mobile", "Speed") ?? v(actor, "Aircraft", "Speed")),
    targetTypes: traits(actor, "Targetable").flatMap(([, t]) => list(childValue(t.value, "TargetTypes"))), weapons, actions,
    footprint: v(actor, "Building", "Dimensions"), source: data.ruleSources.get(id) ?? "merged rules", description: data.messages.get(v(actor, "Buildable", "Description") ?? "") ?? "", evidence: "configured" };
}
