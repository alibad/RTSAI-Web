// Players' saved Earth maps in Firestore (rules: firestore.rules, "Saved maps"). The studio saves them here; the browser
// game (RTSAI-WebGame web/src/net/saved-maps.ts) lists the player's own in skirmish and the multiplayer lobby, and a
// host's guests fetch the match's map by id. maps/{id} is what a list shows (with the preview picture); mapData/{id}
// holds map.yaml and map.bin. Firestore on the free plan: no Storage bucket, and a map is well under 100 KB.
import type { Battlefield } from "./earth-battlefield";
import { getFirebaseFirestore } from "./firebase-client";

export type SavedMapSummary = { saved: string; mapId: string; title: string; place: string; players: number; size: number; created: number; previewUrl: string };
export type SavedMapPlace = { place: string; latitude: number; longitude: number; radius: number; seed: number };

/** A Firestore-style id: 20 letters and digits. */
function newId() {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => alphabet[b % alphabet.length]).join("");
}

async function store() {
  const [db, F] = await Promise.all([getFirebaseFirestore(), import("firebase/firestore")]);
  if (!db) throw new Error("Saving maps needs an account. Sign in and try again.");
  return { db, F };
}

/** Saves a battlefield for its owner; returns the saved map's id (the game opens it with /play/?saved=<id>). */
export async function saveBattlefield(owner: string, map: Battlefield, where: SavedMapPlace): Promise<string> {
  const { db, F } = await store();
  const id = newId(), batch = F.writeBatch(db);
  batch.set(F.doc(db, "mapData", id), { owner, mapId: map.id, yaml: map.yaml, bin: F.Bytes.fromUint8Array(map.bin) });
  batch.set(F.doc(db, "maps", id), {
    owner, mapId: map.id, title: map.title, place: where.place.slice(0, 120),
    latitude: where.latitude, longitude: where.longitude, radius: Math.round(where.radius), seed: Math.round(where.seed),
    size: map.size, players: map.players, preview: F.Bytes.fromUint8Array(map.png), created: F.serverTimestamp(),
  });
  await batch.commit();
  return id;
}

/** The player's saved maps, newest first. */
export async function listSavedMaps(owner: string, max = 40): Promise<SavedMapSummary[]> {
  const { db, F } = await store();
  // An equality filter alone needs no composite index; sorted here.
  const snapshot = await F.getDocs(F.query(F.collection(db, "maps"), F.where("owner", "==", owner), F.limit(max)));
  return snapshot.docs.map((doc) => {
    const d = doc.data(), preview = (d.preview as { toUint8Array?: () => Uint8Array } | undefined)?.toUint8Array?.();
    return {
      saved: doc.id, mapId: String(d.mapId), title: String(d.title), place: String(d.place ?? ""), players: Number(d.players), size: Number(d.size),
      created: (d.created as { toMillis?: () => number } | null)?.toMillis?.() ?? Date.now(),
      previewUrl: preview ? URL.createObjectURL(new Blob([preview.slice()], { type: "image/png" })) : "",
    };
  }).sort((a, b) => b.created - a.created);
}

export async function deleteSavedMap(saved: string) {
  const { db, F } = await store();
  const batch = F.writeBatch(db);
  batch.delete(F.doc(db, "maps", saved));
  batch.delete(F.doc(db, "mapData", saved));
  await batch.commit();
}

/** The browser game, opened on a saved map (same origin: rtsai.net/play proxies the game). */
export function playSavedMapUrl(saved: string) {
  return `/play/?saved=${encodeURIComponent(saved)}`;
}
