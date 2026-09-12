import { gameMedia } from "./game-media.generated";

export type FactionId = "red-sea" | "iran" | "turkey" | "china";
export type GameMedia = (typeof gameMedia)[number];
export type GameMediaCategory = GameMedia["category"];

export const mediaCategoryLabels: Record<GameMediaCategory | "all", string> = {
  all: "Everything",
  concept: "Concept art",
  live: "Live game",
  mission: "Missions",
  unit: "Unit sheets",
  cameo: "Cameos",
  audit: "Audits",
  effects: "Effects + damage",
};

export const factionProfiles = [
  {
    id: "red-sea",
    shortLabel: "Red Sea",
    title: "Red Sea 2026",
    subtitle: "Saudi Arabia + Yemen",
    doctrine: "Armor, drones, ambushes, air power, and maritime control collide across three authored missions.",
    status: "Playable alpha",
    heroAssetId: "red-sea-key-art",
    accent: "#d7af79",
    metrics: [
      ["15", "custom combat roles"],
      ["3", "authored missions"],
      ["2", "complete factions"],
    ],
    highlights: ["Jizan Corridor", "Hodeidah Lifeline", "Bab al-Mandab Passage", "Bilingual radio"],
    docsUrl: "https://github.com/alibad/OpenRA-AI/blob/main/docs/red-sea-2026.md",
  },
  {
    id: "iran",
    shortLabel: "Iran",
    title: "Distributed Denial",
    subtitle: "Iran faction",
    doctrine: "Layered reconnaissance and denial reward combined arms, setup windows, rearming, and littoral pressure.",
    status: "Playable build",
    heroAssetId: "iran-naval-combat",
    accent: "#67d6c5",
    metrics: [
      ["14", "production roles"],
      ["10", "doctrine contracts"],
      ["7", "live evidence views"],
    ],
    highlights: ["Karrar armor", "Toufan gunship", "Simorgh loitering munition", "Shadow One"],
    docsUrl: "https://github.com/alibad/OpenRA-AI/blob/main/docs/iran-faction-research.md",
  },
  {
    id: "turkey",
    shortLabel: "Türkiye",
    title: "Anatolian Guard",
    subtitle: "Türkiye faction",
    doctrine: "A versatile mechanized force links armor, electronic warfare, drones, amphibious mobility, and naval control.",
    status: "Playable build",
    heroAssetId: "turkey-roster-concept",
    accent: "#d27768",
    metrics: [
      ["16", "combat actors"],
      ["54", "sprite packages"],
      ["1", "combined-arms mission"],
    ],
    highlights: ["Bozkir tank", "Sancak electronic warfare", "Kuzgun-M UCAV", "Straits Shield"],
    docsUrl: "https://github.com/alibad/OpenRA-AI/blob/main/docs/turkey-faction-validation.md",
  },
  {
    id: "china",
    shortLabel: "China",
    title: "Haitian Network",
    subtitle: "China faction",
    doctrine: "Network specialists coordinate a complete land, air, and naval roster built around information and maneuver.",
    status: "Playable build",
    heroAssetId: "china-native-renderer",
    accent: "#cb4c3b",
    metrics: [
      ["17", "combat actors"],
      ["32", "original effects"],
      ["26", "voice lines"],
    ],
    highlights: ["Network specialist", "Qilin armor", "Amphibious maneuver", "Haitian Network"],
    docsUrl: "https://github.com/alibad/OpenRA-AI/blob/main/docs/china-faction-validation.md",
  },
] as const;

export { gameMedia };
