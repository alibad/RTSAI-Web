/**
 * The Attack demo's timeline: the unit turns to a training target placed at its weapon's real range, then fires at
 * the weapon's real cadence (reload and burst) until the target is destroyed or about nine seconds have passed. Every
 * shot's fire and impact time and the damage it does (the versus table against the target's armor) are planned up
 * front, so the stage only asks "what is happening at time t". Pure: no DOM.
 */
import { BURST_DELAY_TICKS, TICK_MS, shotDamage, volleyMs, type DemoWeapon, type ViewerDummy, type WeaponEffect } from "../../../../lib/weapon-demo";

/** OpenRA's RectangularIsometric projection: 1448 world units are 60 px across and 30 px down (one cell is 1024). */
export const PX_X = 60 / 1448;
export const PX_Y = 30 / 1448;
export const CELL = 1024;
/** Firing stops starting new volleys after this long (at least two volleys always play). */
const FIRE_WINDOW_MS = 9000;
/** The wreck stays this long before a fresh target takes its place. */
const WRECK_MS = 1700;
/** A target aircraft's height over its shadow, 1x pixels (about an RA2 cruise altitude). */
export const AIR_ALTITUDE = 46;

const wrap = (a: number) => ((a % 1024) + 1024) % 1024;
/** Signed shortest turn from `from` to `to`, -512..511. */
export const turnDelta = (from: number, to: number) => ((wrap(to - from) + 512) % 1024) - 512;
/** The world direction (X right, Y down) a facing points: 0 is north, counter-clockwise (256 west, 768 east). */
export function facingVector(facing: number): [number, number] {
  const a = (facing / 1024) * 2 * Math.PI;
  return [-Math.sin(a), -Math.cos(a)];
}
/** A world offset of `distance` along `facing`, in 1x screen pixels. */
export function screenOffset(facing: number, distance: number) {
  const [x, y] = facingVector(facing);
  return { x: x * distance * PX_X, y: y * distance * PX_Y };
}

export type Shot = {
  fire: number; impact: number; damage: number;
  /** The target was still standing when it landed (later shots in flight hit the wreck). */
  hit: boolean; kill: boolean;
  volley: number; index: number;
  /** Per-shot jitter for effects (0..1). */
  seed: number;
  /** Where it lands, 1x pixels from the target's aim point (a salvo spreads). */
  spread: { x: number; y: number };
};

export type UnitShape = {
  /** Turreted: only the turret turns to the target; otherwise the whole body does. */
  turreted: boolean;
  /** A building with a turret: its turret angle is absolute from InitialFacing. */
  defenceTurret: number | null;
  kind: "infantry" | "vehicle" | "aircraft" | "ship" | "building";
  /** The unit's own fire sequence (an infantry shot, a defence's turret fire), ms; 0 when it has none. */
  fireAnimMs: number;
  /** Its run cycle exists (the dog runs in before it leaps). */
  canRun: boolean;
};

export type AttackPlan = {
  weapon: DemoWeapon;
  dummy: ViewerDummy;
  effect: WeaponEffect;
  /** World facing from the unit to the target. */
  aim: number;
  /** World units between the unit and the target. */
  distance: number;
  /** The target's ground point, 1x pixels from the unit's. */
  target: { x: number; y: number };
  shape: UnitShape;
  startFacing: number;
  turnEnd: number;
  firstShot: number;
  shots: Shot[];
  deathAt: number | null;
  respawnAt: number | null;
  end: number;
  /** A melee attacker (the dog) runs in and leaps; positions are 1x pixels from its start. */
  lunge: { runStart: number; runEnd: number; jumpEnd: number; stop: { x: number; y: number }; land: { x: number; y: number } } | null;
};

const hash = (n: number) => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

/** How long a shot flies, ms, for a screen distance in 1x pixels. */
export function flightMs(effect: WeaponEffect, px: number): number {
  switch (effect) {
    case "tracer": case "laser": case "tesla": case "rad": case "beam": return 0;
    case "bullet": return Math.max(60, px / 1.1);
    case "shell": return Math.max(120, px / 0.65);
    case "artillery": return 800 + px * 1.3;
    case "flak": return Math.max(150, px / 0.7);
    case "missile": return 260 + px / 0.36;
    case "torpedo": return 300 + px / 0.16;
    case "lob": return 450 + px * 1.6;
    case "bomb": return 620;
    case "bite": return 0;
  }
}

