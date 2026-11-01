import type { MetadataRoute } from "next";
import { dossierForRoster, rosters, units } from "../lib/game-content";
import { viewerFactionIds } from "../lib/viewer";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-10-04");
  const factionPaths = [...new Set(rosters.factions.map(f => `/factions/${dossierForRoster(f)?.id ?? f.id}${rosters.factions.some(other => other.id === f.id && other.mode === "ra2") ? "" : "?mode=ra"}`))];
  return [
    { url: "https://rtsai.net/workshop", lastModified, changeFrequency: "weekly", priority: 0.8 },
    { url: "https://rtsai.net/factions", lastModified, changeFrequency: "weekly", priority: 0.9 },
    ...factionPaths.map(path => ({ url: `https://rtsai.net${path}`, lastModified })),
    ...units.map(unit => ({ url: `https://rtsai.net/units/${unit.id}`, lastModified: new Date("2026-10-02") })),
    // The Faction viewer, one page per faction, the original countries included (its unit pages are reached from there and the dossiers).
    ...viewerFactionIds().map(id => ({ url: `https://rtsai.net/viewer/${id}`, lastModified: new Date("2026-10-07") })),
    { url: "https://rtsai.net/", lastModified, changeFrequency: "weekly", priority: 1 },
    { url: "https://rtsai.net/companion", lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: "https://rtsai.net/download", lastModified, changeFrequency: "weekly", priority: 0.9 },
    { url: "https://rtsai.net/privacy", lastModified, changeFrequency: "yearly", priority: 0.2 },
    { url: "https://rtsai.net/terms", lastModified: new Date("2026-11-01"), changeFrequency: "yearly", priority: 0.2 },
  ];
}
