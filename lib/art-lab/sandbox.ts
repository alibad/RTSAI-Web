/**
 * The browser game's battle sandbox (RTSAI-WebGame, /play/?mode=sandbox): the same engine simulation as the game,
 * in the page. This builds its link from an Encounter setup, using the sandbox's URL contract: `s` is base64url JSON
 * { fa, fb, level, health, autorun, placements: [{ id, side, u, v, order, destination, deploy, faction }] }.
 */
import type { DuelPlacement } from "./duel-server";

export type SandboxSetup = { placements: DuelPlacement[]; factions: [string, string] | string[]; level: number; health?: number; autorun?: boolean };
/** The native Encounter's arena is centred on v 66; the sandbox's on v 72 (u is centred on 64 in both). */
const V_SHIFT = 6;

const base64url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function sandboxState(setup: SandboxSetup) {
  return {
    fa: setup.factions[0] || undefined, fb: setup.factions[1] || undefined, level: setup.level, health: setup.health ?? 100, autorun: setup.autorun ?? false,
    placements: setup.placements.map(p => ({
      id: p.id, side: p.side, u: p.u, v: p.v + V_SHIFT, order: p.order ?? "engage", deploy: p.deploy, faction: p.faction || setup.factions[p.side] || undefined,
      ...(p.destination ? { destination: { u: p.destination.u, v: p.destination.v + V_SHIFT } } : {}),
    })),
  };
}

export const sandboxHref = (setup: SandboxSetup) => `/play/?mode=sandbox&s=${base64url(JSON.stringify(sandboxState(setup)))}`;

/**
 * The Encounter for a unit the Studio has open: it against a default opponent (an Apocalypse tank, as the native
 * Encounter used), each on its side of the arena; the sandbox opens in edit mode unless `autorun`.
 */
export function encounterHref(actor: string, faction: string, { autorun = false, opponent = { id: "htnk", faction: "russia" } } = {}) {
  return sandboxHref({
    placements: [
      { key: "a", id: actor, side: 0, u: 58, v: 66, deploy: false, faction, order: "engage" },
      { key: "b", id: opponent.id, side: 1, u: 70, v: 66, deploy: false, faction: opponent.faction, order: "engage" },
    ],
    factions: [faction, opponent.faction], level: 0, autorun,
  });
}
