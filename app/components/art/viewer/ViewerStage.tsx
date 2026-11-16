"use client";

import { Crosshair, Minus, Pause, Play, Plus, Radar, RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clampZoom, dragFacing, FACING_STEP, fitZoom } from "../../../../lib/art-lab/review-ui";
import { spriteAnimations } from "../../../../lib/art-lab/sprite-anim";
import { voxelAnimationParts, voxelCycleLabel } from "../../../../lib/art-lab/voxel-animation";
import { houseColors } from "../../../../lib/art-lab/remap";
import { facingLabel } from "../../../../lib/art-lab/voxel-math";
import { dummyTargets, modeLabel, shotDamage, volleyMs, type DemoWeapon, type DummyKind, type ViewerDummy } from "../../../../lib/weapon-demo";
import { frameRadius, type Frame, type FrameStore, type Pose, type StageItem } from "../review/frames";
import { groundFor, groundPath, groundTile, groundWidth } from "../review/ground";
import { soundEngine } from "../review/sound";
import { AIR_ALTITUDE, CELL, PX_X, PX_Y, duelLabel, facingVector, holdFire, planAttack, settleDuel, unitPoseAt, type AttackPlan, type Shot, type UnitShape } from "./attack";
import { aimPoint, arcHeight, blit, drawDamage, drawDeath, drawHealth, drawRangeRing, drawReload, drawResult, drawShots, drawTarget, dummyHeight, type FxView } from "./attack-draw";
import { EffectGlyph, TargetGlyph } from "./attack-icons";
import { SearchSelect } from "../../ui/fields";

const DEFAULT_FACING = 896;
const SPIN_MS = 110;
const MAX_ZOOM = 6;
/** Actions that play once and hold their last frame (the game never loops them). */
const ONE_SHOT = /(^die|^make$|deploy|takeoff|^land$|^liedown$|^standup$)/;
/** Directions the Attack demo may place its target in, most natural first (north-east is the default view). */
const AIM_CANDIDATES = [896, 928, 864, 960, 832, 992, 800];

export type ViewerAction = { id: string; label: string };
/** What the unit can do on the stage: its sprite sequences, or the voxel model's own cycle (rotors, radars). */
export function actionsFor(item: StageItem): ViewerAction[] {
  if (item.spec.voxel) return voxelAnimationParts(item.spec).length ? [{ id: "body", label: voxelCycleLabel(item.spec) }] : [];
  return spriteAnimations(item.sprite).map(a => ({ id: a.id, label: a.label }));
}
const turns = (item: StageItem) => Boolean(item.spec.voxel) || Boolean(item.sprite?.sequences.some(s => Math.abs(s.facings) > 1));

/** A sprite's ground shadow while it flies: its silhouette in the shadow colour, cached per frame. */
const silhouettes = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function silhouette(canvas: HTMLCanvasElement) {
  let s = silhouettes.get(canvas);
  if (!s) {
    s = document.createElement("canvas"); s.width = canvas.width; s.height = canvas.height;
    const c = s.getContext("2d")!;
    c.drawImage(canvas, 0, 0); c.globalCompositeOperation = "source-in"; c.fillStyle = "rgba(0, 0, 0, 0.55)"; c.fillRect(0, 0, s.width, s.height);
    silhouettes.set(canvas, s);
  }
  return s;
}
type Picture = { canvas: HTMLCanvasElement; width: number; height: number; anchorX: number; anchorY: number };
/** Device pixels per game pixel: whole pixels at 1x and up; a fraction only when a long range needs the stage zoomed out. */
const scaleFor = (zoom: number, dpr: number) => (zoom >= 1 ? Math.max(1, Math.round(zoom * dpr)) : zoom * dpr);
/** Draws a 1x picture with its anchor at CSS point (cx, cy), whole device pixels per game pixel. */
function put(ctx: CanvasRenderingContext2D, dpr: number, p: Picture, cx: number, cy: number, zoom: number) {
  const z = scaleFor(zoom, dpr);
  ctx.drawImage(p.canvas, Math.round(cx * dpr) - p.anchorX * z, Math.round(cy * dpr) - p.anchorY * z, p.width * z, p.height * z);
}

/** What the demo's scene covers, 1x pixels from the unit's ground point: the unit, the target with its health bar, and
 *  the top of a lobbed shot's arc. */
function sceneBox(plan: AttackPlan, r: number, lift: number) {
  const kind = plan.dummy.kind, t = plan.target;
  const top = t.y - (kind === "aircraft" ? AIR_ALTITUDE : 0) - dummyHeight[kind] - 12;
  const aim = aimPoint(plan, 0), muzzle = { x: 0, y: -r * 0.4 - lift };
  const peak = (muzzle.y + aim.y) / 2 - arcHeight(plan, muzzle, aim) - 4;
  return { minX: Math.min(-r, t.x - 34), maxX: Math.max(r, t.x + 34), minY: Math.min(-r - lift, top, peak), maxY: Math.max(r * 0.6, t.y + 14) };
}
/** The zoom (possibly under 1) at which the scene fits the stage, leaving room for the name, picks and result. */
function sceneFit(plan: AttackPlan, r: number, lift: number, size: { width: number; height: number }) {
  const b = sceneBox(plan, r, lift);
  return Math.min(Math.max(1, size.width - 96) / (b.maxX - b.minX), Math.max(1, size.height - 150) / (b.maxY - b.minY));
}

