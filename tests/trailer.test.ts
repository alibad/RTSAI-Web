import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildTrailer, findTrailer, trailerFromBuild } from "../lib/trailer";

test("the hero trailer needs both the video and a poster", () => {
  const files = (...paths: string[]) => (path: string) => paths.includes(path);
  assert.equal(findTrailer(files()), null);
  assert.equal(findTrailer(files("/trailer/rtsai-trailer.mp4")), null, "a video without a poster keeps the CompanionDemo");
  assert.equal(findTrailer(files("/trailer/rtsai-trailer-poster.jpg")), null);
  assert.deepEqual(findTrailer(files("/trailer/rtsai-trailer.mp4", "/trailer/rtsai-trailer.webp", "/trailer/rtsai-trailer-poster.jpg")), {
    video: "/trailer/rtsai-trailer.mp4",
    poster: "/trailer/rtsai-trailer-poster.jpg",
  });
});

test("only a well-formed build-time value turns the trailer on", () => {
  const value = JSON.stringify({ video: "/trailer/rtsai-trailer.mp4", poster: "/trailer/rtsai-trailer.webp" });
  assert.deepEqual(trailerFromBuild(value), { video: "/trailer/rtsai-trailer.mp4", poster: "/trailer/rtsai-trailer.webp" });
  for (const bad of [undefined, "", "{", JSON.stringify({ video: "https://example.com/x.mp4", poster: "/trailer/rtsai-trailer.webp" }), JSON.stringify({ video: "/trailer/rtsai-trailer.mp4", poster: "/elsewhere.jpg" })]) {
    assert.equal(trailerFromBuild(bad), null);
  }
  assert.equal(buildTrailer(), null, "unbuilt code (tests) never shows a trailer");
});

test("the trailer autoplays muted, loops inline and respects reduced motion", async () => {
  const source = await readFile(new URL("../app/components/HeroTrailer.tsx", import.meta.url), "utf8");
  const config = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  for (const attribute of ["muted", "loop", "playsInline", "poster={poster}"]) assert.match(source, new RegExp(`\\n\\s+${attribute.replace(/[{}]/g, "\\$&")}\\r?\\n`));
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /element\.autoplay = true/);
  assert.match(source, /Pause trailer/);
  assert.match(config, /"process\.env\.RTSAI_TRAILER"/);
  assert.match(config, /findTrailer\(/);
});
