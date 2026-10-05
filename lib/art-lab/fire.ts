/**
 * The Fire action of a vehicle, as the engine plays it (OpenRA Armament, WithSpriteTurret, WithVoxelBarrel,
 * WithMuzzleOverlay): on each shot the armament's Recoil jumps to its full value and falls by RecoilRecovery every
 * 40 ms tick; a sprite turret (Recoils) and a voxel barrel slide back by it along the turret's facing; the muzzle
 * sequence plays once at the barrel's LocalOffset. Barrels take turns, one per shot. Client-safe and pure.
 */
import type { Palette } from "./pal";
import type { Shp } from "./shp";
import { turretWorldFacing, type SpriteLayer, type SpriteRig } from "./sprite-compose";
import { quantizeFacing } from "./sprite-render";
import type { SpriteSequence, Vec3 } from "./types";
import { localToWorld, rotateYaw, screenVector } from "./voxel-math";

export type FireArmament = {
  name: string;
  /** The Turreted it is mounted on, or null for a hull weapon. */
  turret: string | null;
  localOffset: Vec3[];
  /** WDist. */
  recoil: number;
  /** WDist per tick. */
  recoilRecovery: number;
  muzzle: string | null;
  muzzlePalette: string;
};

/** An actor's firing rules, read from the game's merged rules (main mod, or the local preview copy). */
export type FireRules = {
  source: "main" | "preview";
  image: string;
  armaments: FireArmament[];
  /** WithMuzzleOverlay: muzzle sequences are drawn at all. */
  muzzleOverlay: boolean;
  /** WithSpriteTurret Recoils (default true). */
  spriteRecoils: boolean;
  /** WithVoxelBarrel: the barrel model recoils with this armament. */
  voxelBarrel: { armament: string; localOffset: Vec3 } | null;
  /** Turreted offsets by turret name. */
  turrets: Record<string, Vec3>;
  /** False in authored-only mode: muzzle flashes are original RA2 art, so a marked placeholder is drawn instead. */
  originals?: boolean;
};

export const FIRE_TICK_MS = 40;
/** The Fire action's id (distinct from sprite sequences named "fire"). */
export const FIRE_ACTION = "gunfire";

/** The Fire action a vehicle, ship or aircraft offers when its rules recoil or flash; none otherwise. */
export function fireActions(fire: FireRules | null | undefined): { id: string; label: string; body: null; note: string | null }[] {
  return firing(fire) ? [{ id: FIRE_ACTION, label: "Fire", body: null, note: fire!.originals === false ? "Muzzle flashes are original game art: the authored-only view shows a marked placeholder." : null }] : [];
}
/** Pause between preview shots, so each recoil and flash reads on its own. */
const FIRE_REST_MS = 400;

export const firing = (rules: FireRules | null | undefined) => Boolean(rules?.armaments.some(a => a.recoil > 0 || (rules.muzzleOverlay && a.muzzle)));

export type MuzzleArt = { shp: Shp; seq: SpriteSequence; placeholder: boolean };

const muzzleMs = (a: FireArmament, muzzles: Record<string, MuzzleArt | undefined>) => {
  const m = a.muzzle ? muzzles[a.muzzle] : undefined;
  if (!m) return 0;
  const length = m.seq.length === "*" ? Math.max(1, m.shp.frames.length - m.seq.start) : m.seq.length;
  return length * Math.max(1, m.seq.tick);
};

/** One preview shot every `period` ms (the longest recoil or flash, plus a short rest). */
export function firePeriod(rules: FireRules, muzzles: Record<string, MuzzleArt | undefined> = {}) {
  const longest = Math.max(0, ...rules.armaments.map(a => Math.max(a.recoilRecovery > 0 ? Math.ceil(a.recoil / a.recoilRecovery) * FIRE_TICK_MS : 0, muzzleMs(a, muzzles))));
  return Math.max(600, longest + FIRE_REST_MS);
}

export type ArmamentState = { name: string; recoil: number; barrel: number; muzzleFrame: number | null };

/** Each armament's recoil, firing barrel and muzzle frame `timeMs` into the looping Fire action. */
export function fireState(rules: FireRules, timeMs: number, muzzles: Record<string, MuzzleArt | undefined> = {}): ArmamentState[] {
  const period = firePeriod(rules, muzzles);
  const shot = Math.floor(Math.max(0, timeMs) / period), since = Math.max(0, timeMs) - shot * period;
  const ticks = Math.floor(since / FIRE_TICK_MS);
  return rules.armaments.map(a => {
    const m = a.muzzle ? muzzles[a.muzzle] : undefined;
    const length = m ? (m.seq.length === "*" ? Math.max(1, m.shp.frames.length - m.seq.start) : m.seq.length) : 0;
    const frame = m ? Math.floor(since / Math.max(1, m.seq.tick)) : -1;
    return {
      name: a.name,
      recoil: Math.max(0, a.recoil - a.recoilRecovery * ticks),
      barrel: a.localOffset.length ? shot % a.localOffset.length : 0,
      muzzleFrame: rules.muzzleOverlay && m && frame < length ? frame : null,
    };
  });
}

