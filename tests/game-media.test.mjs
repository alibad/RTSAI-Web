import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");

test("ships a complete content-hashed faction archive", async () => {
  const manifest = JSON.parse(await readFile(resolve(projectRoot, "public/game-media/manifest.json"), "utf8"));
  assert.ok(manifest.length >= 200, `expected at least 200 assets, found ${manifest.length}`);
  assert.deepEqual([...new Set(manifest.map((asset) => asset.faction))].sort(), ["china", "iran", "red-sea", "turkey"]);
  assert.ok(new Set(manifest.map((asset) => asset.id)).size === manifest.length, "asset ids must be unique");
  assert.ok(manifest.some((asset) => asset.category === "concept"));
  assert.ok(manifest.some((asset) => asset.category === "live"));
  assert.ok(manifest.some((asset) => asset.category === "unit"));
  assert.ok(manifest.some((asset) => asset.category === "cameo"));
  assert.ok(manifest.some((asset) => asset.category === "effects"));

  for (const asset of manifest) {
    const diskPath = resolve(projectRoot, "public", asset.src.replace(/^\//, ""));
    const bytes = await readFile(diskPath);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
    assert.match(basename(diskPath), new RegExp(`\\.${hash}\\.`), `${asset.id} filename must contain its content hash`);
    assert.equal(bytes.byteLength, asset.bytes, `${asset.id} byte size must match the manifest`);
    assert.ok(asset.width > 0 && asset.height > 0, `${asset.id} must include dimensions`);
    assert.doesNotMatch(asset.sourcePath, /^public\//, `${asset.id} must link back to a game-repository source`);
    assert.doesNotMatch(JSON.stringify(asset), /BeTenshi/i);
  }
});

test("marks fingerprinted gallery media as immutable while keeping the manifest revalidatable", async () => {
  const headers = await readFile(resolve(projectRoot, "public/_headers"), "utf8");
  const syncScript = await readFile(resolve(projectRoot, "scripts/sync-game-media.mjs"), "utf8");
  assert.match(headers, /\/game-media\/\*/);
  assert.match(headers, /max-age=31536000, immutable/);
  assert.match(headers, /manifest\.json[\s\S]*max-age=300, must-revalidate/);
  assert.match(syncScript, /createHash\("sha256"\)/);
  assert.match(syncScript, /RTSAI_GAME_REPO/);
});
