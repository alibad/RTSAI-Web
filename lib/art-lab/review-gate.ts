/**
 * The Art Lab's Review mode exists only in local development (`npm run dev`). Production builds replace
 * process.env.NODE_ENV with "production", so every branch guarded by this function is dead code there, and
 * the dev-only review API is a Vite dev-server middleware that production builds never include.
 */
export function reviewEnabled(env: string | undefined = process.env.NODE_ENV) {
  return env !== "production";
}
