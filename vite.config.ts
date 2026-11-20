import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";
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
  "/faction-art/**": {
    headers: { "cache-control": "public, max-age=31536000, immutable" },
  },
  // The browser game is its own static Vercel project (RTSAI-WebGame, docs/DEPLOY-PUBLIC.md): it carries the
  // isolation headers and precompressed files itself. The page uses relative URLs, so /play needs its trailing slash.
  "/play": { redirect: "/play/" },
  "/play/**": { proxy: "https://rtsai-play.vercel.app/**" },
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
// Admin builds (RTSAI_ADMIN=1, the local app) keep the admin tools; public builds drop them (lib/admin.ts).
const adminBuild = process.env.RTSAI_ADMIN === "1";
const define = { "process.env.RTSAI_TRAILER": JSON.stringify(trailer ? JSON.stringify(trailer) : ""), "process.env.RTSAI_ADMIN": JSON.stringify(adminBuild ? "1" : "") };

// Faction Art Lab Review mode: a dev-server-only API over the local RTSAI-Art workspace. `apply: "serve"`
// keeps it out of every build; the handler also refuses to answer when NODE_ENV is "production".
function artReviewDevApi(): Plugin {
  return {
    name: "rtsai-art-review-dev-api",
    apply: "serve",
    async configureServer(server) {
      if (process.env.NODE_ENV === "production") return;
      const { createArtReviewMiddleware } = await import("./lib/art-lab/review-server");
      const { originalsConfig } = await import("./lib/art-lab/originals");
      const root = process.env.RTSAI_ART_DIR ?? fileURLToPath(new URL("../RTSAI-Art", import.meta.url));
      // Original RA2 units: extracted locally from the player's RA2 content into the gitignored .cache/.
      const originals = originalsConfig(fileURLToPath(new URL(".", import.meta.url)));
      const webRoot = fileURLToPath(new URL(".", import.meta.url));
      server.middlewares.use("/api/art-review", createArtReviewMiddleware({ root, originals, webRoot, previewMod: fileURLToPath(new URL(process.env.RTSAI_PREVIEW_MOD_DIR ?? "../RTSAI-Mod-wt-art-preview", import.meta.url)) }));
      // The admin viewer's Sound desk: decisions to RTSAI-Art/sound-review.json, the mod read in place (dev only).
      const { createSoundReviewMiddleware, soundDeskConfig } = await import("./lib/sound-desk/server");
      server.middlewares.use("/api/sound-review", createSoundReviewMiddleware(soundDeskConfig(webRoot)));
    },
  };
}

// The Review UI ships in production builds as the shared, read-only Faction Studio (/faction-studio), which loads it from
// client code and reads a published snapshot (lib/art-lab/studio-snapshot.ts); its local API above stays dev-only.
// The local route (app/art/review/page.tsx, 404 in production) imports it from a server component: production builds
// swap that one import for an empty stub, keeping a "use client" module out of the server (RSC) graph.
function artReviewLocalRouteStub(): Plugin {
  const stubId = "\0rtsai-art-review-local-route-stub";
  return {
    name: "rtsai-art-review-local-route-stub",
    apply: "build",
    enforce: "pre",
    resolveId(source, importer) {
      return /(^|[\\/])components[\\/]art[\\/]ReviewApp(\.tsx)?$/.test(source) && /[\\/]app[\\/]art[\\/]review[\\/]page\.tsx$/.test(importer ?? "") ? stubId : null;
    },
    load(id) {
      return id === stubId ? "export function ReviewApp() { return null; }\n" : null;
    },
  };
}

// Public builds swap the admin tools that need this machine (AI testing, the AI Arena, the shared-content editor) for
// empty stubs, so their code never reaches an rtsai.net bundle; there the owner sees a card naming what each needs
// (lib/admin.ts). Campaign studio works anywhere and ships, behind the owner's sign-in. Admin builds and dev keep all.
function adminToolsProductionStub(): Plugin {
  // ViewerAdmin: the Faction viewer's admin additions (a Studio link, History over the dev API). SoundDesk: the
  // viewer's Sound desk (audition, choose and regenerate sounds over /api/sound-review).
  const stubs: Record<string, string> = { BehaviorLab: "\0rtsai-admin-stub:BehaviorLab", AiArena: "\0rtsai-admin-stub:AiArena", AccountSharedContentEditor: "\0rtsai-admin-stub:AccountSharedContentEditor", ViewerAdmin: "\0rtsai-admin-stub:ViewerAdmin", SoundDesk: "\0rtsai-admin-stub:SoundDesk" };
  const stubExports: Record<string, string[]> = { SoundDesk: ["SoundDesk", "SoundDeskToggle"], AccountSharedContentEditor: ["SharedContentEditor"] };
  return {
    name: "rtsai-admin-tools-production-stub",
    apply: (_, env) => env.command === "build" && !adminBuild,
    enforce: "pre",
    resolveId(source) {
      const name = /(?:^|[\\/])components[\\/](BehaviorLab|AiArena|AccountSharedContentEditor)(?:\.tsx)?$/.exec(source)?.[1]
        ?? /(?:^|[\\/])(?:components[\\/]art[\\/]viewer[\\/]|\.[\\/])(ViewerAdmin|SoundDesk)(?:\.tsx)?$/.exec(source)?.[1];
      return name ? stubs[name] : null;
    },
    load(id) {
      const name = Object.keys(stubs).find(key => stubs[key] === id);
      return name ? (stubExports[name] ?? [name]).map(fn => `export function ${fn}() { return null; }\n`).join("") : null;
    },
  };
}

