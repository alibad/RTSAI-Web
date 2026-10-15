/**
 * The Faction viewer's Attack demo, as data: which of a unit's armaments it shows (what the unit fires on the map, plus
 * a switchable mode such as a deployed or anti-air one; never the elite or passenger-swapped variants), how each one
 * looks in flight, and the training targets it can engage with the damage the weapon's versus table gives against
 * their armor. Pure and client-safe: the server picks the weapons, the stage plays them.
 */

/** One game tick at normal speed (OpenRA RA2: 40 ms); reloads and burst delays are counted in ticks. */
export const TICK_MS = 40;
/** OpenRA's default WeaponInfo.BurstDelays (the rules export does not carry per-weapon delays). */
export const BURST_DELAY_TICKS = 5;

/** How a shot looks between the muzzle and the target. */
export type WeaponEffect =
  | "tracer" | "bullet" | "shell" | "artillery" | "flak" | "missile" | "torpedo" | "lob" | "bomb"
  | "laser" | "tesla" | "rad" | "beam" | "bite";

export type DummyKind = "infantry" | "vehicle" | "building" | "aircraft" | "ship" | "sub";
/** A training target: the health and armor of a real roster unit of its kind. */
export type ViewerDummy = { kind: DummyKind; name: string; health: number; armor: string };

export type DemoWeapon = {
  /** The weapon's rules name. */
  id: string;
  /** The weapon's name in plain words ("Qilin Gun"). */
  label: string;
  effect: WeaponEffect;
  /** Cells. */
  range: number;
  minRange: number;
  reloadTicks: number;
  burst: number;
  /** Damage per shot before armor. */
  damage: number;
  /** Percent of damage per armor type (missing types take 100%). */
  versus: Partial<Record<string, number>>;
  targets: string[];
  /** The condition that switches this armament on ("deployed", "aa-mode"), or null for the one it fires by default. */
  mode: string | null;
};

export type RulesWeapon = { id: string; range: number; minRange?: number; reload: number; burst?: number; targets: string[]; projectile: string; damage: number | null; versus: Partial<Record<string, number>>; condition: string | null };

/**
 * Whether a RequiresCondition expression holds with `granted` conditions on (every other one off). Supports ! && ||
 * and parentheses; a comparison (`ammo > 0`) counts as off.
 */
export function conditionHolds(expression: string | null | undefined, granted: ReadonlySet<string> = new Set()): boolean {
  if (!expression?.trim()) return true;
  const tokens = expression.match(/!|&&|\|\||\(|\)|[A-Za-z0-9_.-]+|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const or = (): boolean => { let v = and(); while (peek() === "||") { i++; const r = and(); v = v || r; } return v; };
  const and = (): boolean => { let v = not(); while (peek() === "&&") { i++; const r = not(); v = v && r; } return v; };
  const not = (): boolean => { if (peek() === "!") { i++; return !not(); } return atom(); };
  const atom = (): boolean => {
    const t = tokens[i++];
    if (t === "(") { const v = or(); if (peek() === ")") i++; return v; }
    if (t && /^[A-Za-z_]/.test(t) && !/^[<>=]/.test(peek() ?? "")) return granted.has(t);
    while (i < tokens.length && tokens[i] !== "&&" && tokens[i] !== "||" && tokens[i] !== ")") i++;
    return false;
  };
  return or();
}

const identifiers = (expression: string | null) => [...new Set((expression ?? "").match(/[A-Za-z_][A-Za-z0-9_.-]*/g) ?? [])];
/** Targets a damaging shot is aimed at (Repair, TeslaBoost or MindControl armaments are not attacks). */
const ATTACK_TARGETS = new Set(["Ground", "Water", "Air", "Infantry", "Vehicle", "Structure", "Underwater"]);
const MAX_WEAPONS = 4;

/** "R2QilinGun" -> "Qilin Gun"; "DogJaw" -> "Dog Jaw"; "M60" stays. */
export function weaponLabel(id: string): string {
  // `<Weapon>__sd_<hash>` is a Sound desk variant (RTSAI-Mod tools/apply-sound-decisions.py): the same weapon, its own sound.
  const bare = id.replace(/__sd_[0-9a-f]+$/, "").replace(/^R2(?=[A-Z])/, "");
  const words = bare.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/[_-]+/g, " ").trim() || id;
  return words[0].toUpperCase() + words.slice(1);
}

