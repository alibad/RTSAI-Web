"use client";
/** Option lists for the UI kit pickers (app/components/ui/fields.tsx) built from the generated game catalog. */
import { Building2, Footprints, Plane, Shield, Ship, Truck } from "lucide-react";
import { categoryLabels, dossierForRoster, rosterFactions, type GameMode, type RosterFaction } from "../../lib/game-content";
import type { WorkshopActor } from "../../lib/workshop";
import { Swatch, type Option } from "./ui/fields";

const categoryIcons = { infantry: Footprints, vehicle: Truck, aircraft: Plane, ship: Ship, defense: Shield, structure: Building2 };

/** The faction's accent (modern factions) or its side's colour, as the faction cards show it. */
export const factionAccent = (faction: RosterFaction) => dossierForRoster(faction)?.accent ?? (faction.side === "Allies" ? "#85afcc" : "#ce8779");

/** Flag image URLs by roster faction id (public/faction-art/flags), computed on the server by `factionFlags`. */
export type FlagMap = Record<string, string>;

/** Factions of a mode grouped by side, each with its national flag, or its accent swatch when it is not a state. */
export function factionOptions(mode: GameMode, flags: FlagMap = {}): Option[] {
  return rosterFactions(mode).map(f => ({
    value: f.id, label: f.name, group: f.side,
    // eslint-disable-next-line @next/next/no-img-element -- a 16 x 12 content-hashed SVG flag; next/image adds nothing here.
    leading: flags[f.id] ? <img src={flags[f.id]} width={16} height={12} alt="" className="h-3 w-4 shrink-0 rounded-[1px] object-cover ring-1 ring-black/40" /> : <Swatch color={factionAccent(f)} />,
  }));
}

/** Actors grouped by category, with the category icon; the description adds the category and cost. */
export function actorOptions(actors: readonly WorkshopActor[], detail: (actor: WorkshopActor) => string | undefined = a => a.cost !== null ? `$${a.cost.toLocaleString()}` : undefined): Option[] {
  const order = Object.keys(categoryLabels);
  return [...actors].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category)).map(a => {
    const Icon = categoryIcons[a.category as keyof typeof categoryIcons] ?? Truck;
    return { value: a.key, label: a.name, description: detail(a), group: categoryLabels[a.category] ?? a.category, leading: <Icon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" /> };
  });
}

export const teamColors = { blue: "#77c3de", red: "#e8997f", neutral: "#d7c892" } as const;
export const teamOptions: Option<"blue" | "red" | "neutral">[] = (["blue", "red", "neutral"] as const).map(t => ({ value: t, label: t[0].toUpperCase() + t.slice(1), leading: <Swatch color={teamColors[t]} /> }));