/** "r,g,b" of a CSS colour (#rgb or #rrggbb); the site gold when it cannot be read. */
function rgbOf(color: string) {
  const hex = color.trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.split("").map(c => c + c).join("") : hex;
  return /^[0-9a-f]{6}$/i.test(full) ? [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)).join(",") : "241,210,139";
}

/** The Attack demo's pick: a weapon (by index) and the training target it fires at. */
type AttackPick = { weapon: number; target: DummyKind };
type AttackState = AttackPick & { plan: AttackPlan; versus?: number };
export type AttackSounds = (weaponId: string) => { report: string[]; impact: string[] };
/** A unit the stage can fight in Versus: its art, armaments, health and armour, and its weapon sounds. */
export type Opponent = { id: string; name: string; group?: string; item: StageItem; weapons: DemoWeapon[]; health: number; armor: string; sounds?: AttackSounds;
  /** Its list picture (a cameo), shown in the Versus picker. */
  cameo?: string | null };
/** What the stage needs to know to move a unit: its actions by kind, its attack shape and its flying height (1x px). */
type Described = { first: string; fireA: string | null; runA: string | null; dieA: string | null; shape: UnitShape; lift: number };
type Geo = { reach: number; height: number };
/** The opponent's side of a duel: its plan (it firing at the unit), sound clock, gun geometry and last frames drawn. */
type DuelSide = { opp: Opponent; plan: AttackPlan; t: number; fired: number; landed: number; lastReport: number; geo: Geo; color: string; me: Described; them: Described; frames: [Frame | null, Frame | null] };

const dummyKindOf = (category: string): DummyKind =>
  category === "infantry" ? "infantry" : category === "aircraft" ? "aircraft" : category === "ship" ? "ship" : category === "structure" || category === "defense" ? "building" : "vehicle";
/** The armament that hurts a target most per second; null when none can reach it. */
function bestWeapon(weapons: DemoWeapon[], target: ViewerDummy, category: string): DemoWeapon | null {
  const dps = (w: DemoWeapon) => (shotDamage(w, target.armor) * w.burst) / volleyMs(w);
  return weapons.filter(w => dummyTargets(w, [target], category).length).sort((a, b) => dps(b) - dps(a))[0] ?? null;
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * The player's stage: the unit as the game draws it, on its ground, pixel-exact at a whole zoom. Drag (or the arrow
 * keys) turns it, the wheel zooms, Space spins; actions play the game's own sequences. Attack places a training target
 * at the weapon's real range and fires at it at the weapon's real cadence; Range draws the weapons' reach on the
 * ground at true scale. Draws only when something changes; nothing loops while it is still.
 */
