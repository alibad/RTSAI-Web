/**
 * The shared Studio (rtsai.net/faction-studio) reads a published snapshot instead of the local Studio API.
 *
 * `scripts/publish-studio.ts` runs on the owner's machine, where the game files are: it resolves every roster (RTS AI's
 * factions, the original countries' Westwood art, every mod of the mod library), uploads each art file once to Vercel
 * Blob under its content hash, and writes `data/studio-snapshot.json` with the snapshot's index. In the browser, the
 * shared Studio answers the Studio API's reads from that snapshot; every write is refused (decisions stay local).
 */
import type { ModListing } from "./review-ui";

export type StudioSnapshotIndex = {
  publishedAt: string;
  /** Roster JSON per Studio mode (`ra2`, `classic`, `mod:<id>`), already pointing at the hosted art. */
  rosters: Record<string, string>;
  mods: ModListing[];
  /** An empty review workspace: the shared Studio has no drafts or decisions. */
  state: unknown;
};

/** EA's Command & Conquer modding guidelines require this statement wherever C&C assets are shown. */
export const EA_NOTICE = "EA has not endorsed and does not support this product.";

const API = "/api/art-review";

export function installSnapshotApi(index: StudioSnapshotIndex) {
  const marker = window as unknown as { __studioSnapshot?: boolean };
  if (marker.__studioSnapshot) return;
  marker.__studioSnapshot = true;
  const original = window.fetch.bind(window);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith(API)) return original(input, init);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET") return json({ error: "The shared Studio is read-only." }, 405);
    const path = url.pathname.slice(API.length) || "/", mode = url.searchParams.get("mode") ?? "ra2";
    switch (path) {
      case "/roster": { const target = index.rosters[mode]; return target ? original(target) : json({ error: "This game is not published." }, 404); }
      case "/mods": return json({ mods: index.mods });
      case "/state": return json(index.state);
      case "/stamp": return json({ stamp: index.publishedAt });
      case "/preview": return json({ available: false, branch: null, head: null, actors: {}, unmatched: [] });
      case "/animations": return json({ measuredAt: null, current: null, motionStudy: null });
      default: return json({ error: "Not available in the shared Studio." }, 404);
    }
  };
}
