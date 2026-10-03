/**
 * Each modern faction's real build roster, computed from the mod's merged rules (never hand-listed):
 *
 * - a faction owns its StartingUnits (base and support actors) and whatever they transform into;
 * - it has every prerequisite its Player/World provide for it, plus those provided by actors it owns
 *   (`ProvidesPrerequisite` with no `Factions` or with this faction listed; tech level unrestricted);
 * - an actor is buildable when its positive `Buildable.Prerequisites` are all available and none of its negated
 *   ones (`~!faction.china`) is always on for the faction. Owned actors provide more prerequisites, to a fixed point.
 *
 * Modern units are the faction's own actors (gated `~faction.<id>`); everything else it can build is stock RA2.
 * A stock unit gated off with `~!faction.<id>` is one the faction replaced. Each new unit's Reference is the
 * replaced stock unit of the same category and role (else the closest stock unit of that category and role).
 */
import { child, childValue, traits, type Yaml } from "./miniyaml";
import { categorize, MODERN_FACTIONS, type ModData } from "./resolve";
import type { ArtCategory } from "./types";

export type RosterOrigin = "new" | "original" | "modified";

export type RosterUnit = {
  id: string;
  name: string;
  category: ArtCategory;
  queue: string;
  order: number;
  cost: number | null;
  roles: string[];
  origin: RosterOrigin;
  /** New units: the stock unit to compare against. */
  reference: string | null;
  /** Needs a tech or radar building (the side's standard unit does not). */
  advanced: boolean;
};

export type FactionRoster = {
  id: string;
  name: string;
  side: string;
  units: RosterUnit[];
  /** Stock units this faction can no longer build (`~!faction.<id>`): what its new units replace. */
  replaced: string[];
};

const list = (value: string | null | undefined) => (value ?? "").split(",").map(s => s.trim()).filter(Boolean);
const QUEUES = new Set(["Infantry", "Vehicle", "Aircraft", "Ship", "Building", "Defense", "Support"]);
const WEAPONS = ["Armament", "AttackTurreted", "AttackOmni", "AttackTesla"];
const ORDER: ArtCategory[] = ["infantry", "vehicle", "aircraft", "ship", "defense", "structure"];

type Token = { name: string; negated: boolean };
function tokens(actor: Yaml): Token[] {
  return list(childValue(child(actor, "Buildable")?.value, "Prerequisites")).map(t => {
    const bare = t.replace(/^~/, "");
    return bare.startsWith("!") ? { name: bare.slice(1), negated: true } : { name: bare, negated: false };
  });
}

/** Prerequisites an actor provides for a faction (ProvidesPrerequisite / ProvidesTechPrerequisite). */
function provided(name: string, actor: Yaml, faction: string) {
  const out: string[] = [];
  for (const [, node] of traits(actor, "ProvidesPrerequisite")) {
    const factions = list(childValue(node.value, "Factions"));
    if (factions.length && !factions.includes(faction)) continue;
    out.push(childValue(node.value, "Prerequisite") ?? name);
  }
  for (const [, node] of traits(actor, "ProvidesTechPrerequisite")) out.push(...list(childValue(node.value, "Prerequisites")));
  return out;
}

const drawable = (actor: Yaml) => Boolean(child(actor, "RenderSprites") || child(actor, "RenderVoxels"));

/** Actors a faction starts with (any StartingUnits class) and what they transform into. */
function startingActors(world: Yaml, faction: string) {
  const out = new Set<string>();
  for (const [, node] of traits(world, "StartingUnits")) {
    const factions = list(childValue(node.value, "Factions"));
    if (factions.length && !factions.includes(faction)) continue;
    const base = childValue(node.value, "BaseActor");
    if (base) out.add(base.toLowerCase());
    for (const a of list(childValue(node.value, "SupportActors"))) out.add(a.toLowerCase());
  }
  return out;
}

const TRANSFORMS = ["Transforms", "TransformsIntoMobile", "DeployToUpgrade", "GrantConditionOnDeploy"];

/** Every actor a faction can own: buildable to a fixed point from its starting units. */
export function buildableFor(data: ModData, faction: string) {
  const world = data.rules.get("world")!;
  const player = data.rules.get("player");
  const always = new Set<string>([...(player ? provided("player", player, faction) : []), ...provided("world", world, faction)]);
  const available = new Set(always);
  const owned = startingActors(world, faction);
  const buildables = [...data.rules].filter(([name, a]) => !name.startsWith("^") && child(a, "Buildable"));
  let changed = true;
  while (changed) {
    changed = false;
    for (const name of [...owned]) {
      const actor = data.rules.get(name);
      if (!actor) continue;
      for (const p of provided(name, actor, faction)) if (!available.has(p)) { available.add(p); changed = true; }
      for (const t of TRANSFORMS) for (const [, node] of traits(actor, t)) {
        const into = childValue(node.value, "IntoActor")?.toLowerCase();
        if (into && !owned.has(into)) { owned.add(into); changed = true; }
      }
    }
    for (const [name, actor] of buildables) {
      if (owned.has(name)) continue;
      const ts = tokens(actor);
      if (ts.some(t => t.negated && always.has(t.name))) continue;
      if (!ts.every(t => t.negated || available.has(t.name))) continue;
      owned.add(name);
      changed = true;
    }
  }
  return { owned, always };
}

