"use client";

/**
 * Every picture the Review screen shows (stage, side by side, swipe, lineup, 1x inset, filmstrip) is a cached 1x
 * frame drawn with integer scaling. Assets are fetched and decoded once; voxel meshes are built once per model
 * and rendered through ONE WebGL context (VoxelEngine) whose pictures are read back asynchronously, so the main
 * thread never waits for the GPU; sprite frames are composed once per facing, frame and turret angle (~1 ms). Turning a unit is a cache lookup plus a drawImage. Background warming runs in short slices
 * (about 6 ms) and stops when its queue is empty, so the page idles at zero CPU.
 */
import { loadHva, loadPlayerPalette, loadShp, loadVxl, normalsTable } from "../../../../lib/art-lab/client";
import type { Palette } from "../../../../lib/art-lab/pal";
import type { RasterImage } from "../../../../lib/art-lab/raster";
import type { Shp } from "../../../../lib/art-lab/shp";
import { partVisibleByDefault, type RenderSpec } from "../../../../lib/art-lab/spec";
import { composeRig, rigAnimates, rigFiles, rigFrame, rigLength, spriteRig, type RigShps, type SpriteRig } from "../../../../lib/art-lab/sprite-compose";
import { indexFacing } from "../../../../lib/art-lab/sprite-render";
import type { SpriteArt } from "../../../../lib/art-lab/types";
import type { VoxelEngine } from "../voxel-engine";
import type { VoxelModel } from "../voxel-three";

export type StageItem = { key: string; spec: RenderSpec; sprite: SpriteArt | null };

export type Pose = {
  facing: number;
  turret: number;
  /** Animation tick (sprites); voxels always show HVA frame 0. */
  tick: number;
  animation: string;
  color: string | null;
  shadow: boolean;
  tint: readonly number[];
};

export type Frame = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  /** Opaque bounds relative to the anchor, in 1x pixels. */
  left: number; top: number; right: number; bottom: number;
};

export type AnimationInfo = { length: number; tickMs: number; animates: boolean; labels: { id: string; label: string }[] };

type Three = typeof import("../voxel-three") & typeof import("../voxel-engine");
/** `visible`: the user can see this frame now (filmstrip, lineup). Otherwise it is warm-up for later. */
type Job = { item: StageItem; pose: Pose; key: string; visible: boolean };
type Slot<T> = T | "loading" | "failed";

const MAX_FRAMES = 1600;
const MAX_MODELS = 10;
const SLICE_MS = 6;
/** Background GPU readbacks queued at once; more would only delay the frame the user is waiting for. */
const MAX_INFLIGHT = 1;
/** Background warming waits this long after any key, pointer or wheel input, so input always paints first. */
const YIELD_MS = 300;

export const defaultVisibility = (spec: RenderSpec) => Object.fromEntries((spec.voxel?.parts ?? []).map(p => [p.id, partVisibleByDefault(p)]));

function toFrame(image: RasterImage, tint: readonly number[] | null): Frame {
  const { width, height, data } = image;
  if (tint && (tint[0] !== 1 || tint[1] !== 1 || tint[2] !== 1)) {
    for (let i = 0; i < data.length; i += 4) { data[i] *= tint[0]; data[i + 1] *= tint[1]; data[i + 2] *= tint[2]; }
  }
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[4 * (y * width + x) + 3] === 0) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) { x0 = image.anchorX; x1 = image.anchorX; y0 = image.anchorY; y1 = image.anchorY; }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(data), Math.max(1, width), Math.max(1, height)), 0, 0);
  return {
    canvas, width, height, anchorX: image.anchorX, anchorY: image.anchorY,
    left: x0 - image.anchorX, top: y0 - image.anchorY, right: x1 + 1 - image.anchorX, bottom: y1 + 1 - image.anchorY,
  };
}

/** Distance from the anchor to the farthest opaque corner: the unit's turning circle at 1x. */
export const frameRadius = (f: Frame) => Math.max(...[[f.left, f.top], [f.right, f.top], [f.left, f.bottom], [f.right, f.bottom]].map(([x, y]) => Math.hypot(x, y)));