// Public builds also drop the Workshop's local-art resolver (lib/unit-art/resolve-local.ts): rtsai.net draws only the
// committed public/art-lab art, so no code that reads the dev-only Studio API or the private originals ships there.
// The local app is an admin build and keeps it.
function localUnitArtProductionStub(): Plugin {
  const stubId = "\0rtsai-local-unit-art-stub";
  return {
    name: "rtsai-local-unit-art-production-stub",
    apply: (_, env) => env.command === "build" && !adminBuild,
    enforce: "pre",
    resolveId(source, importer) { return /(^|[\\/])resolve-local(\.ts)?$/.test(source) && /[\\/]unit-art[\\/]/.test(`${importer ?? ""}/${source}`) ? stubId : null; },
    load(id) { return id === stubId ? "export async function localResolver() { return null; }\n" : null; },
  };
}

// The standalone Studio is a client app. A local Node preview can mount that
// same component directly, avoiding worker/RSC transport startup on Windows.
function artReviewClientPreview(): Plugin {
  return {
    name: "rtsai-art-review-client-preview",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (process.env.NODE_ENV === "production" || req.method !== "GET" || req.url?.split("?")[0] !== "/art/review") return next();
        try {
          const html = await server.transformIndexHtml(req.url, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Faction Studio · Local</title></head><body><div id="art-lab-root"></div><script type="module" src="/app/art/review/local-entry.tsx"></script></body></html>');
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(html);
        } catch (error) { next(error); }
      });
    },
  };
}

// Module workers can split code: the Workshop's unit-art worker loads its local-Studio resolver as a separate chunk that
// only the local app (where the dev-only art API answers) ever fetches.
const worker = { format: "es" as const, plugins: () => [localUnitArtProductionStub()] };

export default defineConfig(async ({ command }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // A frozen dev server (tools/review-preview.mjs, RTSAI_DEV_FROZEN=1) never watches files or hot-reloads: other
  // sessions edit this checkout, and a hot reload of a shared module (the auth provider) breaks the page for
  // whoever is using it. It serves the files as they were when it first read them, until it is restarted.
  const server = process.env.RTSAI_DEV_FROZEN === "1"
    ? { watch: null, hmr: false as const }
    : isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined;

  // Art Lab can use Vite's native Node dev server without a worker transport.
  // This opt-in is serve-only; production always retains its configured host.
  if (command === "serve" && process.env.RTSAI_ARTLAB_NODE_DEV === "1") {
    const { default: react } = await import("@vitejs/plugin-react");
    return {
      server,
      define,
      cacheDir: "node_modules/.vite-art-lab",
      worker,
      optimizeDeps: { include: ["react-dom/client", "react/jsx-runtime", "lucide-react", "zustand", "three", "three/examples/jsm/controls/OrbitControls.js", "next/link", "next/router"] },
      resolve: { alias: Object.fromEntries(["link", "router", "navigation"].map(name => [`next/${name}`, fileURLToPath(new URL(`./node_modules/vinext/dist/shims/${name}.js`, import.meta.url))])) },
      plugins: [artReviewDevApi(), artReviewClientPreview(), artReviewLocalRouteStub(), adminToolsProductionStub(), localUnitArtProductionStub(), tailwindcss(), react()],
    };
  }

  // Vercel is the canonical production host. Nitro packages the Vinext
  // application as a Vercel-compatible server and static asset bundle.
  if (isVercelBuild) {
    const { nitro } = await import("nitro/vite");
    return {
      server,
      define,
      worker,
      plugins: [artReviewDevApi(), artReviewLocalRouteStub(), adminToolsProductionStub(), localUnitArtProductionStub(), tailwindcss(), vinext(), nitro({ routeRules: vercelRouteRules })],
    };
  }

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server,
    define,
    worker,
    plugins: [
      artReviewDevApi(),
      artReviewLocalRouteStub(),
      adminToolsProductionStub(),
      localUnitArtProductionStub(),
      vinext(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
