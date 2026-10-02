/**
 * The homepage hero shows a real gameplay trailer only when both files exist in
 * `public/trailer/` at build time; otherwise it keeps the CompanionDemo.
 *
 * vite.config.ts runs {@link findTrailer} against the public directory and
 * inlines the result as `process.env.RTSAI_TRAILER` (a JSON string, or "" when
 * there is no trailer). Unbuilt code, such as unit tests, sees no trailer.
 */

export const TRAILER_VIDEO_PATH = "/trailer/rtsai-trailer.mp4";

/** Accepted poster names, in order of preference. */
export const TRAILER_POSTER_PATHS = [
  "/trailer/rtsai-trailer-poster.jpg",
  "/trailer/rtsai-trailer-poster.webp",
  "/trailer/rtsai-trailer-poster.png",
  "/trailer/rtsai-trailer.jpg",
  "/trailer/rtsai-trailer.webp",
  "/trailer/rtsai-trailer.png",
] as const;

export type Trailer = { video: string; poster: string };

/** `exists` receives a public URL path such as `/trailer/rtsai-trailer.mp4`. */
export function findTrailer(exists: (publicPath: string) => boolean): Trailer | null {
  if (!exists(TRAILER_VIDEO_PATH)) return null;
  const poster = TRAILER_POSTER_PATHS.find((path) => exists(path));
  return poster ? { video: TRAILER_VIDEO_PATH, poster } : null;
}

/** Parses the build-time value; anything unexpected means "no trailer". */
export function trailerFromBuild(value: string | undefined): Trailer | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Trailer>;
    if (parsed.video !== TRAILER_VIDEO_PATH) return null;
    if (!TRAILER_POSTER_PATHS.some((path) => path === parsed.poster)) return null;
    return { video: parsed.video, poster: parsed.poster as string };
  } catch {
    return null;
  }
}

export function buildTrailer() {
  return trailerFromBuild(process.env.RTSAI_TRAILER);
}