/** A stable key for the picture a fire state produces. */
export const fireKey = (states: ArmamentState[]) => states.map(s => `${s.name}:${s.recoil}:${s.barrel}:${s.muzzleFrame ?? "-"}`).join(";");

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const screen = (v: Vec3, fudge: boolean) => { const s = screenVector(localToWorld(v, fudge, 85)); return { dx: Math.round(s[0]), dy: Math.round(s[1]) }; };

/** WithSpriteTurret.TurretOffset's recoil part: the turret slides back along its world facing. */
export function recoilScreenOffset(recoil: number, turretWorldFacing: number, fudge = false) {
  return recoil ? screen(rotateYaw([-recoil, 0, 0], turretWorldFacing), fudge) : { dx: 0, dy: 0 };
}

/** Recoil of a voxel barrel (WithVoxelBarrel.BarrelOffset), as a world offset to add to the barrel's pivot. */
export function recoilWorldOffset(recoil: number, turretWorldFacing: number, fudge: boolean, cameraPitch: number): Vec3 {
  return recoil ? localToWorld(rotateYaw([-recoil, 0, 0], turretWorldFacing), fudge, cameraPitch) : [0, 0, 0];
}

/**
 * Armament.MuzzleOffset on screen: the barrel's LocalOffset (pushed back by the recoil) turned by the turret's world
 * facing, plus the turret's offset turned by the body's (quantised) facing; a hull weapon turns with the body.
 */
export function muzzleScreenOffset(a: FireArmament, barrel: number, recoil: number, bodyFacing: number, turretWorldFacing: number, turretOffset: Vec3 | null, fudge = false) {
  const local = add(a.localOffset[barrel] ?? [0, 0, 0], [-recoil, 0, 0]);
  const v = a.turret && turretOffset ? add(rotateYaw(local, turretWorldFacing), rotateYaw(turretOffset, bodyFacing)) : rotateYaw(local, bodyFacing);
  return screen(v, fudge);
}

/** Armament blocks from an install agent's rules JSON (meta.previewInstall.rules), over rules read from the mod. */
export function withInstalledArmaments(rules: FireRules, block: Record<string, unknown> | null | undefined): FireRules {
  if (!block) return rules;
  const vec = (s: unknown) => String(s ?? "").split(",").map(n => Number(n.trim())).filter(Number.isFinite);
  const offsets = (s: unknown): Vec3[] => { const n = vec(s), out: Vec3[] = []; for (let i = 0; i + 2 < n.length; i += 3) out.push([n[i], n[i + 1], n[i + 2]]); return out; };
  const wdist = (s: unknown) => { const t = String(s ?? "").trim(); if (!t) return null; const m = /^(-?\d+)c(\d+)$/.exec(t); return m ? Number(m[1]) * 1024 + Number(m[2]) : Number.isFinite(Number(t)) ? Number(t) : null; };
  const armaments = rules.armaments.map(a => ({ ...a, localOffset: [...a.localOffset] }));
  const turrets = { ...rules.turrets };
  for (const [key, value] of Object.entries(block)) {
    const fields = value && typeof value === "object" ? value as Record<string, unknown> : {};
    if (key.split("@")[0] === "Turreted") { const o = offsets(fields.Offset)[0]; if (o) turrets[String(fields.Turret ?? "primary")] = o; continue; }
    if (key.split("@")[0] !== "Armament") continue;
    const name = String(fields.Name ?? (key.includes("@") ? key.slice(key.indexOf("@") + 1) : "primary"));
    const a = armaments.find(x => x.name === name) ?? armaments[0];
    if (!a) continue;
    if (fields.LocalOffset !== undefined) a.localOffset = offsets(fields.LocalOffset);
    const r = wdist(fields.Recoil), rr = wdist(fields.RecoilRecovery);
    if (r !== null) a.recoil = r;
    if (rr !== null) a.recoilRecovery = rr;
    if (typeof fields.MuzzleSequence === "string") a.muzzle = fields.MuzzleSequence;
  }
  return { ...rules, armaments, turrets };
}