function unitOf(data: ModData, id: string, origin: RosterOrigin): RosterUnit | null {
  const actor = data.rules.get(id);
  const buildable = child(actor, "Buildable")?.value;
  if (!actor || !buildable || !drawable(actor)) return null;
  const queue = list(childValue(buildable, "Queue"));
  if (!queue.some(q => QUEUES.has(q))) return null;
  const nameKey = childValue(child(actor, "Tooltip")?.value, "Name");
  const cost = child(actor, "Valued") ? Number(childValue(child(actor, "Valued")!.value, "Cost") ?? 0) : null;
  // Walls, superweapons and the like share the Support queue with defences; only armed ones are defences.
  let category = categorize(actor, queue);
  if (category === "defense" && !WEAPONS.some(w => traits(actor, w).length)) category = "structure";
  const techPrereq = tokens(actor).some(t => !t.negated && /tech|radar|naradr/.test(t.name));
  return {
    id, name: (nameKey && data.messages.get(nameKey)) || (nameKey && !nameKey.startsWith("actor-") ? nameKey : null) || id.charAt(0).toUpperCase() + id.slice(1),
    category, advanced: techPrereq, queue: queue[0] ?? "", order: Number(childValue(buildable, "BuildPaletteOrder") ?? 9999),
    cost: Number.isFinite(cost) ? cost : null,
    roles: list(childValue(child(actor, "StrategicRole")?.value, "Roles")),
    origin, reference: null,
  };
}

/** The Reference for a new unit: the replaced stock unit of the same category and role, else the closest one. */
export function pickReference(unit: RosterUnit, replaced: RosterUnit[], stock: RosterUnit[]) {
  const score = (s: RosterUnit, isReplaced: boolean) => {
    if (s.category !== unit.category) return -Infinity;
    const role = s.roles.some(r => unit.roles.includes(r)) ? 50 : 0;
    const cost = unit.cost !== null && s.cost !== null ? -Math.abs(unit.cost - s.cost) / 200 : -3;
    // Between equals, the side's standard unit (no tech building) is the fairer reference.
    return role + (isReplaced ? 30 : 0) + (s.advanced ? 0 : 10) + cost;
  };
  let best: { id: string; score: number } | null = null;
  for (const s of replaced) { const v = score(s, true); if (v > -Infinity && (!best || v > best.score)) best = { id: s.id, score: v }; }
  for (const s of stock) { const v = score(s, false); if (v > -Infinity && (!best || v > best.score)) best = { id: s.id, score: v }; }
  return best?.id ?? null;
}

export function computeRosters(data: ModData, factionIds: readonly string[] = MODERN_FACTIONS): { factions: FactionRoster[]; stock: Record<string, RosterUnit> } {
  const world = data.rules.get("world")!;
  const modern = new Map<string, string>();
  for (const [name, actor] of data.rules) {
    if (name.startsWith("^")) continue;
    const ts = tokens(actor);
    const f = factionIds.find(id => ts.some(t => !t.negated && t.name === `faction.${id}`));
    if (f) modern.set(name, f);
  }
  // Every stock unit any faction (modern or classic) can build: the pool for references.
  const allStock = new Map<string, RosterUnit>();
  for (const [name, actor] of data.rules) {
    if (name.startsWith("^") || modern.has(name) || !child(actor, "Buildable")) continue;
    if (tokens(actor).some(t => !t.negated && t.name === "disabled")) continue;
    const u = unitOf(data, name, "original");
    if (u) allStock.set(name, u);
  }
  const factions = factionIds.map(id => {
    const trait = traits(world, "Faction").map(([, n]) => n).find(n => childValue(n.value, "InternalName") === id);
    const { owned } = buildableFor(data, id);
    const units: RosterUnit[] = [];
    const replaced: RosterUnit[] = [];
    for (const [name, actor] of data.rules) {
      if (name.startsWith("^") || !child(actor, "Buildable")) continue;
      if (modern.get(name) === id) { const u = unitOf(data, name, "new"); if (u) units.push(u); continue; }
      if (modern.has(name)) continue;
      if (tokens(actor).some(t => t.negated && t.name === `faction.${id}`)) { const u = allStock.get(name); if (u) replaced.push(u); continue; }
      if (owned.has(name)) { const u = allStock.get(name); if (u) units.push({ ...u }); }
    }
    const stockPool = [...allStock.values()].filter(s => !replaced.includes(s));
    for (const u of units) if (u.origin === "new") u.reference = pickReference(u, replaced, stockPool);
    units.sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || (a.origin === b.origin ? 0 : a.origin === "new" ? -1 : 1) || a.order - b.order || a.id.localeCompare(b.id));
    return {
      id, name: data.messages.get(childValue(trait?.value, "Name") ?? "") ?? id, side: childValue(trait?.value, "Side") ?? "",
      units, replaced: replaced.map(r => r.id),
    };
  });
  return { factions, stock: Object.fromEntries(allStock) };
}