export class FrameStore {
  private frames = new Map<string, Frame>();
  private palettes = new Map<string, Slot<Palette>>();
  private shps = new Map<string, Slot<Shp>>();
  private models = new Map<string, Slot<VoxelModel>>();
  private three: Three | null = null;
  private threeLoad: Promise<Three> | null = null;
  private engineInstance: VoxelEngine | null = null;
  private listeners = new Set<(kind: "frames" | "assets") => void>();
  private queue: Job[] = [];
  private waiting: Job[] = [];
  private quietUntil = 0;
  private onInput = (e: Event) => {
    if (e.type === "pointermove" && !(e as PointerEvent).buttons) return;
    this.quietUntil = performance.now() + YIELD_MS;
  };
  private listening = false;
  private queued = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { frames: boolean; assets: boolean } = { frames: false, assets: false };
  private emitScheduled = false;
  private inflight = new Set<string>();
  private alive = true;
  /** Bumped whenever an asset finishes loading (for useSyncExternalStore). */
  assetsVersion = 0;
  readonly errors = new Map<string, string>();

  /** Arms the store (and re-arms it after a StrictMode effect cleanup); GPU resources come back lazily. */
  revive() {
    this.alive = true;
    if (!this.listening && typeof window !== "undefined") {
      for (const type of ["keydown", "pointerdown", "pointermove", "wheel"]) window.addEventListener(type, this.onInput, { capture: true, passive: true });
      this.listening = true;
    }
  }

