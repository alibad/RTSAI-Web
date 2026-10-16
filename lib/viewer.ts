/**
 * The public Faction viewer's data (/viewer/<catalogFactionId>[/<actorId>]), server-side only.
 *
 * Players see what the game ships: the project's committed art (data/art-lab.json and public/art-lab, synced from the
 * mod by `npm run sync:art`), the approved build-menu cameos (public/faction-art), rules-derived stats, the faction's
 * doctrine, its narrative (identity and rivals' views, never the game-only flavour lines) and its campaigns. Nothing here reads the art workspace, candidates, checks, decisions or provenance.
 * Original EA units, and Red Alert 2's nine countries, carry text only here: the browser draws them with Westwood's art
 * from the Faction Studio's published snapshot (lib/original-art.ts), never bundled with the site.
 */
import { artFactionByCatalogId, artLab, renderSpec, spriteWithUrls } from "./art-lab/manifest";
import { sharedUnitCost, sharedUnitStats } from "./shared-content";
import type { RenderSpec } from "./art-lab/spec";
import type { SpriteArt } from "./art-lab/types";
import { allCampaigns, campaignsForFaction, type Campaign } from "./faction-campaigns";
import { factionNarrative, type FactionIdentity } from "./faction-narrative";
import { roleLabel } from "./art-lab/labels";
import { unitArt, unitStats, flagSrc, type UnitStat } from "./faction-art";
import { projectEffects, unitSounds, type PublicClip, type PublicSoundGroup } from "./faction-audio";
import { CLASSIC_ADDON, dossierForRoster, factionById, rosterActors, rosterFactionById, rosterFactions, rosters, units as catalogUnits, unitLabel, type RosterFaction } from "./game-content";
import { demoWeapons, DUMMY_ACTORS, DUMMY_NAMES, type DemoWeapon, type DummyKind, type ViewerDummy } from "./weapon-demo";

export type ViewerWeapon = { id: string; projectile: string; range: number | null; reloadSeconds: number | null; damage: number | null; targets: string[] };
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
  /** What the stage's Attack demo fires: the armaments the unit uses as it stands, and a switchable mode or two. */
  attack: DemoWeapon[];
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
  narrative: ViewerNarrative | null;
  /** The public name for the original units ("Classic add-on"), passed as data so the client never bundles the catalog. */
  classicLabel: string;
  /** One of Red Alert 2's nine countries: every unit is an original one, drawn with Westwood's art. */
  original: boolean;
  /** The units only this country builds among its side's original countries (original countries only). */
  unique: string[];
  /** The roster faction whose voice prefixes the game uses (the published sounds are keyed by it). */
  soundFaction: string;
  /** The Attack demo's training targets: each kind with a real roster unit's health and armor. */
  dummies: ViewerDummy[];
  /** The project's own effects by mod path (explosions the snapshot's sound lists name for original units too). */
  effects: Record<string, PublicClip>;
};
export type ViewerFactionLink = { id: string; name: string; accent: string; flag: string | null; original?: boolean };
/** A rival's in-world view of this faction: propaganda or a grievance, voiced by the rival, never a factual claim. */
export type ViewerRivalView = { rival: ViewerFactionLink; kind: "propaganda" | "grievance" | null; text: string[] };
/** The faction in its own voice and through its rivals' eyes (lib/faction-narrative.ts); framing is the in-world disclaimer. */
export type ViewerNarrative = { identity: FactionIdentity | null; rivalViews: ViewerRivalView[]; framing: string | null };

const ORDER = ["infantry", "vehicle", "aircraft", "ship", "defense", "structure"];

/** The modern factions the viewer covers, by catalog id (china, …, saudi-arabia), in catalog order. */
function modernIds(): string[] {
  return artLab.factions.flatMap(f => (f.catalogId && factionById(f.catalogId) ? [f.catalogId] : []));
}
/** Red Alert 2's nine countries (america, …, russia), Allies first, as the Factions page lists them. */
function originalRosters(): RosterFaction[] {
  const all = rosterFactions("ra2").filter(f => !dossierForRoster(f));
  return ["Allies", "Soviet"].flatMap(side => all.filter(f => f.side.startsWith(side)));
}
const originalAccent = (f: RosterFaction) => (f.side === "Allies" ? "#85afcc" : "#ce8779");

/** Every faction the viewer covers: the modern factions, then the original countries. */
export function viewerFactionIds(): string[] {
  return [...modernIds(), ...originalRosters().map(f => f.id)];
}

export function viewerFactionLinks(): ViewerFactionLink[] {
  return [
    ...modernIds().map(id => { const f = factionById(id)!; return { id, name: f.name, accent: f.accent, flag: flagSrc(id) }; }),
    ...originalRosters().map(f => ({ id: f.id, name: f.name, accent: originalAccent(f), flag: flagSrc(f.id), original: true })),
  ];
}

