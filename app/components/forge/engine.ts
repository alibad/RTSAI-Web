/**
 * Concept Forge stage engine: paints forge sprite sheets in a faction's colours and plays a concept's behaviour
 * (idle, turn, move, fire with projectiles and impacts, damage, death, build) on a 1x canvas with sound.
 *
 * Forge sheets (RTSAI-Art tools/forge/forge_post.py) store per pixel R = light level, G = material class * 10,
 * A = 255 where used. Colour = paint(class) * light in linear space, so any faction's paint applies at runtime.
 */

export type LayerMeta = { sheet: string; w: number; h: number; ax: number; ay: number; cols: number; count: number };
export type SeqMeta = { layer: string; start: number; length: number; facings: number; use: number[]; tick: number; loop?: boolean };
export type Weapon = {
  name: string; kind: "shell" | "bullet" | "rocket" | "missile" | "mortar" | "beam" | "arc" | "flame" | "rail";
  burst: number; interval: number; reload: number; speed?: number; arc?: number; spread?: number; duration?: number;
  range?: number; impact: string; fire: string; hit: string; air?: boolean; pierce?: boolean; chain?: number;
  /** Which of the model's muzzles this weapon fires from (default: all, in turn). */
  muzzles?: number[];
};
export type Concept = {
  id: string; kind: "infantry" | "vehicle" | "defence"; name: string; idea: string; description: string; role: string;
  factions: string[]; faction: string; stats: Record<string, number>; weapons: Weapon[]; sounds: Record<string, string>;
  layers: Record<string, LayerMeta>; sequences: Record<string, SeqMeta>; turretLocked?: boolean; cell: number;
  geometry: { pivot: number[][]; muzzles: number[][][]; muzzleHeight?: number[] };
  built?: string; timing?: Record<string, number>;
  /** Dish keeps turning (radar), the body floats and bobs, a shield pulses. */
  spin?: boolean; hover?: boolean; pulse?: boolean;
  /** Flying: rotors spin in every frame, the body bobs, it explodes in the air and its wreck falls. */
  air?: boolean; altitude?: number;
};
export type Palettes = {
  classes: string[]; lmax: number; players: Record<string, string>;
  factions: Record<string, Record<string, string>>;
};
export type FxMeta = Record<string, { sheet: string; w: number; h: number; count: number; tick: number }>;
/** Per faction, infantry ("inf") and vehicle ("veh") voice lines per cue (select, move, attack, action). */
export type Voices = Record<string, Record<"inf" | "veh", Record<string, string[]>>>;

export const API = "/api/concept-forge";
export const fileUrl = (rel: string) => `${API}/file/${rel.split("/").map(encodeURIComponent).join("/")}`;

// ---------------------------------------------------------------------------------------------- colour
const toLin = (c: number) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
const toSrgb = (x: number) => { x = Math.max(0, Math.min(1, x)); return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)); };
export const hexRgb = (h: string): [number, number, number] => { const s = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)) as [number, number, number]; };

/** 256-entry RGBA lookup per class for one faction + player colour. */
function luts(pal: Palettes, faction: string, player: string) {
  const set = pal.factions[faction] ?? Object.values(pal.factions)[0];
  return pal.classes.map(cls => {
    const lut = new Uint8ClampedArray(256 * 4);
    for (let r = 0; r < 256; r++) {
      const o = r * 4;
      if (cls === "empty") continue;
      if (cls === "shadow") { lut[o + 3] = 105; continue; }
      if (cls === "flash") {
        const h = r / 255;
        lut[o] = 255; lut[o + 1] = toSrgb(toLin(255) * Math.min(1, 0.32 + 0.8 * h)); lut[o + 2] = toSrgb(Math.max(0, -0.5 + 1.4 * h)); lut[o + 3] = 255;
        continue;
      }
      const hex = cls === "team" ? player : set[cls] ?? "#808080";
      const [R, G, B] = hexRgb(hex);
      const L = (r / 255) * pal.lmax;
      lut[o] = toSrgb(toLin(R) * L); lut[o + 1] = toSrgb(toLin(G) * L); lut[o + 2] = toSrgb(toLin(B) * L); lut[o + 3] = 255;
    }
    return lut;
  });
}

const encCache = new Map<string, Promise<ImageData>>();
export function loadEncoded(url: string): Promise<ImageData> {
  let p = encCache.get(url);
  if (!p) {
    p = fetch(url).then(r => r.blob()).then(b => createImageBitmap(b, { colorSpaceConversion: "none", premultiplyAlpha: "none" })).then(bmp => {
      const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
      const x = c.getContext("2d", { willReadFrequently: true })!; x.drawImage(bmp, 0, 0);
      return x.getImageData(0, 0, bmp.width, bmp.height);
    });
    encCache.set(url, p);
  }
  return p;
}

const paintCache = new Map<string, HTMLCanvasElement>();
export function paint(enc: ImageData, key: string, pal: Palettes, faction: string, player: string) {
  const k = `${key}|${faction}|${player}`;
  const hit = paintCache.get(k);
  if (hit) return hit;
  const L = luts(pal, faction, player);
  const out = new ImageData(enc.width, enc.height);
  const s = enc.data, d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    if (s[i + 3] === 0) continue;
    const lut = L[Math.round(s[i + 1] / 10)];
    if (!lut) continue;
    const o = s[i] * 4;
    d[i] = lut[o]; d[i + 1] = lut[o + 1]; d[i + 2] = lut[o + 2]; d[i + 3] = lut[o + 3];
  }
  const c = document.createElement("canvas"); c.width = enc.width; c.height = enc.height;
  c.getContext("2d")!.putImageData(out, 0, 0);
  paintCache.set(k, c);
  return c;
}

