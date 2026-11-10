"use client";
/**
 * The Attack demo's pictures, drawn procedurally on the stage canvas: the training targets (1x pixel art, scaled by
 * whole pixels like the units), each weapon's shot in flight (tracers, shells, missiles with smoke, flak, beams,
 * bolts), muzzle flashes and impacts, the target's health bar and range rings. Solid parts snap to the game's pixel
 * grid; flashes and beams add a soft additive glow. No DOM, nothing animates by itself: the stage calls these with
 * the time it wants drawn.
 */
import { AIR_ALTITUDE, beamMs, healthAt, PX_X, PX_Y, resultLabel, type AttackPlan, type Shot } from "./attack";
import type { DummyKind } from "../../../../lib/weapon-demo";
import { facingVector } from "./attack";

export type Picture = { canvas: HTMLCanvasElement; width: number; height: number; anchorX: number; anchorY: number };
/** Device pixels: (ax, ay) is the unit's starting ground point; z device pixels per game pixel. */
export type FxView = { ctx: CanvasRenderingContext2D; z: number; ax: number; ay: number; calm: boolean; dpr: number; width: number; height: number };
type P = { x: number; y: number };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const hash = (n: number) => { let h = Math.imul((n * 2654435761) | 0, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };

// ----- Pixel primitives (game pixels relative to the unit's ground point) -----

const dev = (v: FxView, p: P) => ({ x: v.ax + Math.round(p.x) * v.z, y: v.ay + Math.round(p.y) * v.z });
function px(v: FxView, x: number, y: number, color: string, w = 1, h = 1) {
  v.ctx.fillStyle = color;
  v.ctx.fillRect(v.ax + Math.round(x) * v.z, v.ay + Math.round(y) * v.z, w * v.z, h * v.z);
}
function disc(v: FxView, cx: number, cy: number, r: number, color: string, squash = 1) {
  const R = Math.max(0.5, r);
  v.ctx.fillStyle = color;
  for (let dy = -Math.ceil(R * squash); dy <= Math.ceil(R * squash); dy++) {
    const half = Math.floor(Math.sqrt(Math.max(0, R * R - (dy / squash) * (dy / squash))));
    if (half < 0) continue;
    v.ctx.fillRect(v.ax + (Math.round(cx) - half) * v.z, v.ay + (Math.round(cy) + dy) * v.z, (2 * half + 1) * v.z, v.z);
  }
}
function line(v: FxView, a: P, b: P, color: string) {
  let x0 = Math.round(a.x), y0 = Math.round(a.y);
  const x1 = Math.round(b.x), y1 = Math.round(b.y);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  v.ctx.fillStyle = color;
  for (let n = 0; n < 2000; n++) {
    v.ctx.fillRect(v.ax + x0 * v.z, v.ay + y0 * v.z, v.z, v.z);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
/** A soft additive glow (device resolution): flashes, beams, burning. */
function glow(v: FxView, p: P, r: number, rgb: string, alpha: number) {
  if (alpha <= 0.01 || r <= 0) return;
  const c = dev(v, p), R = r * v.z, ctx = v.ctx;
  const g = ctx.createRadialGradient(c.x + v.z / 2, c.y + v.z / 2, 0, c.x + v.z / 2, c.y + v.z / 2, R);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(0.4, `rgba(${rgb},${alpha * 0.45})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = g;
  ctx.fillRect(c.x + v.z / 2 - R, c.y + v.z / 2 - R, 2 * R, 2 * R);
  ctx.restore();
}
function glowLine(v: FxView, a: P, b: P, width: number, rgb: string, alpha: number) {
  if (alpha <= 0.01) return;
  const A = dev(v, a), B = dev(v, b), ctx = v.ctx;
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
  for (const [w, k] of [[width * 2.2, 0.35], [width, 0.7]] as const) {
    ctx.strokeStyle = `rgba(${rgb},${alpha * k})`; ctx.lineWidth = w * v.z;
    ctx.beginPath(); ctx.moveTo(A.x + v.z / 2, A.y + v.z / 2); ctx.lineTo(B.x + v.z / 2, B.y + v.z / 2); ctx.stroke();
  }
  ctx.restore();
}
function polyline(v: FxView, points: P[], color: string) { for (let i = 1; i < points.length; i++) line(v, points[i - 1], points[i], color); }
function glowPolyline(v: FxView, points: P[], width: number, rgb: string, alpha: number) {
  if (alpha <= 0.01) return;
  const ctx = v.ctx;
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const [w, k] of [[width * 2.4, 0.3], [width, 0.65]] as const) {
    ctx.strokeStyle = `rgba(${rgb},${alpha * k})`; ctx.lineWidth = w * v.z; ctx.beginPath();
    points.forEach((p, i) => { const d = dev(v, p); if (i) ctx.lineTo(d.x + v.z / 2, d.y + v.z / 2); else ctx.moveTo(d.x + v.z / 2, d.y + v.z / 2); });
    ctx.stroke();
  }
  ctx.restore();
}
/** A 1x picture with its anchor at game point p. */
export function blit(v: FxView, pic: Picture, p: P, alpha = 1) {
  if (alpha <= 0) return;
  const ctx = v.ctx;
  if (alpha < 1) { ctx.save(); ctx.globalAlpha = alpha; }
  ctx.drawImage(pic.canvas, v.ax + (Math.round(p.x) - pic.anchorX) * v.z, v.ay + (Math.round(p.y) - pic.anchorY) * v.z, pic.width * v.z, pic.height * v.z);
  if (alpha < 1) ctx.restore();
}

// ----- Training targets: 1x pixel art, cached per kind, state and facing -----

type Rgb = [number, number, number];
const shade = (c: Rgb, k: number) => `rgb(${Math.round(Math.min(255, c[0] * k))},${Math.round(Math.min(255, c[1] * k))},${Math.round(Math.min(255, c[2] * k))})`;

function canvas1x(w: number, h: number) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  return { c, g: c.getContext("2d", { willReadFrequently: true })! };
}
/** Hard pixel edges (no half-transparent anti-aliasing), then a darker 1 px outline where the shape meets nothing. */
function finish(c: HTMLCanvasElement, g: CanvasRenderingContext2D, outline = 0.55) {
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data, w = c.width, h = c.height;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[4 * (y * w + x) + 3] > 0;
  const edge: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (solid(x, y) && (!solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1))) edge.push(4 * (y * w + x));
  for (const i of edge) { d[i] *= outline; d[i + 1] *= outline; d[i + 2] *= outline; }
  g.putImageData(img, 0, 0);
}

/** Pseudo-3D for the targets: ground x across, ground y at half height, z straight up (RA2's 2:1 view). */
type Frame3 = { ox: number; oy: number; f: [number, number]; r: [number, number] };
const frame3 = (ox: number, oy: number, facing: number): Frame3 => { const f = facingVector(facing); return { ox, oy, f, r: [-f[1], f[0]] }; };
const at3 = (F: Frame3, fwd: number, right: number, z: number): P => ({ x: F.ox + F.f[0] * fwd + F.r[0] * right, y: F.oy + (F.f[1] * fwd + F.r[1] * right) / 2 - z });
function poly(g: CanvasRenderingContext2D, pts: P[], color: string) { g.fillStyle = color; g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill(); }

/** A box `len` long and `wid` wide from z0 to z1, centred `fwd` ahead of the frame's origin; visible sides then top. */
function box(g: CanvasRenderingContext2D, F: Frame3, fwd: number, len: number, wid: number, z0: number, z1: number, base: Rgb) {
  const c = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => [fwd + (a * len) / 2, (b * wid) / 2]);
  for (let i = 0; i < 4; i++) {
    const [a, b] = [c[i], c[(i + 1) % 4]];
    const mid = [(a[0] + b[0]) / 2 - fwd, (a[1] + b[1]) / 2];
    const nWorld = [F.f[0] * mid[0] + F.r[0] * mid[1], F.f[1] * mid[0] + F.r[1] * mid[1]];
    const n = Math.hypot(nWorld[0], nWorld[1]) || 1;
    if (nWorld[1] / n < -0.05) continue;
    const light = 0.62 + 0.22 * ((-nWorld[0] + nWorld[1]) / n / Math.SQRT2);
    poly(g, [at3(F, a[0], a[1], z0), at3(F, b[0], b[1], z0), at3(F, b[0], b[1], z1), at3(F, a[0], a[1], z1)], shade(base, light));
  }
  poly(g, c.map(([a, b]) => at3(F, a, b, z1)), shade(base, 1));
}
function roundel(g: CanvasRenderingContext2D, p: P, r: number) {
  g.fillStyle = "#ece6d2"; g.beginPath(); g.ellipse(p.x, p.y, r, r * 0.6, 0, 0, 2 * Math.PI); g.fill();
  g.fillStyle = "#c63b26"; g.beginPath(); g.ellipse(p.x, p.y, Math.max(0.8, r * 0.45), Math.max(0.6, r * 0.3), 0, 0, 2 * Math.PI); g.fill();
}

const OLIVE: Rgb = [116, 124, 84], HULL: Rgb = [118, 124, 96], TURRET: Rgb = [136, 142, 110], CONCRETE: Rgb = [156, 152, 138], DRONE: Rgb = [214, 94, 52], SHIP: Rgb = [128, 136, 140], SUB: Rgb = [66, 76, 82];

/** The target's look for its kind: standing (`tilt` 0) or down (1), facing `facing`, whole or wrecked. */
function drawDummy(kind: DummyKind, facing: number, wreck: boolean, tilt: number): Picture {
  const k = wreck ? 0.38 : 1;
  const tone = (c: Rgb): Rgb => [c[0] * k, c[1] * k, c[2] * k];
  switch (kind) {
    case "infantry": {
      // A pop-up range target: a soldier's silhouette board on a post, a roundel on the chest. It falls back when hit.
      const { c, g } = canvas1x(44, 34), ax = 14, ay = 30;
      g.translate(ax, ay); g.rotate(tilt * 1.42); g.scale(1, 1 - tilt * 0.22); g.translate(-ax, -ay);
      g.fillStyle = shade(tone([78, 62, 40]), 1); g.fillRect(13, 17, 2, 13);
      poly(g, [{ x: 8, y: 13 }, { x: 20, y: 13 }, { x: 19, y: 25 }, { x: 9, y: 25 }], shade(tone(OLIVE), 1));
      poly(g, [{ x: 8, y: 13 }, { x: 10, y: 11 }, { x: 18, y: 11 }, { x: 20, y: 13 }], shade(tone(OLIVE), 1.08));
      g.fillStyle = shade(tone(OLIVE), 1.08); g.beginPath(); g.arc(14, 7.5, 3, 0, 2 * Math.PI); g.fill();
      g.fillRect(13, 9, 2, 3);
      if (!wreck) roundel(g, { x: 14, y: 17.5 }, 2.6);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = shade([60, 48, 32], 1); g.fillRect(10, 29, 9, 2);
      finish(c, g);
      return { canvas: c, width: 44, height: 34, anchorX: ax, anchorY: ay };
    }
    case "vehicle": {
      // A range tank: hull, turret and gun; a roundel on the turret roof.
      const { c, g } = canvas1x(48, 38), F = frame3(24, 25, facing);
      box(g, F, 0, 28, 17, 0, 6, tone(HULL));
      // Tracks: darker skirts along both sides.
      for (const side of [-1, 1]) poly(g, [at3(F, 14, side * 8.5, 0), at3(F, -14, side * 8.5, 0), at3(F, -14, side * 8.5, 3), at3(F, 14, side * 8.5, 3)], shade(tone(HULL), 0.45));
      box(g, F, -2, 13, 11, 6, 10, tone(TURRET));
      const gun0 = at3(F, 4, 0, 8), gun1 = at3(F, wreck ? 12 : 17, 0, wreck ? 6 : 8.5);
      g.strokeStyle = shade(tone(TURRET), 0.7); g.lineWidth = 2; g.beginPath(); g.moveTo(gun0.x, gun0.y); g.lineTo(gun1.x, gun1.y); g.stroke();
      if (!wreck) roundel(g, at3(F, -2, 0, 10), 2.4);
      finish(c, g);
      return { canvas: c, width: 48, height: 38, anchorX: 24, anchorY: 25 };
    }
    case "building": {
      // A one-cell concrete bunker with a firing slit and a roundel; a wreck is a lower, charred stump.
      const { c, g } = canvas1x(66, 58), F = frame3(33, 40, 128), h = wreck ? 9 : 21;
      box(g, F, 0, 42, 42, 0, h, tone(CONCRETE));
      if (!wreck) {
        poly(g, [at3(F, 21.2, -12, 14), at3(F, 21.2, 12, 14), at3(F, 21.2, 12, 11), at3(F, 21.2, -12, 11)], "#262622");
        roundel(g, at3(F, 0, 0, h), 4.5);
      } else {
        poly(g, [at3(F, 8, -10, h), at3(F, 16, 4, h), at3(F, 2, 14, h)], shade(tone(CONCRETE), 0.6));
      }
      finish(c, g);
      return { canvas: c, width: 66, height: 58, anchorX: 33, anchorY: 40 };
    }
    case "aircraft": {
      // A target drone in orange livery, side-on to the shooter; the anchor is its own ground point (it flies above).
      const { c, g } = canvas1x(40, 30), F = frame3(20, 17, facing);
      const body = tone(DRONE);
      poly(g, [at3(F, 2, 0, 0), at3(F, -4, -10, 0), at3(F, -7, -10, 0), at3(F, -5, 0, 0), at3(F, -7, 10, 0), at3(F, -4, 10, 0)], shade(body, 0.9));
      poly(g, [at3(F, 11, 0, 0), at3(F, 8, -1.8, 0), at3(F, -11, -1.6, 0), at3(F, -11, 1.6, 0), at3(F, 8, 1.8, 0)], shade(body, 1.08));
      poly(g, [at3(F, -8, 0, 0), at3(F, -11, 0, 0), at3(F, -11, 0, 5), at3(F, -9, 0, 5)], shade(body, 0.8));
      if (!wreck) { g.fillStyle = "#f0ece0"; const a = at3(F, -6, -10, 0), b = at3(F, -6, 10, 0); g.fillRect(Math.round(a.x) - 1, Math.round(a.y), 2, 1); g.fillRect(Math.round(b.x) - 1, Math.round(b.y), 2, 1); }
      g.fillStyle = "#26303a"; const cp = at3(F, 7, 0, 0); g.fillRect(Math.round(cp.x) - 1, Math.round(cp.y) - 1, 2, 1);
      finish(c, g, 0.6);
      return { canvas: c, width: 40, height: 30, anchorX: 20, anchorY: 17 };
    }
    case "ship": {
      const { c, g } = canvas1x(60, 40), F = frame3(30, 26, facing);
      const hull = tone(SHIP);
      const outline = [[20, 0], [12, -6], [-18, -6], [-20, 0], [-18, 6], [12, 6]] as const;
      poly(g, outline.map(([a, b]) => at3(F, a, b, 0)), shade(hull, 0.55));
      poly(g, outline.map(([a, b]) => at3(F, a, b, 4)), shade(hull, 1));
      box(g, F, -5, 11, 8, 4, 10, tone([150, 156, 160]));
      if (!wreck) roundel(g, at3(F, -5, 0, 10), 2.4);
      finish(c, g);
      return { canvas: c, width: 60, height: 40, anchorX: 30, anchorY: 26 };
    }
    case "sub": {
      const { c, g } = canvas1x(48, 28), F = frame3(24, 17, facing);
      const hull = tone(SUB);
      poly(g, Array.from({ length: 16 }, (_, i) => { const a = (i / 16) * 2 * Math.PI; return at3(F, Math.cos(a) * 17, Math.sin(a) * 3.5, 1.5); }), shade(hull, 1));
      box(g, F, 2, 6, 3, 1.5, 7, tone([84, 94, 100]));
      finish(c, g, 0.7);
      return { canvas: c, width: 48, height: 28, anchorX: 24, anchorY: 17 };
    }
  }
}
const dummies = new Map<string, Picture>();
export function dummyPicture(kind: DummyKind, facing: number, wreck = false, tilt = 0): Picture {
  const f = Math.round(facing / 32) * 32 & 1023, t = Math.round(tilt * 4) / 4;
  const key = `${kind}|${f}|${wreck}|${t}`;
  let p = dummies.get(key);
  if (!p) { if (dummies.size > 64) dummies.clear(); p = drawDummy(kind, f, wreck, t); dummies.set(key, p); }
  return p;
}
const shadows = new WeakMap<HTMLCanvasElement, Picture>();
/** A picture's silhouette in black (a flying target's shadow). */
function shadowOf(pic: Picture): Picture {
  let s = shadows.get(pic.canvas);
  if (!s) {
    const { c, g } = canvas1x(pic.width, pic.height);
    g.drawImage(pic.canvas, 0, 0); g.globalCompositeOperation = "source-in"; g.fillStyle = "#000"; g.fillRect(0, 0, pic.width, pic.height);
    s = { ...pic, canvas: c };
    shadows.set(pic.canvas, s);
  }
  return s;
}

/** Pixels the target rises above its ground point (its health bar sits over this). */
export const dummyHeight: Record<DummyKind, number> = { infantry: 24, vehicle: 15, building: 30, aircraft: 9, ship: 14, sub: 8 };
const BAR_WIDTH: Record<DummyKind, number> = { infantry: 14, vehicle: 23, building: 29, aircraft: 20, ship: 29, sub: 23 };

/** A flying target's height over its shadow at time t (a wreck falls). */
export function altitudeAt(plan: AttackPlan, t: number) {
  if (plan.dummy.kind !== "aircraft") return 0;
  if (plan.deathAt === null || t < plan.deathAt || (plan.respawnAt !== null && t >= plan.respawnAt)) return AIR_ALTITUDE;
  const k = clamp01((t - plan.deathAt) / 650);
  return AIR_ALTITUDE * (1 - k * k);
}
/** Where shots aim: the middle of the target, game pixels from the unit's ground point. */
export function aimPoint(plan: AttackPlan, t: number): P {
  const h = dummyHeight[plan.dummy.kind];
  return { x: plan.target.x, y: plan.target.y - altitudeAt(plan, t) - Math.round(h * (plan.dummy.kind === "aircraft" ? 0.2 : 0.5)) };
}

/** The target, its shadow and (for aircraft) its height: whole, falling, wrecked, then a fresh one fading in. */
export function drawTarget(v: FxView, plan: AttackPlan, t: number) {
  const kind = plan.dummy.kind, facing = kind === "aircraft" || kind === "ship" || kind === "sub" ? (plan.aim + 256) & 1023 : (plan.aim + 512) & 1023;
  const dead = plan.deathAt !== null && t >= plan.deathAt && (plan.respawnAt === null || t < plan.respawnAt);
  const fresh = plan.respawnAt !== null && t >= plan.respawnAt;
  const appear = fresh ? clamp01((t - plan.respawnAt!) / 320) : 1;
  const sinceDeath = dead ? t - plan.deathAt! : 0;
  const fade = dead ? clamp01(1 - (sinceDeath - (plan.respawnAt! - plan.deathAt! - 420)) / 420) : 1;
  const ground = plan.target;
  if (kind === "aircraft") {
    const alt = altitudeAt(plan, t);
    const pic = dummyPicture(kind, facing, dead, 0);
    // Its shadow on the ground, then the drone overhead.
    blit(v, shadowOf(pic), ground, 0.38 * fade * appear);
    blit(v, pic, { x: ground.x, y: ground.y - alt }, fade * appear);
    return;
  }
  const tilt = kind === "infantry" && dead ? clamp01(sinceDeath / 260) : 0;
  const sink = (kind === "ship" || kind === "sub") && dead ? Math.min(7, sinceDeath / 140) : 0;
  blit(v, dummyPicture(kind, facing, dead && kind !== "infantry", tilt), { x: ground.x, y: ground.y + sink }, fade * appear);
}

// ----- Shots -----

/** Shot path at progress k (0 muzzle, 1 target): straight, or an arc `lift` pixels high at its peak. */
const along = (a: P, b: P, k: number, lift = 0): P => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k - lift * 4 * k * (1 - k) });
/** How high a shot's arc peaks over the straight line between muzzle and target, 1x pixels. */
export const arcHeight = (plan: AttackPlan, a: P, b: P) => {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  switch (plan.effect) {
    case "artillery": return Math.min(130, d * 0.36 + 10);
    case "lob": return Math.min(90, d * 0.3 + 8);
    case "shell": return d * 0.05;
    case "missile": return plan.dummy.kind === "aircraft" ? d * 0.12 : plan.weapon.range >= 9 ? Math.min(110, d * 0.26) : d * 0.12;
    case "flak": return d * 0.04;
    default: return 0;
  }
};

const FLAME = ["255,250,220", "255,214,120", "255,150,60"];
function muzzleFlash(v: FxView, m: P, facing: number, age: number, effect: AttackPlan["effect"]) {
  const life = effect === "missile" ? 150 : effect === "laser" || effect === "tesla" || effect === "rad" || effect === "beam" ? 120 : 90;
  if (age < 0 || age > life) return;
  const k = 1 - age / life;
  if (effect === "tesla") { glow(v, m, 9 * k + 3, "130,200,255", 0.9 * k); return; }
  if (effect === "rad") { glow(v, m, 8 * k + 2, "120,255,90", 0.8 * k); return; }
  if (effect === "laser" || effect === "beam") { glow(v, m, 7 * k + 2, "170,220,255", 0.9 * k); return; }
  if (effect === "bite") return;
  const [fx, fy] = facingVector(facing);
  const d = { x: fx * 60 / 1448 * 34, y: fy * 30 / 1448 * 34 };
  const n = Math.hypot(d.x, d.y) || 1, u = { x: d.x / n, y: d.y / n };
  const big = effect === "shell" || effect === "artillery" || effect === "missile" ? 1.6 : 1;
  glow(v, m, (6 + 4 * k) * big, FLAME[1], 0.75 * k);
  if (age < life * 0.6) {
    px(v, m.x, m.y, "#fff8e0", 1, 1);
    for (let i = 1; i <= Math.round(3 * big); i++) px(v, m.x + u.x * i, m.y + u.y * i, i < 2 ? "#ffe9a8" : "#ffb347");
    px(v, m.x - u.y, m.y + u.x, "#ffd27a"); px(v, m.x + u.y, m.y - u.x, "#ffd27a");
  }
}

function smokePuff(v: FxView, p: P, age: number, life: number, size: number, grey = 150) {
  if (age < 0 || age > life) return;
  const k = age / life;
  const g = Math.round(grey * (1 - 0.25 * k));
  v.ctx.save(); v.ctx.globalAlpha = 0.55 * (1 - k);
  disc(v, p.x, p.y - k * 4, size * (0.6 + k), `rgb(${g},${g},${g - 6})`, 0.8);
  v.ctx.restore();
}

/** A fireball (white, yellow, orange, then smoke) with sparks; `size` is its peak radius in game pixels. */
function explosion(v: FxView, p: P, age: number, size: number, seed: number, smoke = true) {
  if (age < 0) return;
  const life = 420 + size * 30;
  if (age < life) {
    const k = age / life;
    const r = size * (0.45 + 0.55 * Math.min(1, age / 110)) * (k > 0.6 ? 1 - (k - 0.6) * 0.8 : 1);
    glow(v, { x: p.x, y: p.y - size * 0.3 }, size * 2.6, k < 0.25 ? FLAME[0] : FLAME[1], 0.75 * (1 - k));
    const ramp = k < 0.12 ? ["#ffffff", "#fff4c2"] : k < 0.3 ? ["#fff0a0", "#ffb340"] : k < 0.6 ? ["#ffb340", "#e2581e"] : ["#9a3a1a", "#4a3a32"];
    disc(v, p.x, p.y - r * 0.4, r, ramp[1], 0.85);
    disc(v, p.x, p.y - r * 0.5, r * 0.6, ramp[0], 0.85);
    if (!v.calm) for (let i = 0; i < 6 + size; i++) {
      const a = hash(seed * 97 + i) * 2 * Math.PI, sp = (0.6 + hash(seed * 31 + i)) * size * 0.11;
      const tt = age / 16;
      const q = { x: p.x + Math.cos(a) * sp * tt, y: p.y - size * 0.3 + Math.sin(a) * sp * tt * 0.6 + 0.0035 * tt * tt * 9 };
      if (age < life * 0.8) px(v, q.x, q.y, i % 3 ? "#ffcf6a" : "#fff6d0");
    }
  }
  if (smoke) for (let i = 0; i < (v.calm ? 1 : 3); i++) {
    const birth = 140 + i * 90;
    const drift = (hash(seed + i * 13) - 0.5) * size;
    smokePuff(v, { x: p.x + drift, y: p.y - size * 0.6 - (age - birth) / 90 }, age - birth, 1100 + size * 40, size * 0.55, 92);
  }
}
function sparks(v: FxView, p: P, age: number, seed: number, color = "#ffe39a", n = 5) {
  if (age < 0 || age > 220) return;
  const k = age / 220;
  glow(v, p, 4, "255,220,140", 0.6 * (1 - k));
  for (let i = 0; i < n; i++) {
    const a = hash(seed * 53 + i) * 2 * Math.PI, d = (1 + hash(seed * 17 + i) * 4) * Math.min(1, age / 120) * 1.4;
    px(v, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.6, color);
  }
}
function dust(v: FxView, p: P, age: number, size: number) {
  if (age < 0 || age > 700) return;
  const k = age / 700;
  v.ctx.save(); v.ctx.globalAlpha = 0.45 * (1 - k);
  disc(v, p.x, p.y, size * (0.5 + k), "rgb(170,148,108)", 0.5);
  v.ctx.restore();
}
function splash(v: FxView, p: P, age: number, size: number) {
  if (age < 0 || age > 700) return;
  const k = age / 700, h = Math.sin(Math.min(1, k * 1.6) * Math.PI) * size * 2.2;
  for (let i = -1; i <= 1; i++) for (let y = 0; y < h; y++) px(v, p.x + i, p.y - y, y > h - 2 ? "#f4fbff" : "#cfe6f2");
  v.ctx.save(); v.ctx.globalAlpha = 0.6 * (1 - k); disc(v, p.x, p.y, size * (0.6 + k * 1.4), "#dceff8", 0.45); v.ctx.restore();
}

/** A jagged bolt from a to b, reshaped every 45 ms. */
function bolt(a: P, b: P, seed: number, t: number, sway = 4): P[] {
  const n = 8, step = Math.floor(t / 45), out: P[] = [a];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  for (let i = 1; i < n; i++) { const off = (hash(seed * 7 + i * 131 + step * 977) - 0.5) * 2 * sway; out.push({ x: a.x + (dx * i) / n + nx * off, y: a.y + (dy * i) / n + ny * off }); }
  out.push(b);
  return out;
}

export type ShotGeometry = { muzzle: (s: Shot) => P; weaponFacing: (s: Shot) => number };

/** Every shot in flight or landing at time t, with its muzzle flash and impact; shells and missiles leave smoke. */
export function drawShots(v: FxView, plan: AttackPlan, t: number, geo: ShotGeometry) {
  const e = plan.effect;
  for (const s of plan.shots) {
    if (t < s.fire - 1) break;
    const since = t - s.fire;
    const m = geo.muzzle(s), target = aimPoint(plan, s.impact), end = { x: target.x + s.spread.x, y: target.y + s.spread.y };
    const flight = Math.max(1, s.impact - s.fire), k = clamp01(since / flight);
    const lift = arcHeight(plan, m, end);
    muzzleFlash(v, m, geo.weaponFacing(s), since, e);
    // Smoke trails behind rockets (left where they were puffed out, so they linger after impact).
    if (e === "missile" && !v.calm) {
      const until = Math.min(t, s.impact);
      for (let te = s.fire; te <= until; te += 34) {
        const q = along(m, end, clamp01((te - s.fire) / flight), lift);
        smokePuff(v, q, t - te, 900, 1.6, 178);
      }
    }
    if (t < s.impact) {
      const p = along(m, end, k, lift), prev = along(m, end, clamp01(k - 0.06), lift);
      switch (e) {
        case "bullet": { const back = along(m, end, clamp01(k - 0.12)); line(v, back, p, "#ffd27a"); px(v, p.x, p.y, "#fff8e0"); glow(v, p, 3, FLAME[1], 0.5); break; }
        case "shell": case "flak": {
          line(v, prev, p, "#ff9a3c"); px(v, p.x, p.y, "#fff2c4", 1, 1); glow(v, p, e === "flak" ? 3 : 4, FLAME[1], 0.6); break;
        }
        case "artillery": {
          for (let i = 1; i < 5; i++) { const q = along(m, end, clamp01(k - i * 0.025), lift); px(v, q.x, q.y, i < 2 ? "#ffb347" : "#9a5a2a"); }
          px(v, p.x, p.y, "#fff2c4", 1, 1); glow(v, p, 4, FLAME[1], 0.55); break;
        }
        case "lob": case "bomb": {
          const q = e === "bomb" ? { x: m.x + (end.x - m.x) * k, y: m.y + (end.y - m.y) * k * k } : p;
          px(v, q.x, q.y, "#2a2a26", 2, 2); px(v, q.x, q.y, "#ff9a3c"); break;
        }
        case "missile": {
          const dir = { x: p.x - prev.x, y: p.y - prev.y }, n = Math.hypot(dir.x, dir.y) || 1, u = { x: dir.x / n, y: dir.y / n };
          line(v, { x: p.x - u.x * 3, y: p.y - u.y * 3 }, p, "#d9d6cc");
          px(v, p.x - u.x * 4, p.y - u.y * 4, "#fff4c2"); px(v, p.x - u.x * 5, p.y - u.y * 5, "#ff9a3c");
          glow(v, { x: p.x - u.x * 4, y: p.y - u.y * 4 }, 5, FLAME[1], 0.8);
          break;
        }
        case "torpedo": {
          const g0 = { x: m.x, y: m.y + 4 }, g1 = { x: plan.target.x, y: plan.target.y };
          const q = along(g0, g1, k);
          line(v, along(g0, g1, clamp01(k - 0.04)), q, "#1e2a30");
          for (let i = 1; i < 7; i++) { const b = along(g0, g1, clamp01(k - i * 0.03)); if (hash(s.seed * 100 + i + Math.floor(t / 80)) > 0.35) px(v, b.x + (hash(i + s.seed) - 0.5) * 2, b.y - 1, "#e4f4fb"); }
          break;
        }
        default: break;
      }
    }
    // Instant weapons draw their line at the moment of firing; beams and bolts hold for their duration.
    const beam = beamMs(e);
    if (e === "tracer" && since >= 0 && since < 90) {
      // A streak that races from the muzzle to the target in a few frames.
      const k = since / 90, a = along(m, end, Math.max(0, k - 0.4)), b = along(m, end, Math.min(1, k + 0.15));
      line(v, a, b, "#ffe7a0"); glowLine(v, a, b, 1, FLAME[1], 0.4);
    } else if (beam && since >= 0 && since < beam) {
      const fade = since < beam * 0.6 ? 1 : 1 - (since - beam * 0.6) / (beam * 0.4);
      if (e === "tesla") {
        for (let b = 0; b < (v.calm ? 1 : 2); b++) { const pts = bolt(m, end, s.seed * 1e4 + b * 7, t, 4 + b * 2); glowPolyline(v, pts, 1.8, "120,190,255", 0.9 * fade); polyline(v, pts, b ? "#9fd2ff" : "#f2fbff"); }
        glow(v, end, 8, "140,200,255", 0.8 * fade);
      } else if (e === "rad") {
        const pts: P[] = [], n = 14, dx = end.x - m.x, dy = end.y - m.y, len = Math.hypot(dx, dy) || 1;
        for (let i = 0; i <= n; i++) { const w = Math.sin(i * 1.3 - t / 40) * 1.6 * (i && i < n ? 1 : 0); pts.push({ x: m.x + (dx * i) / n - (dy / len) * w, y: m.y + (dy * i) / n + (dx / len) * w }); }
        glowPolyline(v, pts, 2.4, "90,255,70", 0.85 * fade); polyline(v, pts, "#e2ffc8");
        glow(v, end, 9, "110,255,80", 0.7 * fade);
      } else {
        const wide = e === "beam" ? 2.6 : 1.4;
        glowLine(v, m, end, wide * 1.6, "110,190,255", 0.8 * fade); line(v, m, end, "#f4fbff");
        glow(v, end, 6 + wide * 2, "170,220,255", 0.8 * fade);
      }
    }
    // Impact.
    const age = t - s.impact;
    if (age >= 0) impact(v, plan, s, end, age);
  }
}

function impact(v: FxView, plan: AttackPlan, s: Shot, p: P, age: number) {
  const kind = plan.dummy.kind, hard = kind === "vehicle" || kind === "building" || kind === "ship";
  const water = kind === "ship" || kind === "sub";
  const groundAt = { x: plan.target.x + s.spread.x, y: plan.target.y + s.spread.y * 0.5 };
  switch (plan.effect) {
    case "tracer": case "bullet": sparks(v, p, age, s.seed * 1e5, hard ? "#ffe39a" : "#e9d9b0", hard ? 6 : 4); if (!hard && kind !== "aircraft") dust(v, groundAt, age, 2); break;
    case "shell": explosion(v, p, age, 4.5, s.seed * 1e5); break;
    case "artillery": explosion(v, p, age, 7, s.seed * 1e5); if (kind !== "aircraft") dust(v, groundAt, age, 6); break;
    case "lob": if (water) splash(v, groundAt, age, 3); else explosion(v, p, age, 6, s.seed * 1e5); break;
    case "bomb": explosion(v, p, age, 9, s.seed * 1e5); break;
    case "missile": explosion(v, p, age, kind === "aircraft" ? 5 : 6, s.seed * 1e5); break;
    case "flak": explosion(v, p, age, 3.5, s.seed * 1e5, false); smokePuff(v, p, age, 900, 3, 70); break;
    case "torpedo": splash(v, groundAt, age, 4); explosion(v, p, age, 4, s.seed * 1e5, false); break;
    case "laser": case "beam": sparks(v, p, age, s.seed * 1e5, "#d8f0ff", 6); break;
    case "tesla": sparks(v, p, age, s.seed * 1e5, "#bfe4ff", 7); break;
    case "rad": glow(v, p, 7, "110,255,80", age < 500 ? 0.5 * (1 - age / 500) : 0); break;
    case "bite": if (age < 200) { for (let i = 0; i < 3; i++) line(v, { x: p.x - 3 + i * 2, y: p.y - 3 }, { x: p.x - 1 + i * 2, y: p.y + 2 }, "#f4f0e6"); } dust(v, groundAt, age, 3); break;
  }
}

/** The target's destruction: a fireball sized to it, burning while the wreck stands. */
export function drawDeath(v: FxView, plan: AttackPlan, t: number) {
  if (plan.deathAt === null || t < plan.deathAt) return;
  if (plan.respawnAt !== null && t >= plan.respawnAt) return;
  const age = t - plan.deathAt, kind = plan.dummy.kind, g = plan.target, seed = Math.round(plan.deathAt);
  const center = { x: g.x, y: g.y - dummyHeight[kind] * 0.4 };
  switch (kind) {
    case "infantry": dust(v, { x: g.x + 3, y: g.y }, age - 200, 5); break;
    case "vehicle": explosion(v, center, age, 11, seed); burning(v, { x: g.x, y: g.y - 8 }, age - 300, seed); break;
    case "building":
      explosion(v, center, age, 12, seed); explosion(v, { x: g.x - 9, y: g.y - 6 }, age - 160, 8, seed + 1); explosion(v, { x: g.x + 10, y: g.y - 10 }, age - 300, 9, seed + 2);
      burning(v, { x: g.x, y: g.y - 10 }, age - 400, seed); break;
    case "aircraft": {
      const alt = altitudeAt(plan, t);
      explosion(v, { x: g.x, y: g.y - AIR_ALTITUDE }, age, 9, seed, false);
      if (age > 650) explosion(v, g, age - 650, 7, seed + 3);
      if (alt > 1 && !v.calm) smokePuff(v, { x: g.x, y: g.y - alt - 2 }, 0, 400, 2.5, 60);
      break;
    }
    case "ship": explosion(v, center, age, 11, seed); splash(v, g, age - 200, 6); break;
    case "sub": splash(v, g, age, 6); explosion(v, g, age, 6, seed, false); break;
  }
}
function burning(v: FxView, p: P, age: number, seed: number) {
  if (age < 0) return;
  const f = Math.floor(age / 70);
  for (let i = 0; i < (v.calm ? 2 : 4); i++) {
    const x = p.x + (hash(seed + i * 11) - 0.5) * 10, h = 2 + hash(seed + i * 7 + f * 31) * 4;
    for (let y = 0; y < h; y++) px(v, x, p.y - y, y > h - 2 ? "#ffe9a0" : y > h / 2 ? "#ffa53c" : "#e2581e");
    glow(v, { x, y: p.y - 3 }, 6, "255,150,60", 0.35);
  }
  if (!v.calm) for (let i = 0; i < 4; i++) { const birth = (i * 260 + (f % 4) * 65); smokePuff(v, { x: p.x + (hash(seed + i) - 0.5) * 6, y: p.y - 6 - ((age - birth) % 1040) / 70 }, (age - birth) % 1040, 1040, 2.6, 60); }
}

/** Health bar over the target (pips, green to yellow to red), from the first hit until its wreck clears. */
export function drawHealth(v: FxView, plan: AttackPlan, t: number) {
  const hp = healthAt(plan, t), total = plan.dummy.health, kind = plan.dummy.kind;
  const dead = plan.deathAt !== null && t >= plan.deathAt && (plan.respawnAt === null || t < plan.respawnAt);
  if (dead) return;
  const w = BAR_WIDTH[kind], pips = Math.floor((w + 1) / 3), filled = Math.ceil((hp / total) * pips - 1e-9), pct = hp / total;
  const top = plan.target.y - altitudeAt(plan, t) - dummyHeight[kind] - 6, left = plan.target.x - Math.floor((pips * 3 - 1) / 2);
  const color = pct > 0.5 ? "#4fe04a" : pct > 0.25 ? "#ffd23c" : "#ff4a36";
  px(v, left - 1, top - 1, "rgba(10,12,10,0.85)", pips * 3 + 1, 4);
  for (let i = 0; i < pips; i++) px(v, left + i * 3, top, i < filled ? color : "rgba(255,255,255,0.12)", 2, 2);
}

/** Damage numbers floating up from each hit (device text; skipped when motion is reduced). */
export function drawDamage(v: FxView, plan: AttackPlan, t: number) {
  const ctx = v.ctx, size = Math.max(11, Math.round(11 * v.dpr));
  ctx.save(); ctx.font = `700 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`; ctx.textAlign = "center"; ctx.lineJoin = "round";
  for (const s of plan.shots) {
    if (!s.hit || s.damage <= 0) continue;
    const age = t - s.impact;
    if (age < 0 || age > 900) continue;
    const k = age / 900, top = plan.target.y - altitudeAt(plan, s.impact) - dummyHeight[plan.dummy.kind] - 9;
    const p = dev(v, { x: plan.target.x + (s.seed - 0.5) * 10, y: top });
    const y = p.y - (v.calm ? 0 : k * 16 * v.dpr);
    ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    ctx.lineWidth = 3 * v.dpr; ctx.strokeStyle = "rgba(12,14,12,0.9)"; ctx.strokeText(`-${s.damage}`, p.x, y);
    ctx.fillStyle = s.kill ? "#ffcf5a" : "#f4f1e6"; ctx.fillText(`-${s.damage}`, p.x, y);
  }
  ctx.restore();
}

/** The reload filling under the unit between volleys (only for reloads of a second or more). */
export function drawReload(v: FxView, plan: AttackPlan, t: number, feet: P, accent: string) {
  const period = plan.weapon.reloadTicks * 40;
  if (period < 1000 || t > plan.end) return;
  const volleys = [...new Set(plan.shots.map(s => s.volley))];
  for (const k of volleys) {
    const last = Math.max(...plan.shots.filter(s => s.volley === k).map(s => s.fire)), next = plan.shots.find(s => s.volley === k + 1)?.fire;
    if (next === undefined || t < last || t >= next) continue;
    const f = clamp01((t - last) / (next - last)), w = 14;
    px(v, feet.x - w / 2 - 1, feet.y + 4, "rgba(10,12,10,0.8)", w + 2, 3);
    px(v, feet.x - w / 2, feet.y + 5, accent, Math.max(1, Math.round(w * f)), 1);
  }
}

/** The outcome under the target once the demo has played. */
export function drawResult(v: FxView, plan: AttackPlan, t: number, text?: string) {
  if (t < (plan.deathAt ?? plan.end - 1200)) return;
  const label = text ?? resultLabel(plan), ctx = v.ctx, size = Math.round(12 * v.dpr);
  const p = dev(v, { x: plan.target.x, y: plan.target.y + 10 });
  ctx.save(); ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "top";
  const w = ctx.measureText(label).width + 16 * v.dpr, h = size + 10 * v.dpr;
  const x = Math.max(w / 2 + 8, Math.min(v.width - w / 2 - 8, p.x)), y = Math.min(v.height - h - 8, p.y);
  ctx.globalAlpha = clamp01((t - (plan.deathAt ?? plan.end - 1200)) / 250);
  ctx.fillStyle = "rgba(14,17,14,0.86)"; ctx.fillRect(Math.round(x - w / 2), Math.round(y), Math.round(w), Math.round(h));
  ctx.fillStyle = "rgba(241,210,139,0.5)"; ctx.fillRect(Math.round(x - w / 2), Math.round(y), Math.round(w), Math.max(1, Math.round(v.dpr)));
  ctx.fillStyle = "#f0eee6"; ctx.fillText(label, x, y + 5 * v.dpr);
  ctx.restore();
}

/** A weapon's reach as a dotted ring on the ground at true scale (and its minimum range, when it has one). */
export function drawRangeRing(v: FxView, center: P, cells: number, rgb: string, label: string | null, minimum = false) {
  if (cells <= 0) return;
  const rx = cells * 1024 * PX_X, ry = cells * 1024 * PX_Y, ctx = v.ctx;
  const c = dev(v, center);
  ctx.save();
  if (!minimum) { ctx.fillStyle = `rgba(${rgb},0.06)`; ctx.beginPath(); ctx.ellipse(c.x + v.z / 2, c.y + v.z / 2, rx * v.z, ry * v.z, 0, 0, 2 * Math.PI); ctx.fill(); }
  const steps = Math.max(24, Math.round((2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2)) / (minimum ? 4 : 3)));
  ctx.fillStyle = `rgba(${rgb},${minimum ? 0.55 : 0.85})`;
  for (let i = 0; i < steps; i++) {
    if (minimum && i % 2) continue;
    const a = (i / steps) * 2 * Math.PI;
    ctx.fillRect(c.x + Math.round(Math.cos(a) * rx) * v.z, c.y + Math.round(Math.sin(a) * ry) * v.z, v.z, v.z);
  }
  if (label) {
    const size = Math.round(11 * v.dpr);
    ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`; ctx.textBaseline = "middle";
    const x = c.x + rx * v.z + 6 * v.dpr, y = c.y;
    ctx.lineWidth = 3 * v.dpr; ctx.strokeStyle = "rgba(12,14,12,0.85)"; ctx.strokeText(label, x, y);
    ctx.fillStyle = `rgb(${rgb})`; ctx.fillText(label, x, y);
  }
  ctx.restore();
}
