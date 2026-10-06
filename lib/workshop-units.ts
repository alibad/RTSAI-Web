/**
 * Unit art for the Workshop battlefield: turns each live piece of the browser simulation into a frame request (body
 * facing from its heading, turret aimed at its target, house colour, the action it is playing) and draws it from the
 * shared sprite atlas. It reads the simulation and never changes it; the simulation stays approximate.
 *
 * Art is drawn in the projection it was made for: RA2 art on the isometric view, Classic art on the top-down view.
 * The other projection keeps the tactical symbols (workshop-renderer.ts).
 */
import { drawInstances, type AtlasFrame, type Instance } from "./unit-art/atlas";
import type { UnitArtService } from "./unit-art/service";
import type { ActionMeta, ArtAction, ArtMeta, FrameRequest } from "./unit-art/types";
import { actorFor, isBuilding, maxHealth, prototypeRange, supportedWeapon, type LivePiece, type Point, type World } from "./workshop";
import type { GameMode } from "./game-content";

/** Lobby house colours (rules/world.yaml presets) for the three Workshop teams. */
export const teamHouse = { blue: "18BEF2", red: "F21818", neutral: "F2BC18" } as const;

/** Workshop cells are 40 x 20 px (isometric) or 24 px (top-down); RA2 tiles are 60 x 30 and RA tiles 24 at 1x. */
export const artScale = (iso: boolean) => (iso ? 40 / 60 : 1);

/**
 * Simulation heading (radians in cell space, atan2(dy, dx)) to an OpenRA facing (0 = north, counter-clockwise). Facings
 * are world angles: on RA2's isometric grid a cell step +x is world (+1, +1) (down and right on screen), on Classic's
 * rectangular grid it is world (+1, 0).
 */
export function toFacing(radians: number, iso: boolean) {
  const c = Math.cos(radians), s = Math.sin(radians);
  const [x, y] = iso ? [c - s, c + s] : [c, s];
  return ((Math.round(768 - Math.atan2(y, x) * 512 / Math.PI) % 1024) + 1024) % 1024;
}
const toward = (from: Point, to: Point, iso: boolean) => toFacing(Math.atan2(to.y - from.y, to.x - from.x), iso);
export const quantize = (facing: number, facings: number) => (facings <= 1 ? 0 : (Math.round(facing / (1024 / facings)) * (1024 / facings)) & 1023);

const cycle = (t: number, a: ActionMeta) => (a.frames > 1 ? Math.floor((t * 1000) / a.tickMs) % a.frames : 0);
const hasHusk = (key: string) => actorFor(key).behavior.actions.some(a => a.id === "SpawnActorOnDeath");

type Track = { shotAt: number; deadAt: number | null; deadHeading: number };
export type DrawnUnit = { top: number; lift: number };

export class WorkshopUnitArt {
  private track = new Map<number, Track>();
  private lastTime = -1;
  private warmed = new Set<string>();
  private batch: Instance[] = [];

  constructor(readonly service: UnitArtService, readonly mode: GameMode) {}

  /** Whether this projection shows the mode's art (RA2: isometric; Classic: top-down). */
  shows(iso: boolean) { return this.mode === "ra2" ? iso : !iso; }

  /** Once per drawn frame: notes shots and deaths from the simulation, and warms frames for actors on the map. */
  prepare(world: World) {
    if (world.time < this.lastTime) this.track.clear();
    this.lastTime = world.time;
    const state = (id: number) => { let t = this.track.get(id); if (!t) this.track.set(id, t = { shotAt: Number.NEGATIVE_INFINITY, deadAt: null, deadHeading: 0 }); return t; };
    for (const e of world.effects) {
      const shooter = world.pieces.find(p => p.id === e.from);
      if (!shooter || shooter.health <= 0) continue;
      // A projectile in flight, or the impact it became (an instant hit can land between two drawn frames).
      const at = e.kind === "projectile" ? world.time - (e.duration - e.life) : world.time - (e.duration - e.life) - .04;
      const t = state(e.from);
      if (at > t.shotAt) t.shotAt = at;
    }
    for (const p of world.pieces) {
      const t = state(p.id);
      if (p.health <= 0 && t.deadAt === null) { t.deadAt = world.time; t.deadHeading = p.facing; }
      else if (p.health > 0) t.deadAt = null;
    }
    this.service.ensure([...new Set(world.pieces.map(p => p.actorKey))].map(key => { const a = actorFor(key); return { key, id: a.id, mode: a.mode as GameMode, category: a.category }; }));
    for (const p of world.pieces) this.warm(p);
  }

