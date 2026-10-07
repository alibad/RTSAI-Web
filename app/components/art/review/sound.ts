"use client";
/**
 * One sound engine for the Studio and the Faction viewer: clips are fetched and decoded on demand by the browser's
 * media pipeline (a small pool of audio elements, at most a few at once), never before a user gesture, under one
 * volume and mute. Mute and volume are remembered per browser; sound is on at a moderate volume by default.
 *
 * Why not a Web Audio context: creating an AudioContext is a synchronous call into the browser that measured
 * 170-640 ms on the main thread here (a frozen frame on the first sound); media elements set up their output off
 * the main thread, so playing a clip costs nothing a player can see.
 */
import { useSyncExternalStore } from "react";

export type SoundPrefs = { muted: boolean; volume: number };
const KEY = "rtsai-studio-sound";
const DEFAULTS: SoundPrefs = { muted: false, volume: 0.45 };
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
  private playing = new Map<HTMLAudioElement, number>();
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
    for (const [el, gain] of this.playing) el.volume = Math.min(1, this.prefsValue.volume * gain);
    if (this.prefsValue.muted) this.stopAll();
    for (const l of [...this.listeners]) l();
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getPrefs = () => this.prefs;

  /** Whether a sound may start now: not muted, and the page has had a user gesture (browsers' autoplay rule). */
  get ready() {
    if (typeof navigator === "undefined") return false;
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    return !this.prefs.muted && (this.gestured || Boolean(activation?.hasBeenActive));
  }

  /** Plays a clip now (or `delay` seconds later); resolves to its length in seconds, or null if it did not play. */
  async play(url: string, { delay = 0, gain = 1 }: { delay?: number; gain?: number } = {}): Promise<number | null> {
    if (!this.ready || this.playing.size >= MAX_VOICES) return null;
    // Start after the frame that answers the click has painted: a sound a frame later is not heard as late.
    await afterPaint();
    if (delay > 0) await new Promise(r => setTimeout(r, delay * 1000));
    if (this.prefs.muted) return null;
    const el = new Audio(url);
    el.preload = "auto";
    el.volume = Math.min(1, this.prefs.volume * gain);
    this.playing.set(el, gain);
    const done = () => { this.playing.delete(el); el.removeAttribute("src"); };
    el.addEventListener("ended", done, { once: true });
    el.addEventListener("error", done, { once: true });
    try {
      await el.play();
      if (!Number.isFinite(el.duration) || !el.duration) await new Promise(r => el.addEventListener("loadedmetadata", r, { once: true }));
      return Number.isFinite(el.duration) ? el.duration : 1;
    } catch { done(); return null; }
  }

  /** One of the clips at random (the engine picks a random variant the same way). */
  playAny(urls: string[], options?: { delay?: number; gain?: number }) {
    return urls.length ? this.play(urls[Math.floor(Math.random() * urls.length)], options) : Promise.resolve(null);
  }

  stopAll() { for (const el of [...this.playing.keys()]) { el.pause(); el.removeAttribute("src"); } this.playing.clear(); }
}

const afterPaint = () => new Promise<void>(resolve => {
  if (typeof requestAnimationFrame === "undefined" || document.hidden) { resolve(); return; }
  requestAnimationFrame(() => setTimeout(resolve, 0));
});

export const soundEngine = new SoundEngine();
const serverPrefs = () => DEFAULTS;
export const useSoundPrefs = () => useSyncExternalStore(soundEngine.subscribe, soundEngine.getPrefs, serverPrefs);
