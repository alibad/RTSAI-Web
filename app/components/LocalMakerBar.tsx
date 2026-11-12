"use client";
/**
 * The maker bar on the website's own maker pages (the Workshop and the Viewer) in the local app, where it stands in
 * for the public header (SiteChrome.tsx). It reads where it is from the address: the bar's links are full page loads.
 */
import { useSyncExternalStore } from "react";
import { MakerBar, type MakerPlace } from "./MakerBar";

const never = () => () => {};
const placeOf = (path: string): MakerPlace | null =>
  path.startsWith("/workshop/arena") ? "arena" : path.startsWith("/workshop/evals") ? "evals" : path.startsWith("/workshop/campaigns") ? "campaigns"
    : path.startsWith("/workshop") ? "map" : path.startsWith("/viewer") ? "viewer" : null;

export function LocalMakerBar() {
  // "path|mode": the page's place, and the game mode the Workshop pages carry (ra2, or ra for Classic).
  const here = useSyncExternalStore(never, () => `${window.location.pathname}|${new URLSearchParams(window.location.search).get("mode") === "ra" ? "ra" : "ra2"}`, () => "|ra2");
  const [path, mode] = here.split("|");
  const classic = mode === "ra" ? { map: "/workshop?mode=ra", campaigns: "/workshop/campaigns?mode=ra", arena: "/workshop/arena?mode=ra", evals: "/workshop/evals?mode=ra" } : undefined;
  // The wrapper marks the page as a local maker page (maker-bar.css lifts the bar to the very top).
  return <div className="maker-local" style={{ display: "contents" }}><MakerBar active={placeOf(path)} hrefs={classic} /></div>;
}