  /** Every facing of what the piece will most likely show: its stand pose, and an infantry's walk, fire and death. */
  private warm(piece: LivePiece) {
    const meta = this.service.meta(piece.actorKey);
    if (!meta) return;
    const color = teamHouse[piece.team], key = `${meta.art}|${color}`;
    if (this.warmed.has(key)) return;
    this.warmed.add(key);
    const shadow = actorFor(piece.actorKey).category !== "aircraft";
    const add = (action: ArtAction, a: ActionMeta | undefined, frames = 1) => {
      if (!a) return;
      for (let f = 0; f < a.facings; f++) for (let i = 0; i < Math.min(frames, a.frames); i++) this.service.prefetch({ art: meta.art, action, facing: quantize(f * 1024 / a.facings, a.facings), aim: -1, frame: i, color, tint: 1, shadow });
    };
    add("stand", meta.actions.stand);
    if (meta.render === "sprite") { add("move", meta.actions.move, 99); add("attack", meta.actions.attack, 99); add("die", meta.actions.die, 99); }
  }

  /** The nearest enemy the piece can hit (its attack order, else what auto-engage would pick), for turret aim. */
  private target(world: World, piece: LivePiece) {
    if (piece.order.type === "attack") return world.pieces.find(p => p.id === piece.order.targetId && p.health > 0) ?? null;
    if (!world.auto || piece.team === "neutral") return null;
    const reach = Math.max(12, prototypeRange(piece) + 3);
    let best: LivePiece | null = null, distance = Infinity;
    for (const p of world.pieces) {
      if (p.health <= 0 || p.team === piece.team || p.team === "neutral") continue;
      const d = Math.hypot(p.x - piece.x, p.y - piece.y);
      if (d < distance && d <= reach && supportedWeapon(piece, p)) { best = p; distance = d; }
    }
    return best;
  }

  /** Begins a depth-ordered pass; art is batched and flushed before any vector drawing that must sit above it. */
  begin() { this.batch = []; }
  flush(ctx: CanvasRenderingContext2D) { if (this.batch.length) { drawInstances(ctx, this.service.atlas, this.batch); this.batch = []; } }

