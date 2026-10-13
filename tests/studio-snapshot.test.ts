import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EA_NOTICE, installSnapshotApi } from "../lib/art-lab/studio-snapshot";

test("the shared Studio answers the Studio API from the published snapshot and refuses every write", async () => {
  const seen: string[] = [];
  const window = { location: { href: "https://rtsai.net/faction-studio", origin: "https://rtsai.net" }, fetch: async (input: RequestInfo | URL, _init?: RequestInit) => { void _init; seen.push(String(input)); return new Response("{}"); } };
  (globalThis as unknown as { window: typeof window }).window = window;
  installSnapshotApi({ publishedAt: "2026-10-13T00:00:00Z", rosters: { ra2: "https://x.public.blob.vercel-storage.com/studio/s/1/roster-ra2.json" }, mods: [], state: { units: [] } });
  await window.fetch("/api/art-review/roster?mode=ra2");
  assert.deepEqual(seen, ["https://x.public.blob.vercel-storage.com/studio/s/1/roster-ra2.json"], "rosters come from the hosted snapshot");
  assert.equal((await window.fetch("/api/art-review/roster?mode=mod:nope")).status, 404);
  assert.equal((await window.fetch("/api/art-review/action?mode=ra2", { method: "POST", body: "{}" })).status, 405, "decisions stay in the owner's local Studio");
  assert.deepEqual(await (await window.fetch("/api/art-review/state?mode=ra2")).json(), { units: [] });
  assert.equal((await window.fetch("/api/art-review/duel", {})).status, 404, "native encounters are not part of the shared Studio");
  await window.fetch("https://x.public.blob.vercel-storage.com/studio/a/abc.shp");
  assert.equal(seen.at(-1), "https://x.public.blob.vercel-storage.com/studio/a/abc.shp", "hosted art is fetched as is");
});

test("the shared Studio page shows EA's modding-guideline notice; the repository carries it at its root", () => {
  assert.equal(EA_NOTICE, "EA has not endorsed and does not support this product.");
  assert.match(readFileSync(new URL("../app/faction-studio/SharedStudio.tsx", import.meta.url), "utf8"), /\{EA_NOTICE\}/);
  assert.match(readFileSync(new URL("../NOTICE", import.meta.url), "utf8"), /EA has not endorsed and does not support this product\./);
  assert.match(readFileSync(new URL("../NOTICE", import.meta.url), "utf8"), /no\s+music files/);
});