/** A beam or bolt stays on screen this long. */
export const beamMs = (effect: WeaponEffect) => (effect === "tesla" ? 320 : effect === "rad" ? 420 : effect === "beam" ? 480 : effect === "laser" ? 260 : 0);

export function planAttack(args: { weapon: DemoWeapon; dummy: ViewerDummy; aim: number; startFacing: number; shape: UnitShape; muzzleToTarget?: number }): AttackPlan {
  const { weapon, dummy, aim, startFacing, shape } = args;
  const effect = weapon.effect;
  // The target stands at the weapon's real range (a bomber's target lies under it).
  const distance = Math.max(weapon.range, effect === "bomb" ? 0 : 0.6) * CELL;
  const target = screenOffset(aim, distance);
  const px = args.muzzleToTarget ?? Math.hypot(target.x, target.y);
  // Turning: a turret slews, a vehicle body turns more slowly, infantry snap round.
  const delta = shape.kind === "building" && !shape.turreted ? 0 : turnDelta(startFacing, aim);
  const rate = shape.turreted ? 700 : shape.kind === "infantry" ? 4096 : shape.kind === "aircraft" ? 600 : 420;
  const turnEnd = Math.round((Math.abs(delta) / rate) * 1000);

  let lunge: AttackPlan["lunge"] = null;
  let firstShot = turnEnd + 140;
  if (effect === "bite") {
    // Runs to within a cell, then leaps the rest of the way (RA2's dog); the bite lands with the leap.
    const runCells = Math.max(0, weapon.range - 1.1);
    const runStart = turnEnd + 60, runEnd = runStart + (shape.canRun ? Math.round((runCells / 2.9) * 1000) : 0);
    const stop = screenOffset(aim, runCells * CELL), land = screenOffset(aim, Math.max(0, distance - 0.35 * CELL));
    const jumpEnd = runEnd + Math.max(320, shape.fireAnimMs || 480);
    lunge = { runStart, runEnd, jumpEnd, stop: shape.canRun ? stop : { x: 0, y: 0 }, land };
    firstShot = runEnd;
  }

  const shots: Shot[] = [];
  const gap = BURST_DELAY_TICKS * TICK_MS, period = volleyMs(weapon);
  let hp = dummy.health, deathAt: number | null = null;
  const perShot = shotDamage(weapon, dummy.armor);
  for (let volley = 0; volley < 80; volley++) {
    const start = firstShot + volley * period;
    if (volley >= 2 && start - firstShot > FIRE_WINDOW_MS) break;
    if (deathAt !== null && start >= deathAt) break;
    for (let j = 0; j < weapon.burst; j++) {
      const fire = start + j * gap;
      if (deathAt !== null && fire >= deathAt) break;
      const seed = hash(shots.length * 7919 + volley * 31 + j);
      const flight = effect === "bite" ? lunge!.jumpEnd - fire : Math.round(flightMs(effect, px) * (0.94 + 0.12 * seed));
      const spreadR = weapon.burst > 2 && (effect === "missile" || effect === "artillery" || effect === "shell") ? 7 : effect === "artillery" || effect === "lob" ? 3 : 1.5;
      const spread = { x: (hash(seed * 1e6 + 1) - 0.5) * 2 * spreadR, y: (hash(seed * 1e6 + 2) - 0.5) * spreadR };
      const hit = deathAt === null;
      const damage = hit ? perShot : 0;
      let kill = false;
      if (hit && perShot > 0) { hp -= perShot; if (hp <= 0) { kill = true; deathAt = fire + flight; } }
      shots.push({ fire, impact: fire + flight, damage, hit, kill, volley, index: j, seed, spread });
    }
  }
  const lastImpact = Math.max(0, ...shots.map(s => s.impact + beamMs(effect)));
  const respawnAt = deathAt === null ? null : deathAt + WRECK_MS;
  const end = respawnAt !== null ? Math.max(respawnAt + 450, lastImpact + 300) : lastImpact + 1400;
  return { weapon, dummy, effect, aim, distance, target, shape, startFacing, turnEnd, firstShot, shots, deathAt, respawnAt, end, lunge };
}