export function ViewerStage({ frames, item, color, onColor, tag, children, onAction, weapons = [], dummies = [], sounds, fire = null, self = null, opponents = [] }: {
  frames: FrameStore; item: StageItem; color: string; onColor: (hex: string) => void;
  /** Called when the player starts an action (its sound plays with it). */
  onAction?: (id: string) => void;
  /** A label over the art (admin History shows earlier versions here, never as current). */
  tag?: React.ReactNode;
  children?: React.ReactNode;
  /** The armaments the Attack demo offers (none: no Attack control). */
  weapons?: DemoWeapon[];
  /** The training targets (health and armor of real roster units). */
  dummies?: ViewerDummy[];
  /** A weapon's report and impact clips, played with each shot and hit. */
  sounds?: AttackSounds;
  /** Fires one weapon in the Attack demo now (each new `n`), as if its button were pressed. */
  fire?: { weapon: string; n: number } | null;
  /** The unit's own health and armour (rules): with `opponents`, the stage offers Versus. */
  self?: { health: number; armor: string } | null;
  /** Units it can fight in Versus: both fire their best armament at each other until one falls. */
  opponents?: Opponent[];
}) {
  const actions = useMemo(() => actionsFor(item), [item]);
  const firstAction = actions[0]?.id ?? "stand";
  const fireAction = actions.find(a => a.id === "attack")?.id ?? actions.find(a => a.label === "Fire")?.id ?? null;
  const runAction = actions.find(a => a.id === "move")?.id ?? null;
  const [animation, setAnimation] = useState(firstAction);
  const [playing, setPlaying] = useState(false);
  const [spin, setSpin] = useState(false);
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  const [radius, setRadius] = useState<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** The Attack demo: on while its scene shows; `running` while it plays. */
  const [attack, setAttack] = useState<AttackState | null>(null);
  const [running, setRunning] = useState(false);
  const [rings, setRings] = useState(false);
  // Versus: a searchable list of every unit it can fight, each with its picture (hundreds in the Concept Forge).
  const versusOptions = useMemo(() => [{ value: -1, label: "Versus…" }, ...opponents.map((o, i) => ({
    value: i, label: o.name, group: o.group,
    // eslint-disable-next-line @next/next/no-img-element -- a game cameo, pixel art
    leading: o.cameo ? <img className="viewer-versus-cameo" src={o.cameo} alt="" loading="lazy" /> : <span className="viewer-versus-cameo" aria-hidden="true" />,
  }))], [opponents]);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ facing: DEFAULT_FACING, time: 0 });
  /** The planned demo and how far into it the stage is (ms); the last frame drawn stands in while a new one renders. */
  const demo = useRef<{ plan: AttackPlan; t: number; startedAt: number; fired: number; landed: number; lastReport: number; reach: number; height: number; accent: string; duel?: DuelSide } | null>(null);
  const lastFrame = useRef<Frame | null>(null);
  /** The facing as screen readers hear it (the drawing reads view.current, so dragging never re-renders). */
  const [facing, setFacing] = useState(DEFAULT_FACING);
  const airborne = item.spec.category === "aircraft";
  // A new unit starts on its first action, still, with the zoom refitted. The stage itself stays mounted: on a
  // software GPU a fresh canvas layer per unit costs a frame of 150-200 ms to composite.
  const [shown, setShown] = useState(item);
  if (shown !== item) {
    setShown(item); setAnimation(firstAction); setPlaying(false); setSpin(false); setZoomOverride(null); setRadius(null);
    setAttack(null); setRunning(false); setRings(false);
  }
  useEffect(() => { view.current.time = 0; demo.current = null; lastFrame.current = null; }, [item]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize(s => (s.width === Math.round(r.width) && s.height === Math.round(r.height) ? s : { width: Math.round(r.width), height: Math.round(r.height) }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const poseOf = (it: StageItem, facing: number, time: number, action: string, turret = 0, loop = !ONE_SHOT.test(action), tint: readonly number[] = [1, 1, 1], col = color): Pose => ({
    facing, turret, tick: 0, timeMs: time, loop, animation: action, color: col, shadow: true, tint, airborne: it.spec.category === "aircraft",
  });
  const pose = (facing: number, time: number, action = animation, turret = 0, loop = !ONE_SHOT.test(action)): Pose => poseOf(item, facing, time, action, turret, loop);
  /** A unit's actions by kind, its attack shape and its flying height. */
  const describe = (it: StageItem): Described => {
    const acts = actionsFor(it);
    const fireA = acts.find(a => a.id === "attack")?.id ?? acts.find(a => a.label === "Fire")?.id ?? null;
    const runA = acts.find(a => a.id === "move")?.id ?? null;
    const voxel = it.spec.voxel;
    const turreted = voxel ? voxel.parts.some(p => /Turret/.test(p.trait)) : Boolean(it.sprite?.turret);
    const building = it.spec.category === "structure" || it.spec.category === "defense";
    const defenceTurret = building && turreted && !voxel ? it.sprite?.turret?.initialFacing ?? 0 : null;
    const kind: UnitShape["kind"] = it.spec.category === "infantry" ? "infantry" : building ? "building" : it.spec.category === "aircraft" ? "aircraft" : it.spec.category === "ship" ? "ship" : "vehicle";
    const fireAnimMs = fireA ? frames.animationInfo(it, fireA)?.durationMs ?? 400 : 0;
    const up = it.spec.category === "aircraft" && !voxel && it.spec.airAltitude ? (30 * it.spec.airAltitude) / 1448 : 0;
    return { first: acts[0]?.id ?? "stand", fireA, runA, dieA: acts.find(a => a.id === "die")?.id ?? null, shape: { turreted, defenceTurret, kind, fireAnimMs, canRun: Boolean(runA) }, lift: up };
  };
  /** Gun height and reach from the art: infantry hold their weapons at chest height; vehicles fire from the turret. */
  const geoFor = (it: StageItem, d: Described, facing: number): Geo => {
    const f = frames.get(it, poseOf(it, facing, 0, d.first));
    const height = f ? -f.top : 20, half = f ? Math.max(f.right, -f.left) : 20, kind = d.shape.kind;
    return kind === "infantry" ? { reach: 5, height: Math.round(height * 0.55) } : kind === "building" ? { reach: Math.round(half * 0.3), height: Math.round(height * 0.62) }
      : kind === "aircraft" ? { reach: Math.round(half * 0.3), height: it.spec.voxel ? Math.round(-((f?.top ?? -20) + (f?.bottom ?? 0)) / 2) : Math.round(height * 0.4) }
      : { reach: Math.round(half * 0.55), height: Math.round(height * 0.5) };
  };
  // A sprite aircraft flies this many 1x pixels above its shadow (OpenRA: 1448 world units per 30 px); a voxel
  // aircraft's frame already holds its altitude.
  const lift = airborne && !item.spec.voxel && item.spec.airAltitude ? (30 * item.spec.airAltitude) / 1448 : 0;

  const weapon = attack ? weapons[attack.weapon] ?? null : null;
  const targets = useMemo(() => (weapon ? dummyTargets(weapon, dummies, item.spec.category) : []), [weapon, dummies, item.spec.category]);
  const ringWeapons = useMemo(() => (weapon ? [weapon] : weapons).filter((w, i, all) => all.findIndex(x => x.range === w.range) === i).slice(0, 3), [weapon, weapons]);

  /** Where the demo's scene sits: the zoom that fits the unit and its target, and the unit's ground point (CSS px). */
  const attackLayout = (plan: AttackPlan) => {
    const { minX, maxX, minY, maxY } = sceneBox(plan, radius ?? 24, lift);
    const fit = sceneFit(plan, radius ?? 24, lift, size);
    const zoom = zoomOverride ?? (fit >= 1 ? Math.min(MAX_ZOOM, Math.floor(fit)) : 1 / Math.ceil(1 / fit));
    return { zoom, cx: size.width / 2 - (zoom * (minX + maxX)) / 2, cy: (size.height + 40) / 2 - (zoom * (minY + maxY)) / 2 };
  };
  const ringZoom = () => {
    const far = Math.max(0, ...ringWeapons.map(w => w.range)) * CELL;
    const fit = Math.min((size.width * 0.9) / (2 * far * PX_X + 40), (size.height * 0.84) / (2 * far * PX_Y + 40));
    return fit >= 1 ? Math.min(MAX_ZOOM, Math.floor(fit)) : 1 / Math.ceil(1 / fit);
  };
  const zoom = zoomOverride ?? (attack ? attackLayout(attack.plan).zoom : rings && weapons.length ? ringZoom() : radius ? fitZoom(radius, size.width, size.height, MAX_ZOOM, 0.72) : 2);

  /** The faction accent for rings and the reload bar, read once per scene (a style read per frame costs a recalc). */
  const accentRef = useRef<string | null>(null);
  const accent = () => (accentRef.current ??= rgbOf(boxRef.current ? getComputedStyle(boxRef.current).getPropertyValue("--accent") : ""));

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(size.width * dpr)), h = Math.max(1, Math.round(size.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h); ctx.imageSmoothingEnabled = false;
    const d = demo.current;
    if (attack && d) { if (d.duel) drawDuel(ctx, dpr, d, d.duel); else drawScene(ctx, dpr, d); return; }
    const f = frames.get(item, pose(view.current.facing, view.current.time));
    const up = f ? lift : 0;
    const cx = size.width / 2, cy = Math.round(size.height * (rings ? 0.5 : 0.56) + (up * zoom) / 2);
    put(ctx, dpr, groundTile(groundFor(item.spec.category, "sand"), [1, 1, 1], groundWidth(radius)), cx, cy, zoom);
    if (rings && weapons.length) {
      const v: FxView = { ctx, z: scaleFor(zoom, dpr), ax: Math.round(cx * dpr), ay: Math.round(cy * dpr), calm: true, dpr, width: w, height: h };
      const rgb = accent();
      ringWeapons.forEach((wpn, i) => {
        drawRangeRing(v, { x: 0, y: 0 }, wpn.range, rgb, `${trimCells(wpn.range)}${i === 0 ? " cells" : ""}`);
        if (wpn.minRange > 0) drawRangeRing(v, { x: 0, y: 0 }, wpn.minRange, "255,120,96", null, true);
      });
    }
    if (!f) return;
    if (up) { put(ctx, dpr, { ...f, canvas: silhouette(f.canvas) }, cx, cy, zoom); put(ctx, dpr, f, cx, cy - up * zoom, zoom); }
    else put(ctx, dpr, f, cx, cy, zoom);
  };

  /** The Attack demo at its current time: ground to the target, rings, target, unit, shots, then the health bar. */
  const drawScene = (ctx: CanvasRenderingContext2D, dpr: number, d: NonNullable<typeof demo.current>) => {
    const { plan, t } = d;
    const layout = attackLayout(plan);
    const v: FxView = {
      ctx, z: scaleFor(layout.zoom, dpr), ax: Math.round(layout.cx * dpr), ay: Math.round(layout.cy * dpr),
      calm: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches, dpr, width: ctx.canvas.width, height: ctx.canvas.height,
    };
    // The ground between them shows the cells to scale: water under ships, sand on land (a shore where they meet).
    const unitWater = item.spec.category === "ship", targetWater = plan.dummy.kind === "ship" || plan.dummy.kind === "sub";
    blit(v, groundPath(unitWater ? "water" : "sand", [1, 1, 1], plan.target.x, plan.target.y, Math.max(26, Math.round((radius ?? 24) * 1.5))), { x: 0, y: 0 });
    if (unitWater !== targetWater) blit(v, groundTile(targetWater ? "water" : "sand", [1, 1, 1], 120), plan.target);
    const rgb = d.accent;
    if (rings) {
      drawRangeRing(v, { x: 0, y: 0 }, plan.weapon.range, rgb, `${trimCells(plan.weapon.range)} cells`);
      if (plan.weapon.minRange > 0) drawRangeRing(v, { x: 0, y: 0 }, plan.weapon.minRange, "255,120,96", null, true);
    }
    const up = unitPoseAt(plan, t);
    const action = up.action === "fire" && fireAction ? fireAction : up.action === "run" && runAction ? runAction : firstAction;
    const voxelTurret = item.spec.voxel ? Math.round(up.turret / 16) * 16 & 1023 : up.turret;
    const f = frames.get(item, pose(up.facing, up.action === "base" ? 0 : up.actionMs, action, voxelTurret, up.action === "run")) ?? lastFrame.current;
    if (f) lastFrame.current = f;
    // Recoil: a gun's shot kicks the unit back a pixel for a few frames.
    const last = plan.shots.filter(s => s.fire <= t).pop();
    const kickOn = last && t - last.fire < 90 && (plan.effect === "shell" || plan.effect === "artillery") && item.spec.category !== "infantry";
    const back = facingVector(up.weaponFacing);
    const at = { x: up.offset.x - (kickOn ? Math.sign(back[0]) : 0), y: up.offset.y - (kickOn ? Math.sign(back[1]) : 0) };
    const targetInFront = plan.target.y > at.y + 2;
    if (!targetInFront) drawTarget(v, plan, t);
    if (f) {
      if (lift) { blit(v, { ...f, canvas: silhouette(f.canvas) }, at); blit(v, f, { x: at.x, y: at.y - lift }); }
      else blit(v, f, at);
    }
    if (targetInFront) drawTarget(v, plan, t);
    drawDeath(v, plan, t);
    drawShots(v, plan, t, { muzzle: s => muzzleAt(plan, s, d), weaponFacing: s => unitPoseAt(plan, s.fire).weaponFacing });
    drawHealth(v, plan, t);
    if (!v.calm || t >= plan.end) drawDamage(v, plan, t);
    drawReload(v, plan, t, at, `rgb(${rgb})`);
    drawResult(v, plan, t);
  };

  /** Where a shot leaves the unit: ahead along its weapon's facing and up at its gun height (estimated from the art). */
  const muzzleAt = (plan: AttackPlan, s: Shot, d: { reach: number; height: number }, up = lift) => {
    const p = unitPoseAt(plan, s.fire);
    const [fx, fy] = facingVector(p.weaponFacing), sx = fx * 60, sy = fy * 30, n = Math.hypot(sx, sy) || 1;
    if (plan.effect === "bomb") return { x: p.offset.x, y: p.offset.y - up - d.height * 0.4 };
    return { x: p.offset.x + (sx / n) * d.reach, y: p.offset.y + (sy / n) * d.reach - d.height - up };
  };

  /**
   * Versus at its current time: both units on one ground, each drawn with its own art and player colour, firing its
   * plan at the other. The opponent's plan is drawn from the opponent's ground point, so its shots, the unit's health
   * bar, damage and death come from the same helpers as the Attack demo. A fallen soldier plays its death; a fallen
   * vehicle stays as a burnt hull; a fallen aircraft drops.
   */
  const drawDuel = (ctx: CanvasRenderingContext2D, dpr: number, d: NonNullable<typeof demo.current>, side: DuelSide) => {
    const { plan, t } = d, theirs = side.plan;
    const layout = attackLayout(plan);
    const v: FxView = {
      ctx, z: scaleFor(layout.zoom, dpr), ax: Math.round(layout.cx * dpr), ay: Math.round(layout.cy * dpr),
      calm: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches, dpr, width: ctx.canvas.width, height: ctx.canvas.height,
    };
    const vB: FxView = { ...v, ax: v.ax + Math.round(plan.target.x) * v.z, ay: v.ay + Math.round(plan.target.y) * v.z };
    blit(v, groundPath("sand", [1, 1, 1], plan.target.x, plan.target.y, Math.max(26, Math.round((radius ?? 24) * 1.5))), { x: 0, y: 0 });
    if (rings) drawRangeRing(v, { x: 0, y: 0 }, plan.weapon.range, d.accent, `${trimCells(plan.weapon.range)} cells`);
    const drawUnit = (b: 0 | 1) => {
      const it = b ? side.opp.item : item, own = b ? theirs : plan, killer = b ? plan : theirs, desc = b ? side.them : side.me;
      const dead = killer.deathAt !== null && t >= killer.deathAt;
      const up = unitPoseAt(own, dead ? killer.deathAt! : t);
      let action = up.action === "fire" && desc.fireA ? desc.fireA : up.action === "run" && desc.runA ? desc.runA : desc.first;
      let time = up.action === "base" ? 0 : up.actionMs, loop = up.action === "run", tint: readonly number[] = [1, 1, 1];
      if (dead) { if (desc.dieA) { action = desc.dieA; time = t - killer.deathAt!; loop = false; } else tint = [0.34, 0.31, 0.28]; }
      const turret = it.spec.voxel ? Math.round(up.turret / 16) * 16 & 1023 : up.turret;
      const f = frames.get(it, poseOf(it, up.facing, time, action, turret, loop, tint, b ? side.color : color)) ?? side.frames[b];
      if (f) side.frames[b] = f;
      const at = b ? plan.target : { x: up.offset.x, y: up.offset.y };
      const lifted = dead && desc.lift ? desc.lift * (1 - clamp01((t - killer.deathAt!) / 650) ** 2) : desc.lift;
      if (!f) return;
      if (lifted) { blit(v, { ...f, canvas: silhouette(f.canvas) }, at); blit(v, f, { x: at.x, y: at.y - lifted }); } else blit(v, f, at);
    };
    // Back to front: whoever stands further up the screen first.
    if (plan.target.y < 0) { drawUnit(1); drawUnit(0); } else { drawUnit(0); drawUnit(1); }
    drawDeath(v, plan, t); drawDeath(vB, theirs, t);
    drawShots(v, plan, t, { muzzle: s => muzzleAt(plan, s, d), weaponFacing: s => unitPoseAt(plan, s.fire).weaponFacing });
    drawShots(vB, theirs, t, { muzzle: s => muzzleAt(theirs, s, side.geo, side.them.lift), weaponFacing: s => unitPoseAt(theirs, s.fire).weaponFacing });
    drawHealth(v, plan, t); drawHealth(vB, theirs, t);
    if (!v.calm || t >= plan.end) { drawDamage(v, plan, t); drawDamage(vB, theirs, t); }
    drawReload(v, plan, t, { x: 0, y: 0 }, `rgb(${d.accent})`);
    drawResult(v, { ...plan, deathAt: plan.deathAt ?? theirs.deathAt }, t, duelLabel(plan, theirs, [item.spec.name, side.opp.name]));
  };

  const drawRef = useRef(draw);
  const soundsRef = useRef(sounds);
  useLayoutEffect(() => { drawRef.current = draw; soundsRef.current = sounds; });
  const pending = useRef(0);
  const schedule = useMemo(() => () => {
    if (pending.current) return;
    pending.current = requestAnimationFrame(() => { pending.current = 0; drawRef.current(); });
  }, []);
  useEffect(() => () => cancelAnimationFrame(pending.current), []);
  useEffect(() => { schedule(); }, [schedule, item, color, animation, zoom, size, radius, attack, rings]);
  useEffect(() => frames.subscribe(() => schedule()), [frames, schedule]);

  // The fit follows the unit's turning circle at the default facing, once its first frame exists.
  useEffect(() => {
    const check = () => {
      const f = frames.get(item, pose(DEFAULT_FACING, 0, firstAction));
      if (f) setRadius(r => r ?? Math.max(8, Math.ceil(frameRadius(f))));
    };
    check();
    return frames.subscribe(check);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refit only for a new unit or colour
  }, [frames, item, firstAction]);

  // Playback and spin advance the view on animation frames; one-shot actions stop on their last frame. The Attack
  // demo advances its own clock and plays each shot's report and impact as it happens.
  useEffect(() => {
    if (!playing && !spin && !running) return;
    let last = performance.now(), spinAt = last, raf = 0;
    const duration = frames.animationInfo(item, animation)?.durationMs ?? 0;
    const tick = (now: number) => {
      const dt = now - last; last = now;
      if (playing) {
        view.current.time += dt;
        if (ONE_SHOT.test(animation) && duration && view.current.time >= duration) { view.current.time = duration; setPlaying(false); }
      }
      if (spin && now - spinAt >= SPIN_MS) { spinAt = now; view.current.facing = (view.current.facing - FACING_STEP + 1024) % 1024; }
      const d = demo.current;
      if (running && d) {
        if (d.startedAt < 0) d.startedAt = now;
        d.t = Math.min(d.plan.end, now - d.startedAt);
        playShotSounds(d, soundsRef.current);
        if (d.duel) { d.duel.t = d.t; playShotSounds(d.duel, d.duel.opp.sounds); }
        if (d.t >= d.plan.end) setRunning(false);
      }
      drawRef.current();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const stop = () => { if (document.hidden) { setSpin(false); setPlaying(false); setRunning(false); } };
    document.addEventListener("visibilitychange", stop);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", stop); };
  }, [playing, spin, running, frames, item, animation]);

  /** Plans and starts the demo for a pick: the unit turns from where it faces now toward the target. */
  const startAttack = (pick: AttackPick) => {
    const wpn = weapons[pick.weapon];
    const offered = dummyTargets(wpn, dummies, item.spec.category);
    const dummy = offered.find(x => x.kind === pick.target) ?? offered[0];
    if (!wpn || !dummy) return;
    const me = describe(item), shape = me.shape;
    const startFacing = shape.defenceTurret !== null ? shape.defenceTurret : view.current.facing;
    // The direction that lets the scene show biggest (north-east, the default view, unless a long range needs another).
    const fitFor = (aim: number) => sceneFit(planAttack({ weapon: wpn, dummy, aim, startFacing, shape }), radius ?? 24, lift, size);
    const score = (fit: number) => (fit >= 1 ? Math.min(MAX_ZOOM, Math.floor(fit)) : fit);
    const fits = AIM_CANDIDATES.map(fitFor), top = Math.max(...fits.map(score));
    const aim = AIM_CANDIDATES[fits.findIndex(fit => score(fit) >= top)];
    const plan = planAttack({ weapon: wpn, dummy, aim, startFacing, shape });
    const geo = geoFor(item, me, view.current.facing);
    // Warm the frames the demo turns to and fires with, so they are ready when it gets there.
    const end = unitPoseAt(plan, plan.firstShot);
    frames.want(item, pose(end.facing, 0, firstAction, item.spec.voxel ? Math.round(end.turret / 16) * 16 & 1023 : end.turret), true);
    if (fireAction) frames.want(item, pose(end.facing, 0, fireAction, end.turret, false), true);
    demo.current = { plan, t: 0, startedAt: -1, fired: 0, landed: 0, lastReport: -1e9, accent: accent(), ...geo };
    setSpin(false); setPlaying(false); setZoomOverride(null);
    setAttack({ weapon: pick.weapon, target: dummy.kind, plan }); setRunning(true);
    onAction?.("attack-order");
  };
  /**
   * Versus: the unit and an opponent stand at the shorter of their two ranges and fire their best armaments at each
   * other until one falls (each an ordinary attack plan on the other's health and armour; settleDuel stops the fallen).
   */
  const startDuel = (index: number) => {
    const opp = opponents[index];
    if (!opp || !self) return;
    const me = describe(item), them = describe(opp.item);
    const mine: ViewerDummy = { kind: dummyKindOf(item.spec.category), name: item.spec.name, health: self.health, armor: self.armor };
    const theirs: ViewerDummy = { kind: dummyKindOf(opp.item.spec.category), name: opp.name, health: opp.health, armor: opp.armor };
    const wA = bestWeapon(weapons, theirs, item.spec.category), wB = bestWeapon(opp.weapons, mine, opp.item.spec.category);
    const any = wA ?? wB;
    if (!any) return;
    const cells = Math.max(1.2, Math.min(...[wA, wB].flatMap(w => (w ? [w.range] : []))));
    const startFacing = me.shape.defenceTurret !== null ? me.shape.defenceTurret : view.current.facing;
    const planFor = (aim: number) => planAttack({ weapon: wA ?? any, dummy: theirs, aim, startFacing, shape: me.shape, cells, respawn: false });
    const score = (fit: number) => (fit >= 1 ? Math.min(MAX_ZOOM, Math.floor(fit)) : fit);
    const fits = AIM_CANDIDATES.map(aim => sceneFit(planFor(aim), radius ?? 24, lift, size)), top = Math.max(...fits.map(score));
    const aim = AIM_CANDIDATES[fits.findIndex(fit => score(fit) >= top)];
    const back = (aim + 512) & 1023;
    let a = planFor(aim);
    let b = planAttack({ weapon: wB ?? any, dummy: mine, aim: back, startFacing: them.shape.defenceTurret ?? back, shape: them.shape, cells, respawn: false });
    if (!wA) a = holdFire(a);
    if (!wB) b = holdFire(b);
    [a, b] = settleDuel(a, b);
    // The opponent wears another player colour than the unit.
    const oppColor = houseColors.find(c => c.hex !== color && c.id !== "red")?.hex ?? houseColors[1].hex;
    demo.current = {
      plan: a, t: 0, startedAt: -1, fired: 0, landed: 0, lastReport: -1e9, accent: accent(), ...geoFor(item, me, view.current.facing),
      duel: { opp, plan: b, t: 0, fired: 0, landed: 0, lastReport: -1e9, geo: geoFor(opp.item, them, back), color: color === houseColors[0].hex ? oppColor : houseColors[0].hex, me, them, frames: [null, null] },
    };
    lastFrame.current = null;
    setSpin(false); setPlaying(false); setZoomOverride(null);
    setAttack({ weapon: Math.max(0, weapons.indexOf(wA ?? any)), target: theirs.kind, plan: a, versus: index }); setRunning(true);
    onAction?.("attack-order");
  };
  const stopAttack = () => {
    const d = demo.current;
    // Leave the unit facing the way the demo turned it.
    if (d) { const p = unitPoseAt(d.plan, d.t); view.current.facing = p.facing; setFacing(p.facing); }
    demo.current = null; lastFrame.current = null;
    setAttack(null); setRunning(false); setZoomOverride(null);
  };

  const drag = useRef<{ x: number; facing: number } | null>(null);
  const canTurn = turns(item) && !running;
  const choose = (id: string) => { if (attack) stopAttack(); setAnimation(id); view.current.time = 0; setPlaying(true); onAction?.(id); };
  const pickWeapon = (i: number) => startAttack({ weapon: i, target: dummyTargets(weapons[i], dummies, item.spec.category)[0]?.kind ?? "infantry" });
  const fired = useRef(fire?.n ?? 0);
  useEffect(() => {
    if (!fire || fire.n === fired.current) return;
    fired.current = fire.n;
    const i = weapons.findIndex(w => w.id.toLowerCase() === fire.weapon.toLowerCase());
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a request from outside (the Sound desk's Fire)
    if (i >= 0) pickWeapon(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per request
  }, [fire]);

  return (
    <div className="viewer-stage">
      <div ref={boxRef} className="viewer-canvas-box" tabIndex={0} role="slider" aria-orientation="horizontal"
        aria-label={`${item.spec.name}: ${canTurn ? "drag or use the arrow keys to turn it" : "a fixed view"}`}
        aria-valuemin={0} aria-valuemax={1023} aria-valuenow={facing} aria-valuetext={facingLabel(facing)}
        onPointerDown={e => { if (!canTurn || (e.target as Element).closest("button")) return; drag.current = { x: e.clientX, facing: view.current.facing }; e.currentTarget.setPointerCapture(e.pointerId); setSpin(false); }}
        onPointerMove={e => { if (!drag.current) return; view.current.facing = dragFacing(drag.current.facing, e.clientX - drag.current.x); if (attack) stopAttack(); schedule(); }}
        onPointerUp={() => { drag.current = null; setFacing(view.current.facing); }} onPointerCancel={() => { drag.current = null; }}
        onWheel={e => { if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return; setZoomOverride(z => clampZoom((z ?? zoom) + (e.deltaY < 0 ? 1 : -1), MAX_ZOOM)); }}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") { if (!canTurn) return; if (attack) stopAttack(); view.current.facing = (view.current.facing + (e.key === "ArrowLeft" ? FACING_STEP : -FACING_STEP) + 1024) % 1024; setFacing(view.current.facing); schedule(); e.preventDefault(); }
          else if (e.key === " ") { if (canTurn) setSpin(s => !s); e.preventDefault(); }
          else if (e.key === "+" || e.key === "=") setZoomOverride(clampZoom(zoom + 1, MAX_ZOOM));
          else if (e.key === "-") setZoomOverride(clampZoom(zoom - 1, MAX_ZOOM));
        }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
        {tag && <div className="viewer-stage-tag">{tag}</div>}
        {/* The demo's picture choices sit on the stage itself: which weapon fires, and at what. */}
        {attack && attack.versus === undefined && weapon && (weapons.length > 1 || targets.length > 1) && <div className="viewer-attack-picks">
          {weapons.length > 1 && <div className="viewer-picks" role="radiogroup" aria-label="Weapon">
            {weapons.map((w, i) => { const best = dummyTargets(w, dummies, item.spec.category)[0]; return (
              <button key={w.id} type="button" role="radio" aria-checked={attack.weapon === i} onClick={() => pickWeapon(i)}
                title={`${w.label}${w.mode ? ` (${modeLabel(w.mode)})` : ""}: ${w.damage} damage, ${trimCells(w.range)} cells, ${(w.reloadTicks * 0.04).toFixed(1)} s reload${w.burst > 1 ? `, bursts of ${w.burst}` : ""}`}
                aria-label={`${w.label}${w.mode ? `, ${modeLabel(w.mode)}` : ""}`}>
                <EffectGlyph effect={w.effect} />{best && <span className="viewer-pick-at"><TargetGlyph kind={best.kind} /></span>}{w.mode && <span className="viewer-pick-mode">{modeLabel(w.mode)}</span>}
              </button>); })}
          </div>}
          {targets.length > 1 && <div className="viewer-picks" role="radiogroup" aria-label="Target">
            {targets.map(d => <button key={d.kind} type="button" role="radio" aria-checked={attack.plan.dummy.kind === d.kind} onClick={() => startAttack({ weapon: attack.weapon, target: d.kind })}
              title={`${d.name}: ${d.health} HP, ${d.armor} armor · ${shotDamage(weapon, d.armor)} per hit`} aria-label={`${d.name} target`}>
              <TargetGlyph kind={d.kind} /></button>)}
          </div>}
        </div>}
      </div>
      <div className="viewer-controls">
        <div className="viewer-actions" role="group" aria-label="Actions">
          {weapons.length > 0 && <button type="button" className="viewer-attack" aria-pressed={Boolean(attack)}
            title={attack ? (running ? "Stop the attack" : "Fire again") : "Attack a target at this weapon's range"}
            onClick={() => (attack ? (running ? stopAttack() : attack.versus !== undefined ? startDuel(attack.versus) : startAttack(attack)) : pickWeapon(0))}>
            {attack && !running ? <RotateCcw size={14} aria-hidden="true" /> : <Crosshair size={14} aria-hidden="true" />}Attack</button>}
          {actions.map(a => <button key={a.id} type="button" aria-pressed={!attack && animation === a.id} onClick={() => (!attack && animation === a.id ? setPlaying(p => !p) : choose(a.id))}>
            {!attack && animation === a.id && playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}{a.label}</button>)}
        </div>
        <div className="viewer-tools">
          <div className="viewer-colors" role="radiogroup" aria-label="Player colour">
            {houseColors.map(c => <button key={c.id} type="button" role="radio" aria-checked={color === c.hex} aria-label={c.name} title={c.name} style={{ background: `#${c.hex}` }} onClick={() => onColor(c.hex)} />)}
          </div>
          {self && opponents.length > 0 && <SearchSelect<number> size="sm" className="viewer-versus" aria-label="Versus: fight another unit" placeholder="Find a unit to fight"
            value={attack?.versus ?? -1} onValueChange={v => (v < 0 ? stopAttack() : startDuel(v))} options={versusOptions} />}
          {weapons.length > 0 && <button type="button" className="viewer-tool" aria-pressed={rings} onClick={() => { setRings(r => !r); if (!attack) setZoomOverride(null); }} title="Weapon range on the ground, to scale"><Radar size={15} aria-hidden="true" /><span>Range</span></button>}
          {turns(item) && <button type="button" className="viewer-tool" aria-pressed={spin} disabled={running} onClick={() => setSpin(s => !s)} title="Spin (Space)"><RotateCw size={15} aria-hidden="true" /><span>Spin</span></button>}
          <div className="viewer-zoom" role="group" aria-label="Zoom">
            <button type="button" className="viewer-tool" aria-label="Zoom out" onClick={() => setZoomOverride(clampZoom(zoom - 1, MAX_ZOOM))} disabled={zoom <= 1}><Minus size={15} aria-hidden="true" /></button>
            <span>{zoom >= 1 ? zoom : `1/${Math.round(1 / zoom)}`}×</span>
            <button type="button" className="viewer-tool" aria-label="Zoom in" onClick={() => setZoomOverride(clampZoom(zoom + 1, MAX_ZOOM))} disabled={zoom >= MAX_ZOOM}><Plus size={15} aria-hidden="true" /></button>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

type DemoClock = { plan: AttackPlan; t: number; fired: number; landed: number; lastReport: number };
/** Each shot's report and each hit's impact as the demo's clock passes them (instant weapons play their report only). */
function playShotSounds(d: DemoClock, sounds: AttackSounds | undefined) {
  const clips = sounds?.(d.plan.weapon.id);
  const shots = d.plan.shots;
  while (d.fired < shots.length && shots[d.fired].fire <= d.t) {
    // Rapid fire plays one report per 90 ms: the pool would drop the rest anyway.
    if (clips?.report.length && d.t - d.lastReport >= 90 && d.t - shots[d.fired].fire < 200) { void soundEngine.playAny(clips.report); d.lastReport = d.t; }
    d.fired++;
  }
  while (d.landed < shots.length && shots[d.landed].impact <= d.t) {
    const s = shots[d.landed];
    if (clips?.impact.length && d.t - s.impact < 200 && (s.impact - s.fire > 60 || !clips.report.length)) void soundEngine.playAny(clips.impact, { gain: 0.85 });
    d.landed++;
  }
}

/** 5.75 -> "5.8", 4 -> "4". */
const trimCells = (cells: number) => (Number.isInteger(cells) ? String(cells) : cells.toFixed(1));