type RosterActor = ReturnType<typeof rosterActors>[number];
function viewerUnit(actor: RosterActor, dossier: (typeof catalogUnits)[number] | undefined, own: (typeof artLab.actors)[string] | undefined, role = ""): ViewerUnit {
  const id = actor.id.toLowerCase();
  const label = dossier ? unitLabel(dossier, "ra2") : null;
  const override = sharedUnitStats('ra2', actor.id);
  const b = actor.behavior;
  return {
    id, name: label?.name ?? actor.name, role: label?.role ?? (own ? roleLabel(own) : role), category: actor.category, cost: sharedUnitCost('ra2', id, actor.cost ?? null),
    description: label?.description ?? b.description?.split("\n")[0] ?? "",
    strengths: dossier?.strengths ?? null, counterplay: dossier?.counterplay ?? null, dossier: dossier ? `/units/${dossier.id}?mode=ra2` : null,
    stats: unitStats(actor, override),
    weapons: b.weapons.map(w => ({ id: w.id, projectile: w.projectile ?? "Weapon", range: w.range ?? null, reloadSeconds: w.reload ? Math.round((w.reload * 40) / 100) / 10 : null, damage: w.damage ?? null, targets: w.targets ?? [] })),
    cameo: own ? unitArt(id)?.cameo.src ?? null : null,
    art: own ? { spec: renderSpec(own), sprite: spriteWithUrls(own) } : null,
    sounds: own ? unitSounds(id) : [],
    attack: demoWeapons(b.weapons),
  };
}

/** The Attack demo's targets: infantry, a tank, a building, an aircraft, a ship and a submarine, as the game rates them. */
export function viewerDummies(): ViewerDummy[] {
  return (Object.keys(DUMMY_ACTORS) as DummyKind[]).flatMap(kind => {
    const actor = rosters.actors.find(a => a.mode === "ra2" && a.id.toLowerCase() === DUMMY_ACTORS[kind]);
    const health = actor?.behavior.health;
    return actor && health ? [{ kind, name: DUMMY_NAMES[kind], health, armor: actor.behavior.armor ?? "None" }] : [];
  });
}

export function viewerFaction(catalogId: string): ViewerFaction | null {
  const faction = factionById(catalogId), art = artFactionByCatalogId(catalogId), roster = rosterFactionById(catalogId, "ra2");
  if (!faction || !art || !roster) {
    const country = originalRosters().find(f => f.id === catalogId);
    return country ? originalFaction(country) : null;
  }
  const modern = new Set(art.actors);
  const dossiers = new Map(catalogUnits.filter(u => u.factionId === catalogId && u.variants.ra2).map(u => [u.variants.ra2!.actorId.toLowerCase(), u]));
  const list = rosterActors(roster).map(actor => { const id = actor.id.toLowerCase(); return viewerUnit(actor, dossiers.get(id), modern.has(id) ? artLab.actors[id] : undefined); });
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
    narrative: viewerNarrative(catalogId),
    classicLabel: CLASSIC_ADDON,
    original: false,
    unique: [],
    soundFaction: roster.id,
    dummies: viewerDummies(),
    effects: projectEffects(),
  };
}

/** An original country: its whole roster (Westwood's units), its own units marked, and no doctrine or campaigns. */
function originalFaction(country: RosterFaction): ViewerFaction {
  const peers = originalRosters().filter(f => f.side === country.side && f.id !== country.id);
  const actors = rosterActors(country);
  const unique = new Set(actors.filter(a => !peers.some(p => p.actors.includes(a.key))).map(a => a.id.toLowerCase()));
  const list = actors.map(actor => viewerUnit(actor, undefined, undefined, unique.has(actor.id.toLowerCase()) ? `${country.name} only` : ""));
  // Build-tab order with the country's own units leading, then the cheaper units first (as the build menus list them).
  list.sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category) || Number(unique.has(b.id)) - Number(unique.has(a.id)) || (a.cost ?? 0) - (b.cost ?? 0) || a.name.localeCompare(b.name));
  const allied = country.side === "Allies";
  const own = list.filter(u => unique.has(u.id)).map(u => u.name);
  return {
    id: country.id, name: country.name, title: `Original country · ${country.side}`,
    tagline: `The original ${allied ? "Allied" : "Soviet"} arsenal, as the game builds it.`,
    story: `${country.name} builds the ${allied ? "Allied" : "Soviet"} roster${own.length ? `, plus what only ${country.name} fields: ${own.join(", ")}` : ""}. Playable in the browser game alongside the modern factions, in Westwood’s original art.`,
    playstyle: "", strengths: "", counterplay: "", accent: originalAccent(country), flag: flagSrc(country.id), side: country.side,
    units: list, campaigns: [], otherCampaigns: [], narrative: null, classicLabel: CLASSIC_ADDON,
    original: true, unique: [...unique], soundFaction: country.id, dummies: viewerDummies(), effects: projectEffects(),
  };
}

function viewerNarrative(catalogId: string): ViewerNarrative | null {
  const n = factionNarrative(factionById(catalogId));
  if (!n) return null;
  return {
    identity: n.identity, framing: n.framing,
    rivalViews: n.rivalViews.map(v => ({ rival: { ...v.rival, flag: flagSrc(v.rival.id) }, kind: v.kind, text: v.text })),
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
