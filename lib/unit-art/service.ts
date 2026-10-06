/**
 * Main-thread side of battlefield unit art: resolves each actor's art in a worker, asks workers for frames (visible
 * ones first, then a background warm-up of every facing), and packs the results into one SpriteAtlas. Drawing code asks
 * `frame()` for a request and gets the exact frame, or the closest cached one while it renders, or null.
 *
 * Nothing heavy runs on the main thread: decoding and rasterizing happen in workers; a finished frame costs one
 * putImageData into an atlas page. When the queues are empty the service does no work at all.
 */
import RasterWorker from "./worker?worker";
import { SpriteAtlas, type AtlasFrame } from "./atlas";
import { frameKey, type ActorRef, type ArtItem, type ArtMeta, type FrameRequest, type FromWorker, type ToWorker } from "./types";

type Job = { key: string; request: FrameRequest };
const MAX_INFLIGHT_PER_WORKER = 2;

export class UnitArtService {
  readonly atlas = new SpriteAtlas();
  /** True when the local Studio API serves art (local app), false on the public site, null until known. */
  local: boolean | null = null;
  private workers: Worker[] = [];
  private busy: number[] = [];
  private metas = new Map<string, ArtMeta | null>();
  private items = new Map<string, ArtItem>();
  private asked = new Set<string>();
  private urgent: Job[] = [];
  private warm: Job[] = [];
  private queued = new Set<string>();
  private inflight = new Map<number, { key: string; worker: number }>();
  private failed = new Set<string>();
  private nextId = 0;
  private listeners = new Set<() => void>();
  private notifyScheduled = false;
  private alive = true;

  constructor(readonly mode: "ra" | "ra2", options: { workers?: number; probeLocal?: boolean } = {}) {
    const count = Math.max(1, Math.min(options.workers ?? 2, typeof navigator !== "undefined" ? Math.max(1, (navigator.hardwareConcurrency || 2) - 1) : 1));
    for (let i = 0; i < count; i++) {
      const worker = new RasterWorker();
      worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(i, event.data);
      worker.onerror = () => { this.busy[i] = Number.POSITIVE_INFINITY; };
      this.workers.push(worker);
      this.busy.push(0);
    }
    // Only a loopback page can be the local app; the public site never probes the dev-only API.
    const probeLocal = options.probeLocal ?? (typeof location !== "undefined" && ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname));
    this.send(0, { type: "init", mode, probeLocal });
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  /** The actor's art: a meta, null when it has none (placeholder), undefined while it resolves. */
  meta(actorKey: string) { return this.metas.get(actorKey); }

  /** Resolves art for actors not seen before (one worker round trip for the batch). */
  ensure(actors: readonly ActorRef[]) {
    const fresh = actors.filter(a => !this.asked.has(a.key));
    if (!fresh.length || !this.alive) return;
    for (const a of fresh) this.asked.add(a.key);
    this.send(0, { type: "resolve", actors: fresh });
  }

  /** The exact frame when cached; otherwise queues it (visible work first) and returns the closest cached frame. */
  frame(request: FrameRequest, visible = true): AtlasFrame | null {
    const key = frameKey(request);
    const hit = this.atlas.get(key);
    if (hit) return hit;
    this.enqueue(key, request, visible);
    return this.fallback(request);
  }

  /** Background warm-up: frames likely needed soon (every facing of the stand pose). */
  prefetch(request: FrameRequest) {
    const key = frameKey(request);
    if (!this.atlas.has(key)) this.enqueue(key, request, false);
  }

  get pending() { return this.urgent.length + this.warm.length + this.inflight.size; }

  private fallback(r: FrameRequest): AtlasFrame | null {
    // A death plays forward: show the latest earlier frame, never a standing unit.
    if (r.action === "die") { for (let f = r.frame - 1; f >= 0; f--) { const hit = this.atlas.get(frameKey({ ...r, frame: f })); if (hit) return hit; } return null; }
    const tries: FrameRequest[] = [{ ...r, frame: 0 }, { ...r, action: "stand", frame: 0 }, { ...r, action: "stand", frame: 0, aim: -1 }];
    for (const t of tries) { const f = this.atlas.get(frameKey(t)); if (f) return f; }
    // The nearest facing already drawn.
    for (let d = 32; d <= 512; d += 32) for (const s of [1, -1]) {
      const f = this.atlas.get(frameKey({ ...r, action: "stand", frame: 0, aim: -1, facing: (r.facing + s * d + 1024) & 1023 }));
      if (f) return f;
    }
    return null;
  }

  private enqueue(key: string, request: FrameRequest, visible: boolean) {
    if (this.failed.has(key) || !this.alive) return;
    if (this.queued.has(key)) {
      if (!visible) return;
      const at = this.warm.findIndex(j => j.key === key);
      if (at < 0) return;
      this.warm.splice(at, 1);
    }
    this.queued.add(key);
    (visible ? this.urgent : this.warm).push({ key, request });
    this.pump();
  }

  private pump() {
    for (let w = 0; w < this.workers.length; w++) {
      while (this.busy[w] < MAX_INFLIGHT_PER_WORKER && (this.urgent.length || this.warm.length)) {
        const job = (this.urgent.length ? this.urgent : this.warm).shift()!;
        if (this.atlas.has(job.key)) { this.queued.delete(job.key); continue; }
        const id = ++this.nextId;
        this.inflight.set(id, { key: job.key, worker: w });
        this.busy[w]++;
        this.send(w, { type: "frame", id, request: job.request });
      }
    }
  }

  private receive(worker: number, message: FromWorker) {
    if (!this.alive) return;
    if (message.type === "ready") { this.local = message.local; this.notify(); return; }
    if (message.type === "resolved") {
      for (const { key, meta, item } of message.entries) {
        this.metas.set(key, meta);
        if (meta && item && !this.items.has(meta.art)) {
          this.items.set(meta.art, item);
          for (let w = 1; w < this.workers.length; w++) this.send(w, { type: "register", art: meta.art, item, meta });
        }
      }
      this.notify();
      return;
    }
    const job = this.inflight.get(message.id);
    if (!job) return;
    this.inflight.delete(message.id);
    this.busy[worker] = Math.max(0, this.busy[worker] - 1);
    this.queued.delete(job.key);
    if (message.image) this.atlas.add(job.key, message.image);
    else this.failed.add(job.key);
    this.pump();
    this.notify();
  }

  private notify() {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => { this.notifyScheduled = false; for (const l of [...this.listeners]) l(); });
  }

  private send(worker: number, message: ToWorker) { this.workers[worker]?.postMessage(message); }

  dispose() {
    this.alive = false;
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.urgent = []; this.warm = []; this.queued.clear(); this.inflight.clear();
    this.listeners.clear();
    this.atlas.clear();
  }
}
