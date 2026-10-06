/**
 * Local unit art, loaded by the worker only when the dev-only Studio API answers on the same origin (the local app at
 * http://127.0.0.1:3450). It picks art the way the Studio's "in game now" view does:
 *
 *   1. the candidate the local preview mod installs for the actor (prerendered vehicle sprites, uniformed infantry,
 *      new voxels), matched by bytes (`/preview`), drawn with the Studio's own stage item (versions.ts);
 *   2. otherwise the main mod's art for the actor (`/roster` stock specs: the mod's files, or for an original unit
 *      the player's RA2 files from the private, gitignored originals cache).
 *
 * Nothing here runs on the public site: the API does not exist there and this module is never imported.
 */
import type { RosterPayload } from "../art-lab/originals";
import type { PreviewStatus } from "../art-lab/chain";
import type { ReviewState } from "../art-lab/review";
import type { FireRules } from "../art-lab/fire";
import { candidateFire, stageItem, type ReviewUnit } from "../../app/components/art/review/versions";
import type { ActorRef, ArtItem, ArtSource } from "./types";

const API = "/api/art-review";
async function json<T>(path: string): Promise<T | null> {
  try { const r = await fetch(`${API}/${path}`, { cache: "no-store" }); return r.ok ? await r.json() as T : null; } catch { return null; }
}

export async function localResolver(mode: "ra" | "ra2") {
  const studioMode = mode === "ra2" ? "ra2" : "classic";
  const roster = await json<RosterPayload>(`roster?mode=${studioMode}`);
  if (!roster) return null;
  // The preview overlay is an RA2 mod branch; Classic has none.
  const preview = mode === "ra2" ? await json<PreviewStatus>("preview?mode=ra2") : null;
  const installed = preview?.available ? Object.values(preview.actors).some(a => a.model) : false;
  let state: Promise<ReviewState | null> | null = null;
  const origins = new Map(roster.factions.flatMap(f => f.units.map(u => [u.id, u.origin] as const)));
  const fireRules = (actor: string, source: "main" | "preview") => json<FireRules>(`fire?mode=ra2&actor=${encodeURIComponent(actor)}&source=${source}`);

  return async (actor: ActorRef): Promise<{ item: ArtItem; source: ArtSource; key: string } | null> => {
    const stock = roster.stock[actor.id];
    if (!stock) return null;
    const fires = mode === "ra2" && ["vehicle", "ship", "aircraft"].includes(actor.category);
    const model = installed ? preview?.actors[actor.id]?.model ?? null : null;
    if (model) {
      state ??= json<ReviewState>("state?mode=ra2");
      const candidate = (await state)?.units.find(u => u.actor === actor.id)?.candidates.find(c => c.id === model) ?? null;
      if (candidate) {
        const unit: ReviewUnit = { id: actor.id, factionId: "", factionName: "", name: stock.info?.name ?? actor.id, category: stock.spec.category, role: "", catalog: null, queue: "", order: 0, spec: stock.spec, sprite: stock.sprite };
        const fire = fires ? candidateFire({ main: null, preview: await fireRules(actor.id, "preview") }, candidate) : null;
        const item = stageItem(unit, candidate, preview?.actors[actor.id]?.animations ?? null, fire);
        if (item) return { item: { spec: item.spec, sprite: item.sprite, fire: item.fire ?? null }, source: "preview", key: `preview:${actor.id}:${candidate.id}` };
      }
    }
    const origin = origins.get(actor.id) ?? "original";
    const fire = fires ? await fireRules(actor.id, "main") : null;
    return { item: { spec: stock.spec, sprite: stock.sprite, fire }, source: origin === "original" ? "original" : "game", key: `${mode}:${actor.id}` };
  };
}