const imgCache = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(url: string) {
  let p = imgCache.get(url);
  if (!p) { p = new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; }); imgCache.set(url, p); }
  return p;
}

// ---------------------------------------------------------------------------------------------- sound
export class Sound {
  ctx: AudioContext | null = null;
  buffers = new Map<string, Promise<AudioBuffer | null>>();
  master: GainNode | null = null;
  loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  last = new Map<string, number>();
  enabled = true;
  dest: MediaStreamAudioDestinationNode | null = null;
  ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(this.ctx.destination);
      this.dest = this.ctx.createMediaStreamDestination(); this.master.connect(this.dest);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }
  buffer(cue: string) {
    let p = this.buffers.get(cue);
    if (!p) {
      const ctx = this.ensure();
      p = fetch(fileUrl(cue.includes("/") ? cue : `sounds/${cue}.ogg`)).then(r => (r.ok ? r.arrayBuffer() : Promise.reject())).then(b => ctx.decodeAudioData(b)).catch(() => null);
      this.buffers.set(cue, p);
    }
    return p;
  }
  play(cue: string | undefined, opts: { gain?: number; pan?: number; rate?: number; minGap?: number } = {}) {
    if (!cue || !this.enabled) return;
    const now = performance.now();
    if (opts.minGap && now - (this.last.get(cue) ?? -1e9) < opts.minGap) return;
    this.last.set(cue, now);
    void this.buffer(cue).then(buf => {
      if (!buf || !this.ctx || !this.master) return;
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = opts.rate ?? 1;
      const g = this.ctx.createGain(); g.gain.value = opts.gain ?? 1;
      const p = this.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
      src.connect(g).connect(p).connect(this.master); src.start();
    });
  }
  loop(name: string, cue: string | undefined, on: boolean, gain = 0.5) {
    const cur = this.loops.get(name);
    if (!on || !cue || !this.enabled) {
      if (cur && this.ctx) { cur.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12); const s = cur.src; setTimeout(() => { try { s.stop(); } catch { /* stopped */ } }, 600); this.loops.delete(name); }
      return;
    }
    if (cur) return;
    const ctx = this.ensure();
    const gainNode = ctx.createGain(); gainNode.gain.value = 0; gainNode.connect(this.master!);
    const entry = { src: ctx.createBufferSource(), gain: gainNode };
    this.loops.set(name, entry);
    void this.buffer(cue).then(buf => {
      if (!buf || this.loops.get(name) !== entry) return;
      entry.src.buffer = buf; entry.src.loop = true; entry.src.connect(gainNode); entry.src.start();
      gainNode.gain.setTargetAtTime(gain, ctx.currentTime, 0.15);
    });
  }
  stopAll() { for (const k of [...this.loops.keys()]) this.loop(k, undefined, false); }
}

// ---------------------------------------------------------------------------------------------- stage
type Fx = { name: string; x: number; y: number; t0: number; loop?: number; scale?: number; alpha?: number };
type Shot = {
  kind: Weapon["kind"]; x0: number; y0: number; z0: number; x1: number; y1: number; t0: number; dur: number; arc: number;
  w: Weapon; done?: boolean; lastPuff?: number; seed: number;
};
type Line = { kind: "beam" | "arc" | "rail"; x0: number; y0: number; x1: number; y1: number; t0: number; dur: number; seed: number; colour: string };
type Particle = { x: number; y: number; vx: number; vy: number; t0: number; life: number; r: number };
type Debris = { x: number; y: number; z: number; vx: number; vy: number; vz: number; t0: number; size: number; shade: string; smoke: number };

export type Mode = "idle" | "move" | "dead" | "build" | "prone";

export const FACINGS32 = 32;
/** Screen vector -> OpenRA facing angle (radians, counter-clockwise from north) on the 2:1 ground. */
export const angleOf = (dx: number, dy: number) => Math.atan2(-dx, -2 * dy);
export const facingIndex = (ang: number, n: number) => ((Math.round((ang / (2 * Math.PI)) * n) % n) + n) % n;
const angDiff = (a: number, b: number) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };

/** The stage's world size in sprite pixels (drawn at 3x on the page). */
export const STAGE_W = 360, STAGE_H = 220;

