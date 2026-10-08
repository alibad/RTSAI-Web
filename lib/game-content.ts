// Shared with installed packages. Engine rules remain authoritative for balance.
import snapshot from "../data/factions.generated.json";
import { gameMedia } from "./game-media.generated";
import release from "../data/openra-ai-release.json";
import coverage from "../data/release-content.json";
import { getModRelease } from "./mod-release";
export type GameMode = "ra" | "ra2";
export const catalog = snapshot.catalog;
export const factions = catalog.factions;
export const units = catalog.units;
export type Faction = (typeof factions)[number];
export type Unit = (typeof units)[number];
export const modes = catalog.modes;
export const rosters = snapshot.rosters;
export type RosterFaction = (typeof rosters.factions)[number];
export function rosterFactions(mode: GameMode) { return rosters.factions.filter(f => f.mode === mode); }
export function rosterFactionById(id: string, mode: GameMode) {
  return rosterFactions(mode).find(f => f.id === (id === "saudi-arabia" ? "saudi" : id));
}
export function rosterActors(faction: RosterFaction) { const keys = new Set(faction.actors); return rosters.actors.filter(a => keys.has(a.key)); }
export function dossierForRoster(faction: RosterFaction) { return factionById(faction.id === "saudi" ? "saudi-arabia" : faction.id); }
export function rosterHref(faction: RosterFaction) { return `/factions/${dossierForRoster(faction)?.id ?? faction.id}?mode=${faction.mode}`; }
export const categoryLabels: Record<string, string> = { infantry: "Infantry", vehicle: "Vehicles", aircraft: "Aircraft", ship: "Naval", defense: "Defenses", structure: "Buildings" };
/**
 * One standalone product with Classic/top-down and isometric gameplay (owner clarification, 9 October 2026).
 * The Classic port and combined mode chooser remain in progress. Internal ids and catalog names stay stable.
 */
export const modeLabels: Record<GameMode, { name: string; subtitle: string; addOn: boolean }> = {
  ra2: { name: "RTS AI", subtitle: "Modern factions · own art, sound and maps", addOn: false },
  ra: { name: "Classic", subtitle: "Top-down gameplay · integration in progress", addOn: false },
};
export const modeLabel = (mode: GameMode) => modeLabels[mode].name;
/** Legacy identifier retained for callers; original roster entries are not the new Classic-mode delivery. */
export const CLASSIC_ADDON = "Original roster";
export const CLASSIC_ADDON_NOTE = "No Red Alert installation is required. Classic and isometric gameplay remain part of RTS AI; the combined mode selector is being integrated.";
export function resolveMode(value: string | string[] | undefined, fallback: GameMode = "ra2"): GameMode { return value === "ra" || value === "ra2" ? value : fallback; }
/** Names and roles differ by mode; the catalog validator keeps each one equal to what the game shows. */
export function unitLabel(unit: Unit, mode: GameMode) { const variant = (unit.variants as Partial<Record<GameMode, { name: string; role: string; description?: string }>>)[mode]; return { name: variant?.name ?? unit.name, role: variant?.role ?? unit.role, description: variant?.description ?? unit.story }; }
export function factionById(id: string) { return factions.find(faction => faction.id === id); }
export function unitById(id: string) { return units.find(unit => unit.id === id); }
export function mediaById(id: string) { return gameMedia.find(asset => asset.id === id); }
export function unitsForFaction(id: string, mode: GameMode) { return units.filter(unit => unit.factionId === id && unit.variants[mode]); }
export function downloadHref(factionId: string, mode: GameMode) { return `/download?faction=${encodeURIComponent(factionId)}&mode=${mode}`; }
export function availability(faction: Faction, mode: GameMode) {
  if (faction.variants[mode].status !== "implemented") return "Not in this mode";
  // RA2 ships as the RTS AI mod; only factions its published manifest names are claimed.
  if (mode === "ra2") {
    const mod = getModRelease();
    return mod.published && mod.ra2FactionIds.includes(faction.id) ? "In public Windows release" : "Development · release unconfirmed";
  }
  const verified = coverage.windows.version === release.windows.version && coverage.windows.engineCommit === release.engineCommit && coverage.windows.productCommit === release.productCommit;
  if (verified && coverage.windows.modes[mode].factionIds.some(id => id === faction.id)) return "In public Windows release";
  return "Development · release unconfirmed";
}
