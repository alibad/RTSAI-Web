/**
 * Canonical editorial relationships shared by the web experience and the game.
 * Runtime rules remain authoritative for exact values; these records explain
 * what an experience, faction, unit, mechanic, and mission mean to players.
 */
export type GameExperienceId = "classic-red-alert" | "world-war-iii";
export type ContentRelationship = "shared" | "variant" | "introduced" | "inspired-by";

export type FactionContent = {
  id: string;
  experienceIds: GameExperienceId[];
  story: { premise: string; objective: string; tone: string };
  variants: Partial<Record<GameExperienceId, {
    status: "available" | "not-available" | "planned";
    doctrine?: string;
    mechanicIds?: string[];
    unitIds?: string[];
    missionIds?: string[];
  }>>;
};

export const experiences = [
  {
    id: "classic-red-alert" as const,
    title: "Classic Red Alert",
    description: "The original OpenRA Red Alert ruleset, factions, and roster.",
  },
  {
    id: "world-war-iii" as const,
    title: "World War III",
    description: "The modern RA2-inspired experience with expanded factions and mechanics.",
  },
] as const;

export type UnitContent = {
  id: string;
  factionId: string;
  displayName: string;
  relationship: ContentRelationship;
  actorIds: Partial<Record<GameExperienceId, string>>;
  role: string;
  story: string;
  mechanicIds: string[];
  assetIds: string[];
};

export const factionContent: Record<string, FactionContent> = {
  china: {
    id: "china",
    experienceIds: ["world-war-iii"],
    story: {
      premise: "The Haitian Network turns coordination, logistics, and maritime reach into battlefield power.",
      objective: "Project force across land, air, and sea while keeping the network and its command nodes alive.",
      tone: "Disciplined, technological, and strategically patient.",
    },
    variants: {
      "classic-red-alert": { status: "not-available" },
      "world-war-iii": {
        status: "available",
        doctrine: "Network specialists coordinate armor, amphibious forces, aviation, and naval strike platforms.",
        mechanicIds: ["carrier-and-drone-wing", "networked-force"],
        unitIds: ["cnrifle", "cnqilin", "cnhaiwang", "cncloud"],
        missionIds: ["haitian-network"],
      },
    },
  },
};

export const unitContent: UnitContent[] = [
  {
    id: "cnhaiwang",
    factionId: "china",
    displayName: "Haiwang",
    relationship: "introduced",
    actorIds: { "world-war-iii": "CNHAIWANG" },
    role: "Carrier and drone command ship",
    story: "A floating command node that extends the Haitian Network beyond the coastline.",
    mechanicIds: ["carrier-and-drone-wing"],
    assetIds: ["china-cnhaiwangicon-review", "china-cnhaiwang-contact-sheet"],
  },
  {
    id: "cncloud",
    factionId: "china",
    displayName: "Cloud",
    relationship: "introduced",
    actorIds: { "world-war-iii": "CNHAIWANGDRONE" },
    role: "Reusable carrier-launched strike drone",
    story: "An expendable-looking but recoverable extension of the carrier’s command link.",
    mechanicIds: ["carrier-and-drone-wing"],
    assetIds: ["china-cncloudicon-review", "china-cncloud-contact-sheet"],
  },
];

export const mechanicContent = {
  "carrier-and-drone-wing": {
    title: "Carrier and drone wing",
    playerMeaning: "Launch reusable strike drones from the Haiwang, protect the carrier, and manage the timing of sorties and recovery.",
  },
  "networked-force": {
    title: "Haitian Network",
    playerMeaning: "Coordinate complementary units so information and positioning become a combat advantage.",
  },
} as const;

export const missionContent = {
  "haitian-network": {
    title: "Haitian Network",
    factionId: "china",
    experienceId: "world-war-iii" as const,
    purpose: "Keep the network alive while projecting coordinated force across the theatre.",
  },
} as const;