export class Stage {
  W = STAGE_W; H = STAGE_H;
  concept: Concept | null = null;
  pal: Palettes | null = null;
  fxMeta: FxMeta = {};
  faction = "iran"; player = "#e02a1f";
  enc = new Map<string, ImageData>();
  fxImg = new Map<string, HTMLImageElement>();
  ground: HTMLCanvasElement | null = null;
  terrain: "desert" | "steppe" | "urban" = "desert";
  sound = new Sound();
  voices: Voices = {};
  lastVoice = 0;
  /** The unit answers in the voice of the faction it is painted as (the mod's shipped voice sets). */
  say(cue: "select" | "move" | "attack") {
    const c = this.concept; if (!c || c.kind === "defence" || this.mode === "dead") return;
    const now = performance.now(); if (now - this.lastVoice < 900) return;
    const set = this.voices[this.faction]?.[c.kind === "infantry" ? "inf" : "veh"]; if (!set) return;
    const lines = set[cue] ?? set.action ?? set.select; if (!lines?.length) return;
    this.lastVoice = now;
    this.sound.play(lines[Math.floor(Math.random() * lines.length)], { gain: 0.95, pan: this.pan(this.x) * 0.4 });
  }
  // unit state
  x = 150; y = 130; ang = Math.PI * 1.25; tang = Math.PI * 1.25; mode: Mode = "idle"; modeT0 = 0;
  target = { x: 280, y: 80 }; damaged = false;
  firing: { w: Weapon; shotsLeft: number; next: number; muzzle: number; burstStart: number } | null = null;
  fireAnimT0 = -1e9; reloadUntil = 0;
  path = { cx: 175, cy: 120, rx: 95, ry: 52, phase: 0 };
  fx: Fx[] = []; shots: Shot[] = []; lines: Line[] = []; parts: Particle[] = []; debris: Debris[] = [];
  /** Set when a soldier is killed by flame: the body burns. */
  burning = false;
  lastDust = 0; lastSmoke = 0; deathKind: "die1" | "die2" = "die1"; wix = 0;
  caption = "";
  // versus: hit points, automatic fire at the target, and a hook that tells the duel where shots land
  hp = 0; maxHp = 0; auto = false; noGround = false; onImpact: ((x: number, y: number, w: Weapon) => void) | null = null;

  async load(c: Concept, pal: Palettes, fx: FxMeta, quiet = false) {
    this.concept = c; this.pal = pal; this.fxMeta = fx;
    this.reset(performance.now());
    await Promise.all(Object.entries(c.layers).map(async ([name, L]) => {
      this.enc.set(`${c.id}/${name}`, await loadEncoded(fileUrl(`concepts/${c.id}/${L.sheet}`)));
    }));
    await Promise.all(Object.entries(fx).map(async ([n, f]) => { this.fxImg.set(n, await loadImage(fileUrl(`fx/${f.sheet}`))); }));
    if (!quiet) for (const cue of [...c.weapons.flatMap(w => [w.fire, w.hit]), ...Object.values(c.sounds)]) void this.sound.buffer(cue);
  }

  /** Lineup: the unit alone on a small canvas, turning slowly (hull and turret together), idle animation. */
  drawTurntable(ctx: CanvasRenderingContext2D, t: number, w: number, h: number) {
    const c = this.concept; if (!c) return;
    ctx.clearRect(0, 0, w, h);
    this.x = w / 2; this.y = h * (c.kind === "infantry" ? 0.78 : 0.66);
    this.ang = (t / 1000) * 0.55 + 1.2; this.tang = this.ang; this.mode = "idle";
    if (c.kind === "defence") this.tang = this.ang;
    this.drawUnit(ctx, t);
  }

  reset(t: number) {
    this.mode = this.concept?.kind === "defence" ? "idle" : "idle"; this.modeT0 = t; this.damaged = false; this.firing = null;
    this.fx = []; this.shots = []; this.lines = []; this.parts = []; this.debris = []; this.burning = false;
    if (this.concept?.kind === "defence") { this.x = 150; this.y = 140; } else { this.x = 150; this.y = 130; }
    this.sound.stopAll();
  }

  // ------------------------------------------------------------------ actions
  setMode(m: Mode, t: number) {
    const c = this.concept; if (!c) return;
    if (m === "move" && c.kind === "defence") return;
    if (m === "move" && this.mode !== "move") this.say("move");
    this.mode = m; this.modeT0 = t;
    this.sound.loop("move", c.sounds.move, m === "move", c.kind === "infantry" ? 0 : 0.45);
    if (m === "dead") this.die(t);
    if (m === "build") { this.sound.play(c.sounds.build, { gain: 0.8 }); for (let i = 0; i < 5; i++) this.fx.push({ name: "htrkpuff", x: this.x + (Math.random() - 0.5) * 40, y: this.y + 6 + (Math.random() - 0.5) * 14, t0: t + i * 120 }); }
    if (m === "move") { const a = Math.atan2(this.y - this.path.cy, (this.x - this.path.cx) * this.path.ry / this.path.rx); this.path.phase = a; }
  }

  fire(t: number) {
    const c = this.concept; if (!c || this.mode === "dead" || this.mode === "build" || !c.weapons.length) return;
    if (this.firing || t < this.reloadUntil) return;
    const w = c.weapons[this.wix++ % c.weapons.length];
    this.say("attack");
    this.firing = { w, shotsLeft: w.burst, next: t, muzzle: 0, burstStart: t };
    if (w.kind === "bullet") this.sound.play(w.fire, { gain: 0.9, pan: this.pan(this.x) });
  }

