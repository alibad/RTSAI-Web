import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");

test("ships the Vinext runtime through Vercel's build output API", async () => {
  const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
  const vercelConfig = JSON.parse(await readFile(resolve(projectRoot, "vercel.json"), "utf8"));
  const viteConfig = await readFile(resolve(projectRoot, "vite.config.ts"), "utf8");

  assert.equal(packageJson.scripts["vercel-build"], "vite build");
  assert.equal(vercelConfig.buildCommand, "npm run vercel-build");
  assert.equal("outputDirectory" in vercelConfig, false, "Nitro owns .vercel/output through the Build Output API");
  assert.match(viteConfig, /process\.env\.VERCEL === "1"/);
  assert.match(viteConfig, /nitro\/vite/);
  assert.match(viteConfig, /tailwindcss\(\), vinext\(\), nitro\(\{ routeRules: vercelRouteRules \}\)/);
});

test("preserves immutable faction media caching on Vercel", async () => {
  const viteConfig = await readFile(resolve(projectRoot, "vite.config.ts"), "utf8");

  assert.match(viteConfig, /"\/game-media\/\*\*"[\s\S]*max-age=31536000, immutable/);
  assert.match(viteConfig, /"\/game-media\/manifest\.json"[\s\S]*max-age=300, must-revalidate/);
});
