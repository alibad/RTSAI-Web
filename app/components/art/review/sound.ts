"use client";
/**
 * One AudioContext for the whole Studio: created on the first sound after a user gesture (never before one), clips
 * decoded on demand and kept in a small cache, one gain node for the volume. Mute and volume are remembered per
 * browser; sound is on at a moderate volume by default.
 */
import { useSyncExternalStore } from "react";

export type SoundPrefs = { muted: boolean; volume: number };
const KEY = "rtsai-studio-sound";
const DEFAULTS: SoundPrefs = { muted: false, volume: 0.45 };
const MAX_BUFFERS = 96;
/** At most this many clips at once (a replay can fire dozens of shots in a tick). */
const MAX_VOICES = 8;

function readPrefs(): SoundPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SoundPrefs> | null;
    if (saved && typeof saved.muted === "boolean" && typeof saved.volume === "number") return { muted: saved.muted, volume: Math.max(0, Math.min(1, saved.volume)) };
  } catch { /* storage unavailable */ }
  return DEFAULTS;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private playing = new Set<AudioBufferSourceNode>();
  private listeners = new Set<() => void>();
  private prefsValue: SoundPrefs | null = null;
  private gestured = false;

  constructor() {
    if (typeof window === "undefined") return;
    const mark = () => { this.gestured = true; };
    for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, mark, { capture: true, passive: true });
  }

  get prefs(): SoundPrefs { return (this.prefsValue ??= typeof window === "undefined" ? DEFAULTS : readPrefs()); }
  setPrefs(patch: Partial<SoundPrefs>) {
    this.prefsValue = { ...this.prefs, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(this.prefsValue)); } catch { /* storage unavailable */ }
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(this.prefsValue.muted ? 0 : this.prefsValue.volume, this.ctx.currentTime, 0.02);
    if (this.prefsValue.muted) this.stopAll();
    for (const l of [...this.listeners]) l();
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getPrefs = () => this.prefs;

  /** Whether a sound may start now: not muted, and the page has had a user gesture (browsers' autoplay rule). */
  get ready() {
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    return !this.prefs.muted && (this.gestured || Boolean(activation?.hasBeenActive));
  }

  private context() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.prefs.muted ? 0 : this.prefs.volume;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Decodes a clip once (kept in a small cache); null when it cannot be read. */
  load(url: string): Promise<AudioBuffer | null> {
    const hit = this.buffers.get(url);
    if (hit) { this.buffers.delete(url); this.buffers.set(url, hit); return hit; }
    const ctx = this.context();
    const job = fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))).then(b => ctx.decodeAudioData(b)).catch(() => null);
    this.buffers.set(url, job);
    while (this.buffers.size > MAX_BUFFERS) this.buffers.delete(this.buffers.keys().next().value!);
    return job;
  }

  /** Plays a clip now (or `delay` seconds later); resolves to its length in seconds, or null if it did not play. */
  async play(url: string, { delay = 0, gain = 1 }: { delay?: number; gain?: number } = {}): Promise<number | null> {
    if (!this.ready) return null;
    const buffer = await this.load(url);
    if (!buffer || !this.ctx || !this.gain || this.prefs.muted) return null;
    if (this.playing.size >= MAX_VOICES) return null;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    let out: AudioNode = this.gain;
    if (gain !== 1) { const g = this.ctx.createGain(); g.gain.value = gain; g.connect(this.gain); out = g; }
    source.connect(out);
    source.onended = () => { this.playing.delete(source); source.disconnect(); };
    this.playing.add(source);
    source.start(this.ctx.currentTime + Math.max(0, delay));
    return buffer.duration;
  }

  /** One of the clips at random (the engine picks a random variant the same way). */
  playAny(urls: string[], options?: { delay?: number; gain?: number }) {
    return urls.length ? this.play(urls[Math.floor(Math.random() * urls.length)], options) : Promise.resolve(null);
  }

  stopAll() { for (const s of [...this.playing]) { try { s.stop(); } catch { /* already stopped */ } } this.playing.clear(); }
}

export const soundEngine = new SoundEngine();
const serverPrefs = () => DEFAULTS;
export const useSoundPrefs = () => useSyncExternalStore(soundEngine.subscribe, soundEngine.getPrefs, serverPrefs);
