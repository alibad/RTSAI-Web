/**
 * Plain-word labels for every animation the Studio offers, one map for all units: sprite sequences (infantry,
 * buildings, sprite vehicles) and voxel cycles (rotors, propellers, radars). Client-safe and pure.
 */

/** Sequence name (without a damaged-/critical- prefix) to its label. */
export const SEQUENCE_LABELS: Record<string, string> = {
  stand: "Stand", stand2: "Stand (alt)", idle: "Idle", idle1: "Idle", idle2: "Idle 2", idle3: "Idle 3",
  run: "Walk", walk: "Walk", move: "Walk", shoot: "Fire", attack: "Fire", fire: "Fire", "fire-up": "Fire up",
  prone: "Prone", "prone-stand": "Prone", "prone-run": "Crawl", "prone-move": "Crawl", crawl: "Crawl",
  "prone-shoot": "Prone fire", "prone-attack": "Prone fire", liedown: "Lie down", standup: "Stand up",
  die: "Die", die1: "Die", die2: "Die (alt)", die3: "Die (3)", die4: "Die (4)", die5: "Die (5)", die6: "Die (6)",
  "die-twirling": "Die (twirl)", "die-flying": "Die (thrown)", "die-exploding": "Die (exploding)", "die-burning": "Die (burning)",
  "die-melting": "Die (melting)", "die-crushed": "Die (crushed)", parachute: "Parachute", cheer: "Cheer", wave: "Wave",
  deploy: "Deploy", undeploy: "Undeploy", "deployed-idle": "Deployed", make: "Build-up", active: "Active", build: "Building",
  takeoff: "Take off", land: "Land", turret: "Turret", barrel: "Barrel", radar: "Radar spin", rotor: "Rotor spin",
  "slow-rotor": "Rotor (slow)", prop: "Propeller", propeller: "Propeller", pusher: "Propeller", "idle-overlay": "Idle",
  "idle-landed": "Landed", "idle-still": "Still", "turret-still": "Turret still", "idle-airborne": "Flying",
};

const title = (name: string) => { const s = name.replace(/[-_]+/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

/** The label for a sequence name: the shared map, damaged variants prefixed, else the name in plain words. */
export function sequenceLabel(name: string): string {
  const m = /^(damaged|critical)-(.+)$/.exec(name);
  if (m) return `${m[1] === "damaged" ? "Damaged" : "Critical"} · ${sequenceLabel(m[2])}`;
  return SEQUENCE_LABELS[name] ?? title(name);
}

/** Makes repeated labels distinct ("Die", "Die (2)") without changing the first one. */
export function distinctLabels<T extends { label: string }>(list: T[]): T[] {
  const seen = new Map<string, number>();
  return list.map(item => {
    const n = (seen.get(item.label) ?? 0) + 1;
    seen.set(item.label, n);
    return n === 1 ? item : { ...item, label: `${item.label} (${n})` };
  });
}

export type SpinKind = "rotor" | "propeller" | "radar";
export const SPIN_LABELS: Record<SpinKind, string> = { rotor: "Rotor spin", propeller: "Propeller", radar: "Radar spin" };

/** What a spinning part is, from its sequence or section name ("main rotor", "pusher", "radar"). */
export function spinKind(name: string): SpinKind | null {
  const n = name.toLowerCase();
  if (/radar|dish|antenna/.test(n)) return "radar";
  if (/pusher|prop/.test(n)) return "propeller";
  if (/rotor/.test(n)) return "rotor";
  return null;
}

/** One label for a set of spinning parts: the most telling kind present, else `fallback`. */
export function spinLabel(kinds: (SpinKind | null | undefined)[], fallback = "Moving parts"): string {
  for (const kind of ["radar", "rotor", "propeller"] as const) if (kinds.includes(kind)) return SPIN_LABELS[kind];
  return fallback;
}
