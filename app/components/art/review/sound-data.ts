"use client";
/**
 * Actors' sounds as the dev API resolves them, cached per actor and faction. A small external store: only the parts
 * that show or play sounds subscribe, so a reply never re-renders the whole Studio.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { ActorSoundsData } from "./SoundsPanel";

type Entry = ActorSoundsData | "loading" | "error";
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const emit = () => { for (const l of [...listeners]) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** "r2qilin:china" for an actor heard as a faction (faction prefixes pick some voice sets' files). */
export const soundKey = (actor: string, faction: string) => `${actor}:${faction}`;

function load(key: string) {
  if (entries.has(key)) return;
  entries.set(key, "loading");
  const [actor, faction] = key.split(":");
  fetch(`/api/art-review/sounds?mode=ra2&actor=${encodeURIComponent(actor)}&faction=${encodeURIComponent(faction)}`, { cache: "no-store" })
    .then(r => (r.ok ? r.json() as Promise<ActorSoundsData> : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(d => { entries.set(key, d); emit(); }, () => { entries.set(key, "error"); emit(); });
}

/** The actor's sounds (null while loading or without a key), or "error"; starts loading on first use. */
export function useActorSounds(key: string | null): ActorSoundsData | "error" | null {
  useEffect(() => { if (key) load(key); }, [key]);
  const value = useSyncExternalStore(subscribe, () => (key ? entries.get(key) : undefined), () => undefined);
  return value === undefined || value === "loading" ? null : value;
}