/** The target's health at time t (it springs back with a fresh target after its wreck clears). */
export function healthAt(plan: AttackPlan, t: number) {
  if (plan.respawnAt !== null && t >= plan.respawnAt) return plan.dummy.health;
  let hp = plan.dummy.health;
  for (const s of plan.shots) if (s.hit && s.impact <= t) hp -= s.damage;
  return Math.max(0, hp);
}

export type UnitPose = {
  facing: number;
  /** Turret angle as the frame store takes it (relative to the body, or absolute for a defence). */
  turret: number;
  /** "fire" while a shot's sequence plays, "run" while the dog runs in, else "base". */
  action: "fire" | "run" | "base";
  /** Time into that action, ms. */
  actionMs: number;
  /** Where the unit stands, 1x pixels from its start (the dog moves). */
  offset: { x: number; y: number };
  /** World facing of the weapon (turret or body). */
  weaponFacing: number;
};

export function unitPoseAt(plan: AttackPlan, t: number): UnitPose {
  const { shape } = plan;
  const p = plan.turnEnd > 0 ? Math.min(1, Math.max(0, t / plan.turnEnd)) : 1;
  const ease = p < 1 ? p * p * (3 - 2 * p) : 1;
  const delta = shape.kind === "building" && !shape.turreted ? 0 : turnDelta(plan.startFacing, plan.aim);
  const weaponFacing = wrap(Math.round(plan.startFacing + delta * ease));
  const facing = shape.turreted ? plan.startFacing : weaponFacing;
  const turret = shape.turreted ? (shape.defenceTurret !== null ? wrap(weaponFacing - shape.defenceTurret) : wrap(weaponFacing - plan.startFacing)) : 0;
  let offset = { x: 0, y: 0 };
  let action: UnitPose["action"] = "base", actionMs = 0;
  const after = plan.respawnAt !== null && t >= plan.respawnAt;
  if (plan.lunge && !after) {
    const l = plan.lunge;
    if (t >= l.runStart && t < l.runEnd) { const k = (t - l.runStart) / Math.max(1, l.runEnd - l.runStart); offset = { x: l.stop.x * k, y: l.stop.y * k }; action = "run"; actionMs = t - l.runStart; }
    else if (t >= l.runEnd && t < l.jumpEnd) { const k = (t - l.runEnd) / Math.max(1, l.jumpEnd - l.runEnd); offset = { x: l.stop.x + (l.land.x - l.stop.x) * k, y: l.stop.y + (l.land.y - l.stop.y) * k }; action = "fire"; actionMs = t - l.runEnd; }
    else if (t >= l.jumpEnd) { offset = l.land; action = shape.fireAnimMs ? "fire" : "base"; actionMs = t - l.runEnd; }
    return { facing, turret, action, actionMs, offset, weaponFacing };
  }
  if (shape.fireAnimMs > 0) {
    let last: Shot | null = null;
    for (const s of plan.shots) { if (s.fire <= t) last = s; else break; }
    if (last && t - last.fire < shape.fireAnimMs) { action = "fire"; actionMs = t - last.fire; }
  }
  return { facing, turret, action, actionMs, offset, weaponFacing };
}

/** The demo's outcome in a few words: how fast it destroyed the target, or how much it did before stopping. */
export function resultLabel(plan: AttackPlan): string {
  const shots = plan.shots.filter(s => s.hit).length;
  if (plan.deathAt !== null) {
    const s = Math.max(0, plan.deathAt - (plan.lunge?.runStart ?? plan.firstShot)) / 1000;
    return shots === 1 && s < 0.1 ? "Destroyed in one hit" : `Destroyed in ${s.toFixed(1)} s · ${shots} ${shots === 1 ? "hit" : "hits"}`;
  }
  const done = plan.dummy.health - healthAt(plan, Number.POSITIVE_INFINITY);
  const span = (Math.max(...plan.shots.map(s => s.impact)) - plan.firstShot) / 1000;
  const perSecond = span > 0 ? done / span : done;
  const left = perSecond > 0 ? (plan.dummy.health - done) / perSecond : Infinity;
  return `${Math.round((100 * done) / plan.dummy.health)}% in ${span.toFixed(1)} s${Number.isFinite(left) ? ` · ~${Math.ceil(left + span)} s to destroy` : " · no effect"}`;
}
