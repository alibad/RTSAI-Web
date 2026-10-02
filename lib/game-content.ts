// Shared with installed packages. Engine rules remain authoritative for balance.
import snapshot from "../data/factions.generated.json";
import { gameMedia } from "./game-media.generated";
import release from "../data/openra-ai-release.json";
import coverage from "../data/release-content.json";
export type GameMode = "ra" | "ra2";
export const catalog = snapshot.catalog;
export const factions = catalog.factions;
export const units = catalog.units;
export type Faction = (typeof factions)[number];
export type Unit = (typeof units)[number];
export const modes = catalog.modes;
export function resolveMode(value: string | string[] | undefined, fallback: GameMode = "ra2"): GameMode { return value === "ra" || value === "ra2" ? value : fallback; }
/** Names and roles differ by mode; the catalog validator keeps each one equal to what the game shows. */
export function unitLabel(unit: Unit, mode: GameMode) { const variant = (unit.variants as Partial<Record<GameMode, { name: string; role: string }>>)[mode]; return { name: variant?.name ?? unit.name, role: variant?.role ?? unit.role }; }
export function factionById(id: string) { return factions.find(faction => faction.id === id); }
export function unitById(id: string) { return units.find(unit => unit.id === id); }
export function mediaById(id: string) { return gameMedia.find(asset => asset.id === id); }
export function unitsForFaction(id: string, mode: GameMode) { return units.filter(unit => unit.factionId === id && unit.variants[mode]); }
export function downloadHref(factionId: string, mode: GameMode) { return `/download?faction=${encodeURIComponent(factionId)}&mode=${mode}`; }
export function availability(faction: Faction, mode: GameMode) {
  if (faction.variants[mode].status !== "implemented") return "Not in this mode";
  const verified = coverage.windows.version === release.windows.version && coverage.windows.engineCommit === release.engineCommit && coverage.windows.productCommit === release.productCommit;
  if (verified && coverage.windows.modes[mode].factionIds.some(id => id === faction.id)) return "In public Windows release";
  return "Development · release unconfirmed";
}