  /**
   * Queues the piece's art at its projected ground point. Returns where its health bar goes (relative to the point),
   * or null when the actor has no art (yet): the caller draws a placeholder instead.
   */
  piece(ctx: CanvasRenderingContext2D, world: World, piece: LivePiece, at: Point, iso: boolean): DrawnUnit | null {
    const meta = this.service.meta(piece.actorKey);
    if (!meta) return null;
    const actor = actorFor(piece.actorKey), k = artScale(iso), t = world.time, color = teamHouse[piece.team];
    const track = this.track.get(piece.id);
    const air = actor.category === "aircraft";
    const flying = air && (piece.health > 0 || piece.phase === "falling");
    const lift = flying ? (piece.phase === "falling" ? Math.max(0, piece.phaseTime / 1.5) : 1) * (meta.altitudePx || 37) * k : 0;
    const push = (frame: AtlasFrame | null, alpha = 1) => { if (frame) this.batch.push({ frame, x: at.x, y: at.y - lift, scale: k, alpha }); return frame; };

    if (piece.health <= 0) {
      const since = track?.deadAt !== null && track?.deadAt !== undefined ? t - track.deadAt : 99;
      const facing = toFacing(track?.deadHeading ?? piece.facing, iso);
      // Infantry play their death sequence, then the body fades.
      if (meta.actions.die) {
        const die = meta.actions.die, alpha = since < 4 ? 1 : Math.max(0, 1 - (since - 4) / 1.5);
        if (alpha <= 0) return { top: 0, lift: 0 };
        const frame = Math.min(die.frames - 1, Math.floor((since * 1000) / die.tickMs));
        push(this.service.frame({ art: meta.art, action: "die", facing: quantize(facing, die.facings), aim: -1, frame, color, tint: 1, shadow: true }), alpha);
        return { top: 0, lift: 0 };
      }
      // A falling aircraft keeps its spinning hull until it hits the ground.
      if (piece.phase === "falling") { push(this.service.frame(this.stand(meta, toFacing(piece.facing, iso), -1, color, 0, false, .7))); return { top: 0, lift }; }
      // Vehicles and ships with a wreck (SpawnActorOnDeath) leave a burnt-out husk once the blast clears.
      if (!isBuilding(actor) && hasHusk(piece.actorKey) && since > .35) push(this.service.frame(this.stand(meta, facing, -1, color, 0, true, .45)), Math.min(1, (since - .35) / .3));
      return { top: 0, lift: 0 };
    }

    const facing = toFacing(piece.facing, iso);
    const target = meta.turret ? this.target(world, piece) : null;
    let aim = target ? quantize(toward(piece, target, iso), 32) : -1;
    const since = track ? t - track.shotAt : Infinity;
    let action: ArtAction = "stand", frame = 0;
    const attack = meta.actions.attack, move = meta.actions.move, damaged = meta.actions.damaged, stand = meta.actions.stand;
    if (attack && since * 1000 < attack.frames * attack.tickMs) { action = "attack"; frame = Math.floor((since * 1000) / attack.tickMs); }
    else if (piece.path.length && move && !isBuilding(actor) && (meta.render === "sprite" || !piece.deployed)) { action = "move"; frame = cycle(t, move); }
    else if (damaged && isBuilding(actor) && piece.health / maxHealth(actor) < .5) { action = "damaged"; frame = cycle(t, damaged); }
    else if (stand) frame = t > 0 ? cycle(t, stand) : 0;
    const a = meta.actions[action] ?? stand;
    const bodyFacing = quantize(facing, a?.facings ?? meta.facings);
    if (aim >= 0 && meta.render === "voxel" && aim === quantize(bodyFacing, 32)) aim = -1; // turret straight ahead: the stand frame
    const request: FrameRequest = { art: meta.art, action, facing: bodyFacing, aim, frame, color, tint: 1, shadow: !air };
    const body = push(this.service.frame(request));
    if (!body) return null;
    // The Fire action's muzzle flash (art from the local rules) over the body for a few ticks after each shot.
    if (meta.firePeriodMs && since * 1000 < Math.min(600, meta.firePeriodMs)) {
      const flash = this.service.frame({ ...request, action: "gunfire", frame: Math.floor((since * 1000) / 40), tint: 1, shadow: false, aim: aim < 0 && meta.turret ? bodyFacing : aim });
      if (flash && flash.w > 1) push(flash);
    }
    return { top: body.top * k, lift };
  }

  private stand(meta: ArtMeta, facing: number, aim: number, color: string, frame: number, shadow: boolean, tint: number): FrameRequest {
    return { art: meta.art, action: "stand", facing: quantize(facing, meta.actions.stand?.facings ?? meta.facings), aim, frame, color, tint, shadow };
  }

  /** Seconds since the piece was destroyed (for the blast drawn over its wreck), or null while alive. */
  deadFor(world: World, id: number) { const t = this.track.get(id); return t?.deadAt === null || t?.deadAt === undefined ? null : world.time - t.deadAt; }
  /** Seconds since the piece last fired. */
  firedFor(world: World, id: number) { const t = this.track.get(id); return t ? world.time - t.shotAt : Infinity; }
  /** True while the actor's art is still being resolved or its first frame rasterized (not yet known to be missing). */
  loading(piece: LivePiece) { const meta = this.service.meta(piece.actorKey); return meta === undefined || (meta !== null && this.service.pending > 0); }
  /** Whether the piece's art shows its own muzzle flash (local firing rules), so no illustrative flash is needed. */
  ownFlash(piece: LivePiece) { return Boolean(this.service.meta(piece.actorKey)?.firePeriodMs); }
}