  die(t: number) {
    const c = this.concept!;
    this.firing = null; this.sound.loop("move", undefined, false);
    this.deathKind = Math.random() < 0.5 ? "die1" : "die2";
    if (c.kind === "infantry") { this.sound.play(c.sounds.die ?? "infantry_death", { gain: 0.9 }); return; }
    const big = c.kind === "defence" ? "demtexp" : (c.stats?.armour ?? 3) >= 4 ? "brrlexp1" : "explolrg";
    if (c.air) {     // blown up in the air; the wreck hits the ground a moment later
      const h = c.altitude ?? 30;
      this.fx.push({ name: "explomed", x: this.x, y: this.y - h, t0: t });
      this.fx.push({ name: "explolrg", x: this.x, y: this.y + 4, t0: t + 520 });
      this.sound.play(c.sounds.die, { gain: 1 });
      this.fx.push({ name: "fire01", x: this.x, y: this.y + 2, t0: t + 900, loop: 8000 });
      return;
    }
    this.fx.push({ name: big, x: this.x, y: this.y + 4, t0: t });
    this.fx.push({ name: "explomed", x: this.x + 10, y: this.y - 6, t0: t + 260 });
    this.spawnDebris(t, c.kind === "defence" ? 22 : 16);
    this.sound.play(c.sounds.die, { gain: 1 });
    for (let i = 0; i < 3; i++) this.fx.push({ name: "fire01", x: this.x + (i - 1) * 9, y: this.y + (i % 2) * 4, t0: t + 700 + i * 90, loop: 9000 });
  }

  pan(x: number) { return (x - this.W / 2) / (this.W / 2) * 0.7; }

