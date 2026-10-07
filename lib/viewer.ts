/**
 * The public Faction viewer's data (/viewer/<catalogFactionId>[/<actorId>]), server-side only.
 *
 * Players see what the game ships: the project's committed art (data/art-lab.json and public/art-lab, synced from the
 * mod by `npm run sync:art`), the approved build-menu cameos (public/faction-art), rules-derived stats, the faction's
 * doctrine and its campaigns. Nothing here reads the art workspace, candidates, checks, decisions or provenance, and
 * original EA units carry text only: their art is never published.
 */
import { artFactionByCatalogId, artLab, renderSpec, spriteWithUrls } from "./art-lab/manifest";
import type { RenderSpec } from "./art-lab/spec";
import type { SpriteArt } from "./art-lab/types";
import { allCampaigns, campaignsForFaction, type Campaign } from "./faction-campaigns";
import { roleLabel } from "./art-lab/labels";
import { unitArt, unitStats, flagSrc, type UnitStat } from "./faction-art";
import { unitSounds, type PublicSoundGroup } from "./faction-audio";
import { factionById, rosterActors, rosterFactionById, units as catalogUnits, unitLabel } from "./game-content";

export type ViewerWeapon = { projectile: string; range: number | null; reloadSeconds: number | null; damage: number | null; targets: string[] };
export type ViewerUnit = {
  id: string;
  name: string;
  role: string;
  category: string;
  cost: number | null;
  description: string;
  /** Catalog doctrine for the unit, when it has a dossier. */
  strengths: string | null;
  counterplay: string | null;
  dossier: string | null;
  stats: UnitStat[];
  weapons: ViewerWeapon[];
  /** The approved build-menu cameo (60x48, name bar included). */
  cameo: string | null;
  /** The game's own drawing data; null for original EA units, which the viewer shows as text only. */
  art: { spec: RenderSpec; sprite: SpriteArt | null } | null;
  /** The unit's own, licensed sounds (voice lines, its weapon and death sounds where the project made them). */
  sounds: PublicSoundGroup[];
};
export type ViewerCampaign = {
  id: string; title: string; synopsis: string; setting: string;
  /** The faction the campaign is played as (its display name). */
  playedAs: string;
  missions: { id: string; title: string; location: string; summary: string }[];
  characters: { name: string; role: string }[];
};
export type ViewerFaction = {
  id: string; name: string; title: string; tagline: string; story: string; playstyle: string; strengths: string; counterplay: string;
  accent: string; flag: string | null; side: string;
  units: ViewerUnit[];
  /** Campaigns played as this faction, then the others (read-only, from the Campaign Studio's data). */
  campaigns: ViewerCampaign[];
  otherCampaigns: ViewerCampaign[];
};
export type ViewerFactionLink = { id: string; name: string; accent: string; flag: string | null };

const ORDER = ["infantry", "vehicle", "aircraft", "ship", "defense", "structure"];

/** The modern factions the viewer covers, by catalog id (china, …, saudi-arabia), in catalog order. */
export function viewerFactionIds(): string[] {
  return artLab.factions.flatMap(f => (f.catalogId && factionById(f.catalogId) ? [f.catalogId] : []));
}

export function viewerFactionLinks(): ViewerFactionLink[] {
  return viewerFactionIds().map(id => { const f = factionById(id)!; return { id, name: f.name, accent: f.accent, flag: flagSrc(id) }; });
}

export function viewerFaction(catalogId: string): ViewerFaction | null {
  const faction = factionById(catalogId), art = artFactionByCatalogId(catalogId), roster = rosterFactionById(catalogId, "ra2");
  if (!faction || !art || !roster) return null;
  const modern = new Set(art.actors);
  const dossiers = new Map(catalogUnits.filter(u => u.factionId === catalogId && u.variants.ra2).map(u => [u.variants.ra2!.actorId.toLowerCase(), u]));
  const list: ViewerUnit[] = rosterActors(roster).map(actor => {
    const id = actor.id.toLowerCase();
    const dossier = dossiers.get(id);
    const label = dossier ? unitLabel(dossier, "ra2") : null;
    const own = modern.has(id) ? artLab.actors[id] : undefined;
    const b = actor.behavior;
    return {
      id, name: label?.name ?? actor.name, role: label?.role ?? (own ? roleLabel(own) : ""), category: actor.category, cost: actor.cost ?? null,
      description: label?.description ?? b.description?.split("\n")[0] ?? "",
      strengths: dossier?.strengths ?? null, counterplay: dossier?.counterplay ?? null, dossier: dossier ? `/units/${dossier.id}?mode=ra2` : null,
      stats: unitStats(actor),
      weapons: b.weapons.map(w => ({ projectile: w.projectile ?? "Weapon", range: w.range ?? null, reloadSeconds: w.reload ? Math.round((w.reload * 40) / 100) / 10 : null, damage: w.damage ?? null, targets: w.targets ?? [] })),
      cameo: own ? unitArt(id)?.cameo.src ?? null : null,
      art: own ? { spec: renderSpec(own), sprite: spriteWithUrls(own) } : null,
      sounds: own ? unitSounds(id) : [],
    };
  });
  // Project units first in build-tab order; the shared original units after them.
  const rank = (u: ViewerUnit) => (u.art ? 0 : 1) * 100 + ORDER.indexOf(u.category);
  const order = (u: ViewerUnit) => artLab.actors[u.id]?.buildPaletteOrder ?? 9999;
  list.sort((a, b) => rank(a) - rank(b) || order(a) - order(b) || a.name.localeCompare(b.name));
  return {
    id: catalogId, name: faction.name, title: faction.title, tagline: faction.tagline, story: faction.story, playstyle: faction.playstyle,
    strengths: faction.strengths, counterplay: faction.counterplay, accent: faction.accent, flag: flagSrc(catalogId), side: roster.side,
    units: list,
    campaigns: campaignsForFaction(catalogId, "ra2").map(slimCampaign),
    otherCampaigns: allCampaigns("ra2").filter(c => !campaignsForFaction(catalogId, "ra2").includes(c)).map(slimCampaign),
  };
}

function slimCampaign(c: Campaign): ViewerCampaign {
  const playedAs = factionById(c.faction)?.name ?? rosterFactionById(c.faction, c.mode)?.name ?? c.faction;
  return {
    id: c.id, title: c.title, synopsis: c.synopsis, setting: c.setting, playedAs,
    missions: c.missions.map(m => ({ id: m.id, title: m.title, location: m.location, summary: m.summary })),
    characters: c.characters.map(ch => ({ name: ch.name, role: ch.role })),
  };
}