  subscribe(listener: (kind: "frames" | "assets") => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Listener for useSyncExternalStore: notified when assets (not frames) arrive. */
  subscribeAssets = (listener: () => void) => this.subscribe(kind => { if (kind === "assets") listener(); });
  getAssetsVersion = () => this.assetsVersion;

  private emit(kind: "frames" | "assets") {
    if (kind === "assets") this.assetsVersion++;
    this.pending[kind] = true;
    if (this.emitScheduled) return;
    this.emitScheduled = true;
    queueMicrotask(() => {
      this.emitScheduled = false;
      const { frames, assets } = this.pending;
      this.pending = { frames: false, assets: false };
      for (const l of [...this.listeners]) { if (assets) l("assets"); else if (frames) l("frames"); }
    });
  }

  /** The one shared WebGL engine (created when the first voxel loads). */
  get engine() { return this.engineInstance; }

  private key(item: StageItem, pose: Pose, rig?: SpriteRig | null, shps?: RigShps | null) {
    const tint = pose.tint.join(",");
    if (item.spec.voxel) return `${item.spec.id}|v|${pose.facing}|${pose.turret}|${pose.color}|${pose.shadow}|${tint}`;
    if (!rig || !shps) return `${item.spec.id}|s|${pose.animation}|${pose.tick}|${pose.facing}|${pose.turret}|${pose.color}|${pose.shadow}|${tint}`;
    // Facings that pick the same SHP frames share one cached picture (an 8-facing soldier has 8, not 32).
    const tick = rig.overlay ? pose.tick % 960 : rigFrame(rig, rigLength(rig, shps), pose.tick);
    const facings = rig.body.facings;
    const body = indexFacing(pose.facing, facings);
    const vehicle = facings > 1 && Boolean(rig.turret);
    const turretAngle = vehicle ? ((body * 1024) / facings + pose.turret) & 1023 : (rig.initialFacing + pose.turret) & 1023;
    const turret = rig.turret ? indexFacing(turretAngle, rig.turret.facings) : 0;
    return `${item.spec.id}|s|${pose.animation}|${tick}|${body}|${turret}|${pose.color}|${pose.shadow}|${tint}`;
  }

  private spriteParts(item: StageItem, animation: string) {
    const rig = spriteRig(item.sprite, animation);
    if (!rig) return { rig: null, shps: null };
    const body = this.shps.get(rig.body.file ?? "");
    const turret = rig.turret?.file ? this.shps.get(rig.turret.file) : null;
    const overlay = rig.overlay?.file ? this.shps.get(rig.overlay.file) : null;
    const ok = (s: Slot<Shp> | null | undefined): s is Shp | null => s === null || (typeof s === "object" && s !== null);
    if (!body || typeof body !== "object" || !ok(turret) || !ok(overlay)) return { rig, shps: null };
    return { rig, shps: { body, turret, overlay } as RigShps };
  }

  /** A cached frame, or null. Never renders. */
  peek(item: StageItem, pose: Pose): Frame | null {
    const { rig, shps } = item.spec.voxel ? { rig: null, shps: null } : this.spriteParts(item, pose.animation);
    return this.frames.get(this.key(item, pose, rig, shps)) ?? null;
  }

  /**
   * A frame now when possible: cached, or composed on the spot for sprites (about 1 ms). An uncached voxel frame
   * is requested from the GPU ahead of everything else and arrives through `subscribe`; this returns null.
   */
  get(item: StageItem, pose: Pose): Frame | null {
    if (!this.ensure(item, pose)) return null;
    const { rig, shps } = item.spec.voxel ? { rig: null, shps: null } : this.spriteParts(item, pose.animation);
    const key = this.key(item, pose, rig, shps);
    const hit = this.frames.get(key);
    if (hit) return hit;
    return this.render(item, pose, key, rig, shps, true);
  }

  /** Queues a frame: `visible` ones (on screen now) go first and never wait for input to settle. */
  want(item: StageItem, pose: Pose, visible = false) {
    const { rig, shps } = item.spec.voxel ? { rig: null, shps: null } : this.spriteParts(item, pose.animation);
    const key = this.key(item, pose, rig, shps);
    if (this.frames.has(key)) return;
    if (this.queued.has(key)) {
      if (!visible) return;
      const at = this.queue.findIndex(j => j.key === key);
      if (at < 0 || this.queue[at].visible) return;
      this.queue.splice(at, 1);
    }
    this.queued.add(key);
    const job: Job = { item, pose, key, visible };
    if (visible) this.queue.unshift(job); else this.queue.push(job);
    this.schedule();
  }

  /** Drops queued warm-up work (the unit changed). */
  clearQueue() {
    this.queue = [];
    this.waiting = [];
    this.queued.clear();
  }

  animationInfo(item: StageItem, animation: string): AnimationInfo | null {
    if (item.spec.voxel) return null;
    const { rig, shps } = this.spriteParts(item, animation);
    if (!rig || !shps) return null;
    return { length: rigLength(rig, shps), tickMs: Math.max(40, rig.body.tick), animates: rigAnimates(rig, shps), labels: [] };
  }

  /** The loaded voxel model for the 3D view, or null (loading starts). */
  model(item: StageItem, color: string | null): { model: VoxelModel; palette: Palette } | null {
    if (!item.spec.voxel || !this.ensure(item, { facing: 0, turret: 0, tick: 0, animation: "stand", color, shadow: true, tint: [1, 1, 1] })) return null;
    const model = this.models.get(item.spec.id);
    const palette = this.palettes.get(this.paletteKey(item.spec, color));
    return typeof model === "object" && typeof palette === "object" ? { model, palette } : null;
  }

  failed(item: StageItem) { return this.errors.get(item.spec.id) ?? null; }

  private paletteKey(spec: RenderSpec, color: string | null) { return `${spec.palette?.url}|${color}`; }

  /** True when every asset the frame needs is decoded; otherwise starts the loads and returns false. */
  private ensure(item: StageItem, pose: Pose): boolean {
    const spec = item.spec;
    if (this.errors.has(spec.id)) return false;
    if (!spec.palette) { this.errors.set(spec.id, "No palette"); return false; }
    let ready = true;
    const pk = this.paletteKey(spec, pose.color);
    const pal = this.palettes.get(pk);
    if (pal === undefined) { this.loadPalette(spec, pose.color, pk); ready = false; }
    else if (pal === "failed") { this.errors.set(spec.id, "Palette failed to load"); return false; }
    else if (pal === "loading") ready = false;
    if (spec.voxel) {
      const m = this.models.get(spec.id);
      if (m === undefined) { this.loadModel(spec); ready = false; }
      else if (m === "failed") return false;
      else if (m === "loading") ready = false;
      return ready;
    }
    const rig = spriteRig(item.sprite, pose.animation);
    if (!rig) { this.errors.set(spec.id, "No sprite sequence"); return false; }
    for (const file of rigFiles(rig)) {
      const s = this.shps.get(file);
      if (s === undefined) { this.loadShpFile(file, spec.id); ready = false; }
      else if (s === "failed") return false;
      else if (s === "loading") ready = false;
    }
    return ready;
  }

  private loaded() {
    if (!this.alive) return;
    if (this.waiting.length) { this.queue.push(...this.waiting); this.waiting = []; this.schedule(); }
    this.emit("assets");
  }

  private loadPalette(spec: RenderSpec, color: string | null, key: string) {
    this.palettes.set(key, "loading");
    loadPlayerPalette(spec.palette!, color)
      .then(p => { this.palettes.set(key, p); this.loaded(); })
      .catch(() => { this.palettes.set(key, "failed"); this.errors.set(spec.id, "Palette failed to load"); this.loaded(); });
  }

  private loadShpFile(file: string, owner: string) {
    this.shps.set(file, "loading");
    loadShp(file)
      .then(s => { this.shps.set(file, s); this.loaded(); })
      .catch(e => { this.shps.set(file, "failed"); this.errors.set(owner, `Sprite failed to load: ${e instanceof Error ? e.message : e}`); this.loaded(); });
  }

  private async loadThree() {
    if (this.three) return this.three;
    this.threeLoad ??= Promise.all([import("../voxel-three"), import("../voxel-engine")]).then(([a, b]) => ({ ...a, ...b }));
    this.three = await this.threeLoad;
    return this.three;
  }

  private loadModel(spec: RenderSpec) {
    this.models.set(spec.id, "loading");
    const v = spec.voxel!;
    (async () => {
      const [three, parts] = await Promise.all([
        this.loadThree(),
        Promise.all(v.parts.map(async p => ({ id: p.id, label: p.label, vxl: await loadVxl(p.vxl), hva: await loadHva(p.hva), offset: p.offset, turretOffset: p.turretOffset, showShadow: p.showShadow }))),
      ]);
      if (!this.alive) { this.models.delete(spec.id); return; }
      this.engineInstance ??= new three.VoxelEngine();
      this.models.set(spec.id, new three.VoxelModel({ ...v, normals: normalsTable(v.normals) }, parts));
      this.trimModels(spec.id);
      this.loaded();
    })().catch(e => {
      this.models.set(spec.id, "failed");
      this.errors.set(spec.id, `Model failed to load: ${e instanceof Error ? e.message : e}`);
      this.loaded();
    });
  }

  /** Keeps the most recent models; older ones free their GPU buffers (they rebuild if needed again). */
  private trimModels(keep: string) {
    const ids = [...this.models.keys()];
    while (this.models.size > MAX_MODELS) {
      const id = ids.shift();
      if (!id || id === keep) continue;
      const m = this.models.get(id);
      if (typeof m === "object") m.dispose();
      this.models.delete(id);
      for (const k of [...this.frames.keys()]) if (k.startsWith(`${id}|`)) this.frames.delete(k);
    }
  }

  private store(key: string, frame: Frame) {
    this.frames.set(key, frame);
    if (this.frames.size > MAX_FRAMES) {
      let n = this.frames.size - MAX_FRAMES + 200;
      for (const k of this.frames.keys()) { if (n-- <= 0) break; this.frames.delete(k); }
    }
  }

  /** Renders one frame: sprites synchronously; voxels by an asynchronous GPU readback (returns null). */
  private render(item: StageItem, pose: Pose, key: string, rig: SpriteRig | null, shps: RigShps | null, urgent = false): Frame | null {
    const palette = this.palettes.get(this.paletteKey(item.spec, pose.color));
    if (typeof palette !== "object") return null;
    if (item.spec.voxel) {
      const model = this.models.get(item.spec.id);
      const engine = this.engineInstance;
      if (typeof model !== "object" || !engine || this.inflight.has(key)) return null;
      if (!urgent && this.inflight.size >= MAX_INFLIGHT) return null;
      this.inflight.add(key);
      engine.renderInGameAsync(model, {
        facing: pose.facing, turretFacing: pose.turret, frame: 0, visible: defaultVisibility(item.spec), shadow: pose.shadow, airborne: false,
      }, palette, pose.tint).then(image => {
        this.inflight.delete(key);
        if (!this.alive) return;
        this.store(key, toFrame(image, null));
        this.emit("frames");
        this.schedule();
      }, e => {
        this.inflight.delete(key);
        if (this.alive) this.errors.set(item.spec.id, `Could not draw: ${e instanceof Error ? e.message : e}`);
      });
      return null;
    }
    if (!rig || !shps) return null;
    try {
      const frame = toFrame(composeRig(rig, shps, palette, { facing: pose.facing, turretFacing: pose.turret, tick: pose.tick, shadow: pose.shadow }), pose.tint);
      this.store(key, frame);
      return frame;
    } catch (e) {
      this.errors.set(item.spec.id, `Could not draw: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  private schedule() {
    if (this.timer || !this.alive) return;
    this.timer = setTimeout(() => this.process(), 0);
  }

  /**
   * Renders queued frames for about SLICE_MS, then yields; voxel jobs wait while MAX_INFLIGHT readbacks are
   * pending (each one that lands reschedules). Stops when the queue is empty: an idle page does no work.
   */
  private process() {
    this.timer = null;
    if (!this.alive) return;
    const start = performance.now();
    const quiet = start >= this.quietUntil;
    let produced = false;
    const deferred: Job[] = [];
    while (this.queue.length && performance.now() - start < SLICE_MS) {
      const job = this.queue.shift()!;
      this.queued.delete(job.key);
      if (this.frames.has(job.key) || this.inflight.has(job.key)) continue;
      if (this.errors.has(job.item.spec.id)) continue;
      if (!this.ensure(job.item, job.pose)) { this.waiting.push(job); this.queued.add(job.key); continue; }
      // While the user is acting, only what is on screen renders; warm-up waits.
      if ((!job.visible && !quiet) || (job.item.spec.voxel && this.inflight.size >= MAX_INFLIGHT)) { deferred.push(job); this.queued.add(job.key); continue; }
      const { rig, shps } = job.item.spec.voxel ? { rig: null, shps: null } : this.spriteParts(job.item, job.pose.animation);
      if (this.render(job.item, job.pose, job.key, rig, shps)) produced = true;
    }
    if (deferred.length) this.queue = [...deferred, ...this.queue];
    if (produced) this.emit("frames");
    if (!this.queue.length) return;
    // Voxel jobs waiting for a readback resume when it lands (render() reschedules); warm-up resumes when quiet.
    const runnable = this.queue.some(j => (j.visible || quiet) && (!j.item.spec.voxel || this.inflight.size < MAX_INFLIGHT));
    if (runnable) this.schedule();
    else if (!quiet) { this.timer = setTimeout(() => this.process(), Math.max(16, this.quietUntil - performance.now())); }
  }

  /** Frees the WebGL context and every cached picture (on unmount). */
  dispose() {
    this.alive = false;
    this.inflight.clear();
    if (this.listening) {
      for (const type of ["keydown", "pointerdown", "pointermove", "wheel"]) window.removeEventListener(type, this.onInput, { capture: true });
      this.listening = false;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clearQueue();
    for (const m of this.models.values()) if (typeof m === "object") m.dispose();
    this.models.clear();
    this.frames.clear();
    this.engineInstance?.dispose();
    this.engineInstance = null;
  }
}
