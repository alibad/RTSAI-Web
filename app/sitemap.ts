import type { MetadataRoute } from "next";
import { factions, units } from "../lib/game-content";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-10-02");
  return [
    { url: "https://rtsai.net/factions", lastModified: new Date("2026-10-02"), changeFrequency: "weekly", priority: 0.9 },
    ...factions.map(faction => ({ url: `https://rtsai.net/factions/${faction.id}`, lastModified: new Date("2026-10-02") })),
    ...units.map(unit => ({ url: `https://rtsai.net/units/${unit.id}`, lastModified: new Date("2026-10-02") })),
    { url: "https://rtsai.net/", lastModified, changeFrequency: "weekly", priority: 1 },
    { url: "https://rtsai.net/companion", lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: "https://rtsai.net/download", lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: "https://rtsai.net/privacy", lastModified, changeFrequency: "yearly", priority: 0.2 },
  ];
}