  /** Wreck chunks thrown out by an explosion: they fly, fall, bounce once and smoke. */
  spawnDebris(t: number, n: number) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 55;
      this.debris.push({ x: this.x, y: this.y - 4, z: 6 + Math.random() * 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5,
        vz: 40 + Math.random() * 70, t0: t + Math.random() * 120, size: 1 + Math.round(Math.random() * 1.5),
        shade: ["#2a2622", "#3d3833", "#5b5f63", "#1c1a18"][k % 4], smoke: 0 });
    }
  }

  /** Incoming fire from off-screen: tracers and a couple of shells that hit the unit (how it gets shot). */
  underFire(t: number) {
    const c = this.concept; if (!c || this.mode === "dead") return;
    const h = c.kind === "infantry" ? 14 : c.kind === "defence" ? 16 : 10;
    const tracer: Weapon = { name: "incoming", kind: "bullet", burst: 1, interval: 0, reload: 0, impact: "piff", fire: "", hit: "impact_bullet" };
    const shell: Weapon = { name: "incoming", kind: "shell", burst: 1, interval: 0, reload: 0, impact: c.kind === "infantry" ? "explosml" : "explomed", fire: "", hit: "impact_shell" };
    for (let k = 0; k < 9; k++) {
      const x1 = this.x + (Math.random() - 0.5) * 16, y1 = this.y - Math.random() * h;
      const sx = -10, sy = this.y - 40 + Math.random() * 60;
      this.shots.push({ kind: "bullet", x0: sx, y0: sy, z0: 0, x1, y1, t0: t + k * 110, dur: 260, arc: 0, w: tracer, seed: Math.random() });
    }
    for (let k = 0; k < 2; k++) {
      this.shots.push({ kind: "shell", x0: this.W + 10, y0: this.y - 60 + k * 30, z0: 0, x1: this.x + (k ? 6 : -5), y1: this.y - h * 0.4, t0: t + 500 + k * 650, dur: 380, arc: 0, w: shell, seed: Math.random() });
    }
    this.sound.play("mg_heavy", { gain: 0.5, pan: -0.8 });
    setTimeout(() => this.sound.play("cannon_light", { gain: 0.45, pan: 0.8 }), 380);
    setTimeout(() => { if (this.concept === c && c.kind !== "infantry") this.damaged = true; }, 1300);
  }

  // ------------------------------------------------------------------ geometry
  hullFacing() { const c = this.concept!; const n = c.kind === "infantry" ? 8 : 32; return facingIndex(this.ang, n); }
  turretFacing() { return facingIndex(this.concept?.turretLocked ? this.ang : this.tang, 32); }
  pivot() {
    const c = this.concept!;
    if (c.kind === "infantry") return [0, 0];
    const p = c.geometry.pivot; return c.kind === "defence" ? p[0] : p[this.hullFacing()];
  }
  muzzle(i: number) {
    const c = this.concept!;
    if (c.kind === "infantry") { const m = c.geometry.muzzles[this.hullFacing()]?.[0] ?? [0, -18]; return [this.x + m[0], this.y + m[1]]; }
    const tf = this.turretFacing(); const ms = c.geometry.muzzles[tf]; const m = ms[i % ms.length]; const pv = this.pivot();
    return [this.x + pv[0] + m[0], this.y + pv[1] + m[1]];
  }

  // ------------------------------------------------------------------ simulation
  update(t: number, dt: number) {
    const c = this.concept; if (!c) return;
    const speed = c.kind === "infantry" ? 16 : 10 + (c.stats?.speed ?? 2) * 7;
    if (this.mode === "move") {
      const p = this.path; p.phase += (speed / ((p.rx + p.ry) / 2)) * dt;
      const nx = p.cx + Math.cos(p.phase) * p.rx, ny = p.cy + Math.sin(p.phase) * p.ry;
      const dx = nx - this.x, dy = ny - this.y;
      if (Math.hypot(dx, dy) > 0.01) this.ang = angleOf(dx, dy);
      this.x = nx; this.y = ny;
      if (c.kind === "vehicle" && !c.air && !c.hover && t - this.lastDust > 140) {
        this.lastDust = t;
        const back = [-Math.sin(this.ang) * 0, 0];
        this.fx.push({ name: "htrkpuff", x: this.x - dx * 6 + back[0], y: this.y - dy * 6 + 3, t0: t, scale: 0.6, alpha: 0.6 });
      }
    }
    // turret (or the whole infantry/turretless unit) turns to the target while firing
    if (this.mode !== "dead" && this.mode !== "build") {
      const want = angleOf(this.target.x - this.x, this.target.y - this.y);
      const turretless = c.kind === "infantry" || !c.layers.turret || c.turretLocked;
      if (turretless) {
        if (this.firing && this.mode !== "move") { const d = angDiff(this.ang, want); this.ang += Math.sign(d) * Math.min(Math.abs(d), 4 * dt); }
      } else if (c.spin && !this.firing) {
        this.tang += dt * 1.4;
      } else {
        const d = angDiff(this.tang, want);
        const rate = 2.6;
        if (Math.abs(d) > 0.02) { this.tang += Math.sign(d) * Math.min(Math.abs(d), rate * dt); if (Math.abs(d) > 0.4) this.sound.play(c.sounds.turret, { gain: 0.35, minGap: 1100 }); }
      }
    }
    // firing
    const f = this.firing;
    if (f && t >= f.next) {
      const aimed = c.kind === "infantry" || !c.layers.turret || Math.abs(angDiff(c.turretLocked ? this.ang : this.tang, angleOf(this.target.x - this.x, this.target.y - this.y))) < 0.12;
      if (aimed) {
        this.shoot(f.w, f.muzzle, t);
        f.muzzle++; f.shotsLeft--; f.next = t + f.w.interval;
        if (f.shotsLeft <= 0) { this.firing = null; this.reloadUntil = t + (this.auto ? f.w.reload : Math.min(f.w.reload, 1600)); }
      }
    }
    if (this.auto && !this.firing && this.mode !== "dead" && this.mode !== "build" && t >= this.reloadUntil) this.fire(t);
    // shots
    for (const s of this.shots) {
      const u = (t - s.t0) / s.dur;
      if ((s.kind === "rocket" || s.kind === "missile") && u > 0 && u < 1 && t - (s.lastPuff ?? 0) > 85) {
        s.lastPuff = t; const [x, y] = this.shotPos(s, u);
        this.fx.push({ name: "sgrysmk1", x, y: y + 4, t0: t, scale: 0.42, alpha: 0.55 });
      }
      if (u >= 1 && !s.done) { s.done = true; this.impact(s.w, s.x1, s.y1, t); if (s.w.name === "incoming" && c.kind !== "infantry") this.fx.push({ name: "piffpiff", x: s.x1, y: s.y1, t0: t }); }
    }
    this.shots = this.shots.filter(s => !s.done);
    this.lines = this.lines.filter(l => t - l.t0 < l.dur);
    this.parts = this.parts.filter(p => t - p.t0 < p.life);
    for (const d of this.debris) {
      if (t < d.t0 || (d.z <= 0 && d.vz === 0)) continue;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.vz -= 160 * dt;
      if (d.z <= 0) { d.z = 0; d.vz = Math.abs(d.vz) > 30 ? -d.vz * 0.3 : 0; d.vx *= 0.5; d.vy *= 0.5; }
      if (t - d.smoke > 90 && d.vz !== 0) { d.smoke = t; this.fx.push({ name: "sgrysmk1", x: d.x, y: d.y - d.z + 3, t0: t, scale: 0.3, alpha: 0.5 }); }
    }
    this.debris = this.debris.filter(d => t - d.t0 < 9000);
    if (this.burning && this.mode === "dead" && t - this.lastSmoke > 500) {
      this.lastSmoke = t; this.fx.push({ name: "fire01", x: this.x + (Math.random() - 0.5) * 6, y: this.y + 2, t0: t, scale: 0.6, alpha: 0.95 });
    }
    this.fx = this.fx.filter(e => { const m = this.fxMeta[e.name]; if (!m) return false; return e.loop ? t - e.t0 < e.loop : t - e.t0 < m.count * m.tick; });
    // damage smoke
    if ((this.damaged || this.mode === "dead") && c.kind !== "infantry" && t - this.lastSmoke > (this.mode === "dead" ? 260 : 420)) {
      this.lastSmoke = t;
      this.fx.push({ name: this.mode === "dead" ? "lgrysmk1" : "sgrysmk1", x: this.x + (Math.random() - 0.5) * 18, y: this.y - 8 - Math.random() * 8, t0: t, alpha: 0.85 });
      if (this.damaged && this.mode !== "dead" && Math.random() < 0.35) this.fx.push({ name: "fire01", x: this.x + (Math.random() - 0.5) * 14, y: this.y - 2 - Math.random() * 6, t0: t, scale: 0.55, alpha: 0.9 });
    }
  }

  shoot(w: Weapon, i: number, t: number) {
    const [mx, my] = this.muzzle(w.muzzles?.length ? w.muzzles[i % w.muzzles.length] : i);
    this.fireAnimT0 = t;
    const spread = w.spread ?? (w.kind === "bullet" ? 7 : 3);
    const tx = this.target.x + (Math.random() - 0.5) * spread * 2, ty = this.target.y + (Math.random() - 0.5) * spread;
    const dist = Math.hypot(tx - mx, ty - my);
    const pan = this.pan(mx);
    if (w.kind !== "bullet") this.sound.play(w.fire, { gain: w.kind === "rocket" ? 0.5 : 0.9, pan, minGap: w.kind === "rocket" ? 90 : 0, rate: 0.96 + Math.random() * 0.08 });
    if (w.kind === "beam" || w.kind === "arc" || w.kind === "rail") {
      const dur = w.duration ?? 350;
      const glass = this.pal?.factions[this.faction]?.glass ?? "#7fe8ff";
      if (w.kind === "rail") {
        const ex = tx + (tx - mx) * 0.6, ey = ty + (ty - my) * 0.6;
        this.lines.push({ kind: "rail", x0: mx, y0: my, x1: ex, y1: ey, t0: t, dur: 420, seed: Math.random(), colour: glass });
        this.impact(w, tx, ty, t + 40); this.fx.push({ name: "explosml", x: ex, y: ey, t0: t + 80 });
      } else {
        this.lines.push({ kind: w.kind, x0: mx, y0: my, x1: tx, y1: ty, t0: t, dur, seed: Math.random(), colour: w.kind === "arc" ? "#9fe8ff" : glass });
        for (let k = 0; k < 3; k++) this.fx.push({ name: w.kind === "arc" ? "tstimpct" : "piff", x: tx + (Math.random() - 0.5) * 6, y: ty + (Math.random() - 0.5) * 4, t0: t + k * (dur / 3) });
        this.sound.play(w.hit, { gain: 0.6, pan: this.pan(tx), minGap: 120 });
        if (w.kind === "arc" && (w.chain ?? 0) > 0) {
          const cx = tx + 26, cy = ty + 10;
          this.lines.push({ kind: "arc", x0: tx, y0: ty, x1: cx, y1: cy, t0: t + 90, dur: dur - 90, seed: Math.random(), colour: "#9fe8ff" });
          this.fx.push({ name: "tstimpct", x: cx, y: cy, t0: t + 120 });
        }
      }
      return;
    }
    if (w.kind === "flame") {
      for (let k = 0; k < 46; k++) {
        const a = Math.atan2(ty - my, tx - mx) + (Math.random() - 0.5) * 0.28, sp = 120 + Math.random() * 60;
        this.parts.push({ x: mx, y: my, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t0: t + k * ((w.duration ?? 800) / 46), life: Math.min(900, (dist / sp) * 1000), r: 1.5 });
      }
      this.fx.push({ name: "fire01", x: tx, y: ty + 4, t0: t + 350, loop: 1800 });
      this.fx.push({ name: "fire01", x: tx + 8, y: ty + 7, t0: t + 520, loop: 1500 });
      setTimeout(() => this.sound.play(w.hit, { gain: 0.5, pan: this.pan(tx) }), 350);
      return;
    }
    const speed = w.speed ?? 900;
    const dur = Math.max(80, (dist / speed) * 1000 * ({ mortar: 2.4, missile: 3.2, rocket: 2.4 } as Record<string, number>)[w.kind] || (dist / speed) * 1000);
    const arc = (w.arc ?? 0) * dist;
    this.shots.push({ kind: w.kind, x0: mx, y0: my, z0: 0, x1: tx, y1: ty, t0: t, dur, arc, w, seed: Math.random() });
    if (w.kind === "rocket" || w.kind === "missile" || w.kind === "mortar") this.fx.push({ name: "sgrysmk1", x: mx, y: my + 8, t0: t, scale: 0.8 });
    if (w.kind === "shell") this.fx.push({ name: "sgrysmk1", x: mx, y: my + 8, t0: t, scale: 0.9, alpha: 0.8 });
  }

  shotPos(s: Shot, u: number) {
    const x = s.x0 + (s.x1 - s.x0) * u, y = s.y0 + (s.y1 - s.y0) * u - Math.sin(Math.PI * u) * s.arc;
    return [x, y];
  }

  impact(w: Weapon, x: number, y: number, t: number) {
    this.onImpact?.(x, y, w);
    this.fx.push({ name: w.impact, x, y: y + (w.kind === "bullet" ? 0 : 4), t0: t });
    this.sound.play(w.hit, { gain: w.kind === "bullet" ? 0.35 : 0.8, pan: this.pan(x), minGap: w.kind === "bullet" ? 70 : 60, rate: 0.95 + Math.random() * 0.1 });
  }

  // ------------------------------------------------------------------ drawing
  makeGround() {
    const g = document.createElement("canvas"); g.width = this.W; g.height = this.H;
    const x = g.getContext("2d")!;
    const base = { desert: [176, 154, 112], steppe: [128, 124, 82], urban: [118, 116, 108] }[this.terrain];
    const img = x.createImageData(this.W, this.H);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let j = 0; j < this.H; j++) for (let i = 0; i < this.W; i++) {
      const o = (j * this.W + i) * 4;
      const n = (Math.sin(i * 0.07 + Math.sin(j * 0.11) * 2) + Math.sin(j * 0.13 + i * 0.02)) * 4 + (rnd() - 0.5) * 10;
      const speck = rnd() < 0.012 ? -22 : rnd() < 0.01 ? 14 : 0;
      img.data[o] = base[0] + n + speck; img.data[o + 1] = base[1] + n + speck; img.data[o + 2] = base[2] + n * 0.8 + speck; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    x.strokeStyle = "rgba(0,0,0,0.06)"; x.lineWidth = 1;
    for (let k = -this.H; k < this.W + this.H; k += 30) {
      x.beginPath(); x.moveTo(k, 0); x.lineTo(k + this.H * 2, this.H); x.stroke();
      x.beginPath(); x.moveTo(k, this.H); x.lineTo(k + this.H * 2, 0); x.stroke();
    }
    this.ground = g;
  }

  frameOf(layer: string, index: number) {
    const c = this.concept!; const L = c.layers[layer]; const enc = this.enc.get(`${c.id}/${layer}`);
    if (!L || !enc || !this.pal) return null;
    const sheet = paint(enc, `${c.id}/${layer}`, this.pal, this.faction, this.player);
    const r = Math.floor(index / L.cols), col = index % L.cols;
    return { sheet, sx: col * L.w, sy: r * L.h, L };
  }

  blit(ctx: CanvasRenderingContext2D, layer: string, index: number, x: number, y: number) {
    const f = this.frameOf(layer, index); if (!f) return;
    ctx.drawImage(f.sheet, f.sx, f.sy, f.L.w, f.L.h, Math.round(x - f.L.ax), Math.round(y - f.L.ay), f.L.w, f.L.h);
  }

  seqFrame(name: string, facing: number, t: number, t0: number, loop = true) {
    const c = this.concept!; const s = c.sequences[name]; if (!s) return null;
    let k = Math.floor((t - t0) / s.tick);
    k = loop ? k % s.use.length : Math.min(k, s.use.length - 1);
    const f = s.facings > 1 ? facing % s.facings : 0;
    return { layer: s.layer, index: s.start + f * s.length + s.use[k] };
  }

  drawUnit(ctx: CanvasRenderingContext2D, t: number) {
    const c = this.concept!; const hf = this.hullFacing();
    if (c.kind === "infantry") {
      const fac8 = hf;
      let name = "stand", t0 = this.modeT0, loop = true;
      if (this.mode === "move") name = "run";
      else if (this.mode === "dead") { name = this.deathKind; loop = false; }
      else if (this.mode === "prone") name = t - this.fireAnimT0 < 480 ? "prone-shoot" : "prone-stand";
      else if (t - this.fireAnimT0 < 480) { name = "shoot"; t0 = this.fireAnimT0; }
      else if (this.mode === "idle" && (t - this.modeT0) % 9000 > 6000) { name = "idle1"; t0 = this.modeT0 + Math.floor((t - this.modeT0) / 9000) * 9000 + 6000; loop = false; }
      if (name === "prone-shoot") t0 = this.fireAnimT0;
      const s = this.seqFrame(name, fac8, t, t0, loop); if (s) this.blit(ctx, s.layer, s.index, this.x, this.y);
      return;
    }
    const bob = (c.hover || c.air) && this.mode !== "dead" ? Math.round(Math.sin(t / 260) * (c.air ? 2 : 1.2) - 1) : 0;
    if (c.kind === "vehicle") {
      if (this.mode === "dead") {
        if (c.air && t - this.modeT0 < 520) return;   // still a fireball in the air
        const s = this.seqFrame("husk", hf, t, 0); if (s) this.blit(ctx, s.layer, s.index, this.x, this.y); return;
      }
      if (c.air) { const s = this.seqFrame("move", hf, t, 0); if (s) this.blit(ctx, s.layer, s.index, this.x, this.y + bob); }
      else { const s = this.seqFrame(c.hover ? "idle" : this.mode === "move" ? "move" : "idle", hf, t, this.modeT0); if (s) this.blit(ctx, s.layer, s.index, this.x, this.y + bob); }
    } else {
      if (this.mode === "dead") { this.blit(ctx, "rubble", 0, this.x, this.y); return; }
      if (this.mode === "build") {
        const s = this.seqFrame("build", 0, t, this.modeT0, false);
        if (t - this.modeT0 < 8 * 110) { if (s) this.blit(ctx, s.layer, s.index, this.x, this.y); return; }
        this.mode = "idle";
      }
      this.blit(ctx, "base", 0, this.x, this.y);
    }
    if (c.layers.turret) {
      const tf = this.turretFacing(); const pv = this.pivot();
      const firing = t - this.fireAnimT0 < 4 * 70;
      const s = firing ? this.seqFrame("fire", tf, t, this.fireAnimT0, false) : this.seqFrame("turret", tf, t, 0);
      if (s) this.blit(ctx, s.layer, s.index, this.x + pv[0], this.y + pv[1] + bob);
    }
    if (c.pulse && this.mode !== "build") {
      for (let k = 0; k < 2; k++) {
        const u = ((t / 1700) + k / 2) % 1;
        ctx.strokeStyle = `rgba(127,232,255,${0.55 * (1 - u)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(this.x, this.y - 2, 10 + u * 46, (10 + u * 46) / 2, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  drawFx(ctx: CanvasRenderingContext2D, e: Fx, t: number) {
    const m = this.fxMeta[e.name]; const img = this.fxImg.get(e.name); if (!m || !img || t < e.t0) return;
    let k = Math.floor((t - e.t0) / m.tick); if (e.loop) k %= m.count; if (k >= m.count) return;
    const s = e.scale ?? 1; const w = m.w * s, h = m.h * s;
    ctx.globalAlpha = e.alpha ?? 1;
    ctx.drawImage(img, k * m.w, 0, m.w, m.h, Math.round(e.x - w / 2), Math.round(e.y - h / 2), Math.round(w), Math.round(h));
    ctx.globalAlpha = 1;
  }

  draw(ctx: CanvasRenderingContext2D, t: number) {
    if (!this.ground) this.makeGround();
    ctx.imageSmoothingEnabled = false;
    if (!this.noGround) ctx.drawImage(this.ground!, 0, 0);
    if (this.auto && this.concept && this.mode !== "dead") {     // health bar
      const w = 22, x = Math.round(this.x - w / 2), y = Math.round(this.y - (this.concept.kind === "infantry" ? 40 : 46) - (this.concept.altitude ?? 0));
      ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(x - 1, y - 1, w + 2, 4);
      const f = Math.max(0, this.hp / this.maxHp);
      ctx.fillStyle = f > 0.5 ? "#5fd35f" : f > 0.25 ? "#e8c02a" : "#e0442f"; ctx.fillRect(x, y, Math.round(w * f), 2);
    }
    if (this.auto) { if (!this.concept) return; } else {
    // target marker
    ctx.strokeStyle = "rgba(200,40,30,0.55)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(this.target.x + 0.5, this.target.y + 0.5, 7, 3.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(this.target.x - 10, this.target.y + 0.5); ctx.lineTo(this.target.x - 4, this.target.y + 0.5); ctx.moveTo(this.target.x + 4, this.target.y + 0.5); ctx.lineTo(this.target.x + 10, this.target.y + 0.5); ctx.stroke();
    }
    if (!this.concept) return;
    const behind = this.fx.filter(e => e.y < this.y - 2), front = this.fx.filter(e => e.y >= this.y - 2);
    for (const e of behind) this.drawFx(ctx, e, t);
    this.drawUnit(ctx, t);
    for (const e of front) this.drawFx(ctx, e, t);
    for (const d of this.debris) {
      if (t < d.t0) continue;
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(Math.round(d.x), Math.round(d.y), d.size, 1);
      ctx.fillStyle = d.shade; ctx.fillRect(Math.round(d.x), Math.round(d.y - d.z), d.size + 1, d.size);
    }
    // projectiles
    for (const s of this.shots) {
      const u = (t - s.t0) / s.dur; if (u < 0 || u > 1) continue;
      const [x, y] = this.shotPos(s, u); const [px, py] = this.shotPos(s, Math.max(0, u - 0.06));
      if (s.kind === "bullet") { ctx.strokeStyle = "rgba(255,236,150,0.95)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke(); }
      else if (s.kind === "shell") { ctx.fillStyle = "#fff6c8"; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2); ctx.strokeStyle = "rgba(255,210,120,0.6)"; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke(); }
      else if (s.kind === "mortar") { ctx.fillStyle = "#2a2622"; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2); }
      else { ctx.fillStyle = "#ffe9a8"; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 2); ctx.fillStyle = "#ff8a2a"; ctx.fillRect(Math.round(px), Math.round(py), 2, 2); }
    }
    // beams, arcs, rails
    for (const l of this.lines) {
      const u = (t - l.t0) / l.dur; if (u < 0) continue;
      const fade = l.kind === "rail" ? 1 - u : 1 - Math.max(0, u - 0.7) / 0.3;
      if (l.kind === "arc") {
        const pts: number[][] = []; const n = 9; let sd = Math.floor(t / 45) * 1.7 + l.seed * 100;
        const r = () => { sd = (sd * 9301 + 49297) % 233280; return sd / 233280 - 0.5; };
        for (let i = 0; i <= n; i++) { const v = i / n; pts.push([l.x0 + (l.x1 - l.x0) * v + (i && i < n ? r() * 9 : 0), l.y0 + (l.y1 - l.y0) * v + (i && i < n ? r() * 9 : 0)]); }
        const mid = pts[Math.floor(n / 2)]; const branch = [mid, [mid[0] + r() * 22, mid[1] + 6 + Math.abs(r()) * 14]];
        for (const [lw, col] of [[5, `rgba(120,220,255,${0.32 * fade})`], [2, `rgba(235,250,255,${fade})`]] as const) {
          ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
          ctx.lineWidth = Math.max(1, lw - 2); ctx.beginPath(); ctx.moveTo(branch[0][0], branch[0][1]); ctx.lineTo(branch[1][0], branch[1][1]); ctx.stroke();
        }
      } else {
        const [r, g, b] = hexRgb(l.colour); const flick = l.kind === "beam" ? 0.75 + 0.25 * Math.sin(t / 25) : 1;
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.45 * fade * flick})`; ctx.lineWidth = l.kind === "rail" ? 6 * (0.4 + 0.6 * fade) : 5;
        ctx.beginPath(); ctx.moveTo(l.x0, l.y0); ctx.lineTo(l.x1, l.y1); ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${fade * flick})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(l.x0, l.y0); ctx.lineTo(l.x1, l.y1); ctx.stroke();
      }
    }
    // flame particles
    for (const p of this.parts) {
      const a = (t - p.t0) / p.life; if (a < 0) continue;
      const x = p.x + p.vx * (t - p.t0) / 1000, y = p.y + p.vy * (t - p.t0) / 1000 - a * 6;
      const r = p.r + a * 4;
      ctx.fillStyle = a < 0.3 ? "rgba(255,240,170,0.95)" : a < 0.6 ? "rgba(255,160,40,0.85)" : `rgba(120,60,30,${0.7 * (1 - a)})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
}
