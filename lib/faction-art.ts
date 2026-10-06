/**
 * The project's own faction art for the public Factions pages: unit renders, build-menu cameos, in-game sprite
 * strips, faction lineups and national flags (public/faction-art/, written by scripts/export-faction-art.py).
 * Server-side only. The Studio's public Faction viewer reuses these exports; keep their names stable.
 * Original EA units and factions never get art here: they show flags and text only.
 */
import data from "../data/faction-art.json";
import { categoryLabels as rosterCategoryLabels, rosters, units, type GameMode, type RosterFaction } from "./game-content";

type Sources = { avif: Record<string, string>; webp: Record<string, string> };
export type UnitArt = {
  faction: string;
  category: string;
  render: { width: number; height: number } & Sources;
  cameo: { src: string; width: number; height: number };
  sprite?: { src: string; frameWidth: number; frameHeight: number; frames: number; frameMs: number; motion: "turntable" | "run" | "build" };
};
export type Lineup = { actors: string[]; width: number; height: number } & Sources;
type Manifest = { units: Record<string, UnitArt>; lineups: Record<string, Lineup>; flags: Record<string, { src: string; width: number; height: number }> };
const art = data as unknown as Manifest;

/** The Studio's read-only Faction viewer (/viewer/<catalogFactionId>[/<actorId>]). Links stay hidden until it ships. */
export const VIEWER_READY = false;
export const viewerHref = (factionId: string, actorId?: string) => (actorId ? `/viewer/${factionId}/${actorId}` : `/viewer/${factionId}`);

/** Catalog ids (saudi-arabia) and roster/engine ids (saudi) name the same faction. */
const rosterId = (id: string) => (id === "saudi-arabia" ? "saudi" : id);
const catalogId = (id: string) => (id === "saudi" ? "saudi-arabia" : id);

export const unitArt = (actorId: string): UnitArt | undefined => art.units[actorId.toLowerCase()];
/** The faction's modern units with art, in build-tab order (category, then the mod's build palette order). */
export const factionArtActors = (factionId: string): string[] => {
  const ids = Object.keys(art.units).filter(id => art.units[id].faction === catalogId(factionId));
  return categoryOrder.flatMap(c => ids.filter(id => art.units[id].category === c));
};
export const factionLineup = (factionId: string): Lineup | undefined => art.lineups[catalogId(factionId)];
/** National flags only (flag-icons, MIT). Non-state factions have none: draw <FactionEmblem> instead. */
export const flagSrc = (factionId: string): string | null => art.flags[rosterId(factionId)]?.src ?? null;
export const hasFlag = (factionId: string) => flagSrc(factionId) !== null;

/** The art actor (an r2* id with exported art) for a roster actor of this faction, in either game mode. */
export function artActorFor(actor: { id: string; name: string }, faction: RosterFaction): string | null {
  const id = actor.id.toLowerCase();
  if (unitArt(id)?.faction === catalogId(faction.id)) return id;
  if (faction.mode === "ra2") return null;
  // Classic actors share the faction's identity art through the catalog unit, the r2 naming, or the same name.
  const unit = units.find(u => u.variants.ra?.actorId.toLowerCase() === id);
  const viaUnit = unit?.variants.ra2?.actorId.toLowerCase();
  if (viaUnit && unitArt(viaUnit)) return viaUnit;
  if (unitArt(`r2${id}`)?.faction === catalogId(faction.id)) return `r2${id}`;
  const twin = rosters.factions.find(f => f.mode === "ra2" && f.id === faction.id);
  const named = twin && rosters.actors.find(a => twin.actors.includes(a.key) && a.name === actor.name && unitArt(a.id)?.faction === catalogId(faction.id));
  return named ? named.id : null;
}

export const categoryOrder = ["infantry", "vehicle", "aircraft", "ship", "defense", "structure"] as const;
export const categoryLabels = rosterCategoryLabels;

/** Visual stat bars, each relative to units of the same category in the same mode. */
type Behavior = (typeof rosters.actors)[number]["behavior"];
const firepower = (b: Behavior) => Math.max(0, ...b.weapons.map(w => ((w.damage ?? 0) * Math.max(1, w.burst ?? 1) * 25) / Math.max(1, w.reload ?? 1)));
const reach = (b: Behavior) => Math.max(0, ...b.weapons.map(w => w.range ?? 0));
const statMax = new Map<string, { health: number; speed: number; range: number; firepower: number }>();
function maxFor(mode: GameMode, category: string) {
  const key = `${mode}:${category}`;
  if (!statMax.has(key)) {
    const peers = rosters.actors.filter(a => a.mode === mode && a.category === category);
    // The 90th percentile, so one outlier (a hero unit, a superweapon) does not flatten every other bar.
    const p90 = (values: number[]) => { const v = values.filter(x => x > 0).sort((a, b) => a - b); return Math.max(1, v[Math.floor(0.9 * (v.length - 1))] ?? 1); };
    statMax.set(key, {
      health: p90(peers.map(a => a.behavior.health ?? 0)),
      speed: p90(peers.map(a => a.behavior.speed ?? 0)),
      range: p90(peers.map(a => reach(a.behavior))),
      firepower: p90(peers.map(a => firepower(a.behavior))),
    });
  }
  return statMax.get(key)!;
}
export type UnitStat = { id: "health" | "speed" | "range" | "firepower"; label: string; value: number; display: string };
export function unitStats(actor: { mode: string; category: string; behavior: Behavior }): UnitStat[] {
  const max = maxFor(actor.mode as GameMode, actor.category);
  const b = actor.behavior;
  const out: UnitStat[] = [{ id: "health", label: "Armor", value: (b.health ?? 0) / max.health, display: `${b.health ?? 0} HP${b.armor ? ` · ${b.armor}` : ""}` }];
  if (b.speed) out.push({ id: "speed", label: "Speed", value: b.speed / max.speed, display: `${b.speed}` });
  if (b.weapons.length) {
    out.push({ id: "range", label: "Range", value: reach(b) / max.range, display: `${reach(b)} cells` });
    out.push({ id: "firepower", label: "Firepower", value: firepower(b) / max.firepower, display: `${Math.round(firepower(b))} per second` });
  }
  return out.map(s => ({ ...s, value: Math.max(0.04, Math.min(1, s.value)) }));
}

/** srcset strings for <picture>: avif first, webp fallback. */
export function srcSets(sources: Sources) {
  const set = (byWidth: Record<string, string>) => Object.entries(byWidth).map(([w, src]) => `${src} ${w}w`).join(", ");
  const widths = Object.keys(sources.webp).map(Number).sort((a, b) => a - b);
  return { avif: set(sources.avif), webp: set(sources.webp), fallback: sources.webp[String(widths[widths.length - 1])] };
}
