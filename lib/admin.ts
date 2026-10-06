/**
 * Admin surfaces (Campaign studio, AI testing, the Studio's review tools) ship only in dev and in admin builds:
 * `RTSAI_ADMIN=1 npm run build`, which the local app (scripts/local-app.ps1) uses. Public builds of rtsai.net leave
 * them out: their routes answer 404 and vite.config.ts swaps their components for empty stubs before bundling.
 * Vite's `define` replaces process.env.RTSAI_ADMIN at build time, so this is a constant in every bundle.
 */
export const ADMIN_BUILD = process.env.RTSAI_ADMIN === "1" || process.env.NODE_ENV !== "production";
