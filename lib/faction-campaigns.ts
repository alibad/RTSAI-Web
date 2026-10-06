/**
 * Read-only campaigns per faction, for the public faction pages and the Studio's Faction viewer. The one shared
 * source: both read through here rather than the Campaign Studio's editor state. Editing stays admin-only.
 * Today the Campaign Studio's data is its starter campaign; add further authored campaigns to allCampaigns().
 */
import { starterCampaign, type Campaign } from "./campaign";
import type { GameMode } from "./game-content";

export type { Campaign };

const byMode = new Map<GameMode, Campaign[]>();
export function allCampaigns(mode: GameMode): Campaign[] {
  if (!byMode.has(mode)) byMode.set(mode, [starterCampaign(mode)]);
  return byMode.get(mode)!;
}

/** Campaigns played as this faction: catalog (saudi-arabia) or roster (saudi) ids both work. */
export function campaignsForFaction(factionId: string, mode: GameMode): Campaign[] {
  const ids = new Set([factionId, factionId === "saudi-arabia" ? "saudi" : factionId === "saudi" ? "saudi-arabia" : factionId]);
  return allCampaigns(mode).filter(c => ids.has(c.faction));
}