/** A mode's name in plain words ("aa-mode" -> "AA mode", "deployed" -> "Deployed"). */
export function modeLabel(mode: string): string {
  const words = mode.replace(/[_-]+/g, " ").trim().split(" ");
  return words.map((w, i) => (w.length <= 3 && /^[a-z]+$/.test(w) && w !== "on" ? w.toUpperCase() : i === 0 ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

export function weaponEffect(w: Pick<RulesWeapon, "id" | "projectile" | "targets" | "range"> & { minRange?: number }): WeaponEffect {
  const id = w.id.toLowerCase();
  const ground = w.targets.some(t => t === "Ground" || t === "Infantry" || t === "Vehicle" || t === "Structure");
  const air = w.targets.includes("Air") && !ground && !w.targets.includes("Water");
  const water = w.targets.length > 0 && w.targets.every(t => t === "Water" || t === "Underwater");
  if (/jaw|bite|claw/.test(id)) return "bite";
  switch (w.projectile) {
    case "ElectricBolt": return "tesla";
    case "RadBeam": return "rad";
    case "LaserZap": case "ArcLaserZap": return "laser";
    case "AreaBeam": return "beam";
    case "GravityBomb": return "bomb";
    case "Missile": return water || /torp/.test(id) ? "torpedo" : "missile";
    case "Bullet":
      if (water || /depth|asw/.test(id)) return "lob";
      if (air || /flak/.test(id)) return "flak";
      if (/ivan|bomb|terror|grenade|charge/.test(id)) return "lob";
      // Small arms fly flat and fast, whatever their reach (a sniper's 14 cells).
      if (/awp|snip|rifle|carbine|pistol|smg|mg$|m60|mp5|(^|[^0-9])20mm|coax|chaingun|vulcan|minigun/.test(id)) return "bullet";
      if ((w.minRange ?? 0) > 0 || w.range >= 9) return "artillery";
      return "shell";
    default:
      return water ? "torpedo" : "tracer";
  }
}

/**
 * The armaments the Attack demo offers: those the unit fires as it stands on the map (no condition, or one that holds
 * with every condition off), then one or two switchable modes (deployed, anti-air) when the unit has no more than two;
 * never elite variants or a dozen passenger-swapped ones. Only damaging attacks; one entry per weapon.
 */
export function demoWeapons(weapons: RulesWeapon[]): DemoWeapon[] {
  const attacks = weapons.filter(w => (w.damage ?? 0) > 0 && w.targets.some(t => ATTACK_TARGETS.has(t)));
  const defaults = attacks.filter(w => conditionHolds(w.condition));
  const alternates = new Map<RulesWeapon, string>();
  for (const w of attacks) {
    if (defaults.includes(w)) continue;
    const mode = identifiers(w.condition).find(c => c !== "rank-elite" && conditionHolds(w.condition, new Set([c])));
    if (mode) alternates.set(w, mode);
  }
  const modes = new Set(alternates.values());
  const chosen: [RulesWeapon, string | null][] = [...defaults.map(w => [w, null] as [RulesWeapon, null]), ...(modes.size <= 2 ? [...alternates] : [])];
  const seen = new Set<string>(), out: DemoWeapon[] = [];
  for (const [w, mode] of chosen) {
    const key = w.id.toLowerCase();
    if (seen.has(key) || out.length >= MAX_WEAPONS) continue;
    seen.add(key);
    out.push({
      id: w.id, label: weaponLabel(w.id), effect: weaponEffect(w), range: w.range, minRange: w.minRange ?? 0,
      reloadTicks: Math.max(1, w.reload), burst: Math.max(1, w.burst ?? 1), damage: w.damage ?? 0, versus: w.versus, targets: w.targets, mode,
    });
  }
  return out;
}

/** The roster unit each training target takes its health and armor from. */
export const DUMMY_ACTORS: Record<DummyKind, string> = { infantry: "e1", vehicle: "htnk", building: "gapile", aircraft: "orca", ship: "dest", sub: "sub" };
export const DUMMY_NAMES: Record<DummyKind, string> = { infantry: "Infantry", vehicle: "Tank", building: "Building", aircraft: "Aircraft", ship: "Ship", sub: "Submarine" };
/** What each target counts as for a weapon's ValidTargets. */
const DUMMY_TARGETS: Record<DummyKind, string[]> = { infantry: ["Ground", "Infantry"], vehicle: ["Ground", "Vehicle"], building: ["Ground", "Structure"], aircraft: ["Air"], ship: ["Ground", "Water"], sub: ["Underwater"] };
const DUMMY_ORDER: DummyKind[] = ["infantry", "vehicle", "building", "aircraft", "ship", "sub"];

/** Damage one shot does to `armor` (the weapon's versus table; types it does not list take full damage). */
export const shotDamage = (w: Pick<DemoWeapon, "damage" | "versus">, armor: string) => Math.round((w.damage * (w.versus[armor] ?? 100)) / 100);

/** On a tie, a unit faces its own kind first: infantry duel infantry, armor meets armor, ships meet ships. */
const PEERS: Record<string, DummyKind> = { infantry: "infantry", vehicle: "vehicle", aircraft: "vehicle", ship: "ship", defense: "vehicle", structure: "vehicle" };

/**
 * The training targets a weapon can engage, the one it hurts most first (ties go to the unit's own kind, then build-tab
 * order; a warship faces a ship first). A ship stands in only when the unit is naval or the weapon reaches nothing on
 * land.
 */
export function dummyTargets(w: Pick<DemoWeapon, "targets" | "damage" | "versus">, dummies: ViewerDummy[], unitCategory: string): ViewerDummy[] {
  const can = (d: ViewerDummy) => DUMMY_TARGETS[d.kind].some(t => w.targets.includes(t));
  const land = dummies.some(d => can(d) && (d.kind === "infantry" || d.kind === "vehicle" || d.kind === "building"));
  const offered = dummies.filter(d => can(d) && (d.kind !== "ship" || unitCategory === "ship" || !land));
  const rank = (d: ViewerDummy) => (d.kind === PEERS[unitCategory] ? -1 : DUMMY_ORDER.indexOf(d.kind));
  // A warship's gun reaches the shore too, but it is shown against another ship first.
  const naval = (d: ViewerDummy) => (unitCategory === "ship" && d.kind === "ship" ? 0 : 1);
  return offered.sort((a, b) => naval(a) - naval(b) || shotDamage(w, b.armor) - shotDamage(w, a.armor) || rank(a) - rank(b));
}

/** Milliseconds from the first shot of one volley to the first shot of the next. */
export const volleyMs = (w: Pick<DemoWeapon, "reloadTicks" | "burst">) => (w.burst - 1) * BURST_DELAY_TICKS * TICK_MS + w.reloadTicks * TICK_MS;