/**
 * A clearly marked authored stand-in for a muzzle flash that cannot be shown (original art not cached, or the
 * authored-only view): a magenta-ringed amber burst that shrinks over four frames, with its own tiny palette.
 */
export function placeholderMuzzle(): MuzzleArt & { palette: Uint8ClampedArray } {
  const size = 13, c = 6, frames = [6, 5, 3, 2];
  const palette = new Uint8ClampedArray(256 * 4);
  palette.set([255, 214, 90, 255], 4 * 1);
  palette.set([255, 140, 40, 255], 4 * 2);
  palette.set([232, 40, 220, 255], 4 * 3);
  const shp: Shp = {
    width: size, height: size,
    frames: frames.map(r => {
      const pixels = new Uint8Array(size * size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const d = Math.abs(x - c) + Math.abs(y - c);
        pixels[y * size + x] = d === r ? 3 : d < r ? (d < r / 2 ? 1 : 2) : 0;
      }
      return { x: 0, y: 0, width: size, height: size, compression: 0, radarColor: [0, 0, 0, 0], dataOffset: 0, pixels };
    }),
  };
  const seq: SpriteSequence = { name: "muzzle", file: null, external: null, start: 0, length: frames.length, stride: frames.length, facings: 1, reverseFacings: false, useClassicFacings: false, transpose: false, tick: 40, zOffset: 0, shadowStart: -1, offset: [0, 0, 0], frames: null, reverses: false, usedBy: ["WithMuzzleOverlay (authored placeholder)"], inherited: false };
  return { shp, seq, placeholder: true, palette };
}

/**
 * A sprite unit's Fire picture from its idle layers: turret-mounted layers (turret, riders, barrel) slide back by
 * their armaments' recoil when WithSpriteTurret recoils, and each muzzle flash is drawn on top at its barrel with
 * its own (effect) palette.
 */
export function fireLayers(layers: SpriteLayer[], rig: SpriteRig, fire: FireRules, states: ArmamentState[], art: Record<string, (MuzzleArt & { palette: Palette }) | undefined>, bodyFacing: number, turretFacing: number): SpriteLayer[] {
  const turretWorld = turretWorldFacing(rig, bodyFacing, turretFacing);
  const body = rig.body.facings > 1 ? quantizeFacing(bodyFacing, rig.quantizedFacings, rig.classicFacingBodyOrientation) : 0;
  const mounted = new Set<SpriteSequence | null | undefined>([rig.turret, ...(rig.turretSprites ?? []), rig.barrel?.seq].filter(Boolean));
  const recoil = fire.spriteRecoils ? states.reduce((sum, s, i) => sum + (fire.armaments[i]?.turret ? s.recoil : 0), 0) : 0;
  const back = recoilScreenOffset(recoil, turretWorld);
  const out = layers.map(l => (recoil && mounted.has(l.seq) ? { ...l, dx: (l.dx ?? 0) + back.dx, dy: (l.dy ?? 0) + back.dy } : l));
  states.forEach((s, i) => {
    const a = fire.armaments[i], m = a?.muzzle ? art[a.muzzle] : undefined;
    if (!a || !m || s.muzzleFrame === null) return;
    const at = muzzleScreenOffset(a, s.barrel, s.recoil, body, turretWorld, a.turret ? fire.turrets[a.turret] ?? rig.turretOffset ?? null : null);
    out.push({ shp: m.shp, seq: m.seq, facing: a.turret ? turretWorld : body, frame: s.muzzleFrame, dx: at.dx, dy: at.dy, palette: m.palette });
  });
  return out;
}

/** A voxel unit's muzzle flashes, to stamp over its rendered frame (the model itself recoils its barrel). */
export function voxelMuzzleLayers(fire: FireRules, states: ArmamentState[], art: Record<string, (MuzzleArt & { palette: Palette }) | undefined>, facing: number, turretFacing: number, fudge: boolean, liftPx = 0) {
  const turretWorld = (facing + turretFacing) & 1023;
  const out: (SpriteLayer & { palette: Palette })[] = [];
  states.forEach((s, i) => {
    const a = fire.armaments[i], m = a?.muzzle ? art[a.muzzle] : undefined;
    if (!a || !m || s.muzzleFrame === null) return;
    const at = muzzleScreenOffset(a, s.barrel, s.recoil, facing, turretWorld, a.turret ? fire.turrets[a.turret] ?? null : null, fudge);
    out.push({ shp: m.shp, seq: m.seq, facing: a.turret ? turretWorld : facing, frame: s.muzzleFrame, dx: at.dx, dy: at.dy - Math.round(liftPx), palette: m.palette });
  });
  return out;
}
