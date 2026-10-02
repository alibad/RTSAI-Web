import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vinext from "vinext";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { findTrailer } from "./lib/trailer";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const isVercelBuild = process.env.VERCEL === "1" || process.env.NITRO_PRESET === "vercel";

const vercelRouteRules = {
  "/game-media/manifest.json": {
    headers: { "cache-control": "public, max-age=300, must-revalidate" },
  },
  "/game-media/**": {
    headers: { "cache-control": "public, max-age=31536000, immutable" },
  },
};

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: [],
  r2_buckets: [],
};

// The homepage hero shows the gameplay trailer only when public/trailer/ holds
// the video and its poster at build time (see lib/trailer.ts).
const publicDirectory = fileURLToPath(new URL("./public", import.meta.url));
const trailer = findTrailer((publicPath) => existsSync(`${publicDirectory}${publicPath}`));
const define = { "process.env.RTSAI_TRAILER": JSON.stringify(trailer ? JSON.stringify(trailer) : "") };

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const server = isCodexSeatbeltSandbox
    ? { watch: { useFsEvents: false, usePolling: true } }
    : undefined;

  // Vercel is the canonical production host. Nitro packages the Vinext
  // application as a Vercel-compatible server and static asset bundle.
  if (isVercelBuild) {
    const { nitro } = await import("nitro/vite");
    return {
      server,
      define,
      plugins: [tailwindcss(), vinext(), nitro({ routeRules: vercelRouteRules })],
    };
  }

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server,
    define,
    plugins: [
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
