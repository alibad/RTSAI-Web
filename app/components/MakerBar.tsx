"use client";
/**
 * The one navigation of the maker tools (owner, 12 November 2026): the same bar on every maker page of the local app
 * (the Faction Studio, the Concept Forge, the Workshop pages and the Viewer), in four groups by what you make. Before
 * it there were four menus that did not link to each other: the Studio's tabs and wordless icons, the website header,
 * the Workshop's row and the game's menu.
 *
 * It holds navigation only: a page's own controls stay in the page. The links are plain <a>, because the Studio pages
 * are a standalone build served beside the website (scripts/art-lab-preview.ts). The game is its own app, so its
 * entries (Battle simulator, Map editor, Play) open in a new tab and the bar stays where it was.
 *
 * The read-only Studio on rtsai.net (`shared`) shows the same bar with only what players can open.
 */
import { useSyncExternalStore } from "react";
import "./maker-bar.css";

export type MakerPlace = "board" | "unit" | "forge" | "viewer" | "simulator" | "map" | "campaigns" | "arena" | "evals" | "play";

type Item = {
  id: MakerPlace; label: string; href: string; title: string;
  /** Only in the local app: the owner's tools. */
  own?: boolean;
  /** A page of the website or the game: needs the website beside the Studio. */
  site?: boolean;
  /** The game, a separate app: opens in a new tab. */
  game?: boolean;
};

const GROUPS: { label: string; items: Item[] }[] = [
  { label: "Units", items: [
    { id: "board", label: "Review board", href: "/art/review?view=board", own: true, title: "Every new unit beside the art in the game today: approve or reject" },
    { id: "unit", label: "Unit studio", href: "/art/review", title: "One unit close up: its art, animations, sounds and checks" },
    { id: "forge", label: "Concept Forge", href: "/art/forge", own: true, title: "New unit ideas, on the stage" },
    { id: "viewer", label: "Viewer", href: "/viewer", site: true, title: "The factions and their units as players see them" },
  ] },
  { label: "Battles", items: [
    { id: "simulator", label: "Battle simulator", href: "/play/?mode=sandbox", site: true, game: true, title: "The game's own simulation: place units for two sides and fight (opens the game)" },
    // The game's own editor, not the website's old /workshop (owner, 14 Oct and 15 Nov 2026): one editor and one
    // simulator, both in the game. Its "Test in simulator" opens the Battle simulator on the map.
    { id: "map", label: "Map editor", href: "/play/?mode=editor", site: true, game: true, title: "The game's map editor: a real place, a random or a blank map, then test it in the Battle simulator (opens the game)" },
    { id: "campaigns", label: "Campaigns", href: "/workshop/campaigns?mode=ra2", own: true, site: true, title: "Campaign studio: the story, the missions and their briefings" },
  ] },
  { label: "AI", items: [
    { id: "arena", label: "Arena", href: "/workshop/arena?mode=ra2", own: true, site: true, title: "AI Arena: brains play the live game against the built-in AIs and you" },
    { id: "evals", label: "AI testing", href: "/workshop/evals?mode=ra2", own: true, site: true, title: "How the AI behaves, measured" },
  ] },
  { label: "Game", items: [
    { id: "play", label: "Play", href: "/play/", site: true, game: true, title: "Play the game (opens the game)" },
  ] },
];

const never = () => () => {};
/** The local app serves the website beside the Studio and marks the Studio's pages for it (scripts/local-app.ps1). */
export const useSiteBeside = () => useSyncExternalStore(never, () => document.body.dataset.site === "1", () => false);

export function MakerBar({ active, shared = false, site = true, hrefs, onPick }: {
  /** Where this page is. */
  active: MakerPlace | null;
  /** The read-only Studio on rtsai.net: only what players can open. */
  shared?: boolean;
  /** False when the Studio runs without the website beside it: only its own pages are listed. */
  site?: boolean;
  /** Links that carry what the page has open (the Viewer and the simulator open on the Studio's unit). */
  hrefs?: Partial<Record<MakerPlace, string | undefined>>;
  /** A place this page shows itself (the Studio's board and unit studio): return true to stay on the page. */
  onPick?: (id: MakerPlace) => boolean;
}) {
  const groups = GROUPS.map(g => ({ ...g, items: g.items.filter(i => (!i.own || !shared) && (!i.site || site)) })).filter(g => g.items.length);
  return (
    <header className="maker-bar">
      <a className="maker-brand" href={shared ? "/faction-studio" : "/art/review"} title="Faction Studio">
        {/* eslint-disable-next-line @next/next/no-img-element -- also rendered by the standalone Studio build */}
        <img src="/brand/faction-studio/icon-192.png?v=command-red-2531" width={24} height={24} alt="" />
        <b>Faction Studio</b><span>{shared ? "SHARED" : "LOCAL"}</span>
      </a>
      <nav className="maker-nav" aria-label="Maker tools">
        {groups.map(g => (
          <div className="maker-group" key={g.label} role="group" aria-label={g.label}>
            <small aria-hidden="true">{g.label}</small>
            <div>{g.items.map(i => (
              <a key={i.id} href={hrefs?.[i.id] ?? (shared && i.id === "unit" ? "/faction-studio" : i.href)} title={i.title} aria-current={active === i.id ? "page" : undefined}
                {...(i.game ? { target: "_blank", rel: "noreferrer" } : {})}
                onClick={e => { if (!e.metaKey && !e.ctrlKey && !e.shiftKey && onPick?.(i.id)) e.preventDefault(); }}>
                {i.label}{i.game ? <i aria-hidden="true">↗</i> : null}
              </a>
            ))}</div>
          </div>
        ))}
      </nav>
    </header>
  );
}
