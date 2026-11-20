"use client";
/**
 * Faction Studio > Concept Forge (local only): exploratory soldiers, vehicles and defences made by RTSAI-Art
 * tools/forge, next to the game's own units. The page opens as a wall of pictures; a click puts one on the stage,
 * and the wall stays beside it as a list (with its search and filters) unless the owner hides it.
 *   Originals   concepts rendered by the forge (forge_build.py, forge_infantry.py): soldiers, vehicles, defences and
 *               base buildings (forge_buildings.py, every building shape in every faction's style)
 *   Mixes       every rendered turret on every hull or base it fits (forge_mix.py): thousands, with no files of their
 *               own; a mix's art is built here from its two donors' art
 *   Game units  the game's own units, exactly as the Faction viewer has them
 *   Story       a faction's war in chapters, each chapter with the units that enter it (stories.ts); every unit on
 *               the stage shows its own story beside it
 * All of them play on the Faction viewer's stage (ViewerStage: the game's sprite format, its animations, the
 * rules-driven Attack demo and Versus), so the Forge has no stage, effects or sounds of its own. A faction changes
 * only a concept's paint, so there is no paint mode: a concept wears its own faction's colours until it is given to
 * another. Drafts live in D:\Generated\RTSAI\art\concept-forge (lib/concept-forge/server.ts); nothing here changes
 * the game.
 */
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FrameStore, type StageItem } from "../art/review/frames";
import { soundEngine, useSoundPrefs } from "../art/review/sound";
import { ViewerStage, type Opponent } from "../art/viewer/ViewerStage";
import { playAction, shownSounds, weaponSounds } from "../art/viewer/FactionViewer";
import { decodePal, type Palette } from "../../../lib/art-lab/pal";
import type { ViewerDummy } from "../../../lib/weapon-demo";
import type { ViewerUnit } from "../../../lib/viewer";
import type { PublicClip } from "../../../lib/faction-audio";
import { actionSounds, API, conceptItem, conceptSounds, conceptWeapons, forgeFile, mixArt, type ConceptArt, type ConceptGame, type Voices } from "./stage-item";
import { MakerBar, useSiteBeside } from "../MakerBar";
import { OptionSelect } from "../ui/fields";
import { Flag } from "../art/review/Chrome";
import { initials, portraitSrc, storyOf, type Chapter, type Person, type Stories, type UnitStory } from "./stories";
import "../art/viewer/viewer.css";
import "./forge.css";

type Faction = { name: string; paint: string; dark: string };
type Concept = {
  id: string; kind: "infantry" | "vehicle" | "defence" | "building"; name: string; idea: string; description: string; role: string;
  factions: string[]; faction: string; stats: Record<string, number>; built?: string; weapons?: { kind: string }[];
  layers: Record<string, { count: number }>; art: ConceptArt | null;
};
/** A mix in catalogue.json (forge_mix.py): n name, r role, k kind, f faction, ff fits, h hull donor, t turret donor,
 *  s [armour, firepower, speed, range], w weapon kinds, i idea, d description. */
type Mix = { id: string; n: string; r: string; k: "vehicle" | "defence"; f: string; ff: string[]; h: string; t: string; s: number[]; w: string[]; i: string; d: string };
type Catalogue = { built: string; cell: [number, number]; cols: number; per: number; sheets: number; hulls: number; turrets: number; mixes: Mix[] };
type Routing = Record<string, { factions: string[]; verdict: string | null; note: string; at: string }>;
type Index = { palettes: { factions: Record<string, Faction> }; concepts: Concept[]; routing: Routing; voices?: Voices; game: ConceptGame | null; dummies: ViewerDummy[] };
/** The game's own units, as the Faction viewer has them (GET /api/concept-forge/game-units). */
type GameUnits = { factions: { id: string; name: string; units: ViewerUnit[] }[]; effects: Record<string, PublicClip> };
/** One picture on the wall: an original (at -1), a mix (its place in the catalogue, which is where its picture is) or
 *  a game unit (at -2, with the game's own cameo and its faction's name as the group). */
type Entry = { id: string; name: string; role: string; kind: string; faction: string; weapons: string[]; at: number; h?: string; t?: string; cameo?: string | null; group?: string };
type Source = "originals" | "mixes" | "game" | "story";

const KINDS = [["all", "All"], ["infantry", "Soldiers"], ["vehicle", "Vehicles"], ["defence", "Defences"], ["building", "Buildings"]] as const;
/** The weapon filter: a short fixed list, each with its colour (the colour of that weapon's shot). */
const WEAPONS = [["any", "Any weapon", "#8a8f80"], ["shell", "Guns", "#e0b84a"], ["bullet", "Machine guns, autocannon", "#e8e1c4"], ["rocket", "Rockets", "#ef7a3c"],
  ["missile", "Missiles", "#f4f4fa"], ["mortar", "Mortars, howitzers", "#b08654"], ["beam", "Beams", "#6fe3ff"], ["arc", "Arc", "#9db4ff"],
  ["flame", "Flame", "#ff9230"], ["rail", "Rail", "#bb8cff"], ["none", "Unarmed", "#5c5f58"]] as const;
const WEAPON_OPTIONS = WEAPONS.map(([value, label, colour]) => ({ value, label, leading: <i className="cf-wdot" style={{ background: colour }} /> }));
/** The flag table keys Saudi Arabia as "saudi". */
const flagId = (faction: string) => (faction === "saudi-arabia" ? "saudi" : faction);
const KIND_GROUP: Record<string, string> = { infantry: "Concepts: soldiers", vehicle: "Concepts: vehicles", defence: "Concepts: defences", building: "Concepts: buildings" };
const PLAYER = "F21818";   // the stage's red (houseColors)
const STEP = 240;          // pictures added to the wall each time its end comes into view
const NEAR = 4;            // neighbours shown on each side under the stage
const NO_CONCEPTS: Concept[] = [];
const NO_MIXES: Mix[] = [];
const count = (n: number) => n.toLocaleString("en-US");
/** The part of a 128x96 list picture that ever holds anything (measured over every original): the wall shows only that. */
const CROP = { x: 16, y: 4, w: 96, h: 88 };

/** The list picture of an original: the concept in a faction's paint (forge_export.py cameo-<faction>.png); soldiers at double size. */
function Thumb({ id, kind, faction }: { id: string; kind: string; faction: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const x = ref.current?.getContext("2d"); if (!x) return;
      x.imageSmoothingEnabled = false; x.clearRect(0, 0, CROP.w, CROP.h);
      if (kind === "infantry") x.drawImage(img, 40, 32, CROP.w / 2, CROP.h / 2, 0, 0, CROP.w, CROP.h); else x.drawImage(img, -CROP.x, -CROP.y);
    };
    img.src = forgeFile(`concepts/${id}/art/cameo-${faction}.png`);
  }, [id, kind, faction]);
  return <canvas ref={ref} width={CROP.w} height={CROP.h} className="cf-thumb" />;
}

/** Picture sheets by URL (64 mixes to a sheet), and the one scratch canvas their pixels are read through. */
const sheets = new Map<string, Promise<HTMLImageElement>>();
function sheet(url: string) {
  let p = sheets.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = url; });
    sheets.set(url, p);
  }
  return p;
}
let scratch: CanvasRenderingContext2D | null = null;
function scratchFor(w: number, h: number) {
  if (!scratch || scratch.canvas.width !== w || scratch.canvas.height !== h) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    scratch = cv.getContext("2d", { willReadFrequently: true });
  }
  return scratch!;
}

/** The list picture of a mix: its cell of a picture sheet, which holds palette indices, painted with a faction's palette. */
function MixThumb({ at, cat, version, palette }: { at: number; cat: Catalogue; version: number; palette: Palette | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [cw, ch] = cat.cell, { per, cols } = cat;
  useEffect(() => {
    if (!palette) return;
    let live = true;
    const page = Math.floor(at / per), cell = at % per;
    void sheet(`${forgeFile(`atlas/mix-${String(page).padStart(3, "0")}.png`)}?v=${version}`).then(img => {
      const cv = ref.current;
      if (!live || !cv) return;
      const s = scratchFor(cw, ch);
      s.clearRect(0, 0, cw, ch);
      s.drawImage(img, (cell % cols) * cw, Math.floor(cell / cols) * ch, cw, ch, 0, 0, cw, ch);
      const px = s.getImageData(0, 0, cw, ch), d = px.data;
      for (let i = 0; i < d.length; i += 4) { const k = d[i] * 4; d[i] = palette[k]; d[i + 1] = palette[k + 1]; d[i + 2] = palette[k + 2]; d[i + 3] = palette[k + 3]; }
      cv.getContext("2d")!.putImageData(px, -CROP.x, -CROP.y);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [at, per, cols, cw, ch, version, palette]);
  return <canvas ref={ref} width={CROP.w} height={CROP.h} className="cf-thumb" />;
}

function Bars({ stats }: { stats: Record<string, number> }) {
  return <div className="cf-bars">{Object.entries(stats).filter(([, v]) => v > 0).map(([k, v]) => (
    <div key={k} className="cf-bar"><span>{k}</span><i>{[1, 2, 3, 4, 5].map(n => <b key={n} className={n <= v ? "on" : ""} />)}</i></div>
  ))}</div>;
}

const seconds = (ticks: number) => `${(ticks * 0.04).toFixed(1).replace(/\.0$/, "")}s`;

/** A unit's own story beside the stage: its chapter (a click opens the faction's war there), the moment it is
 *  remembered for, who built it, its crew on the radio and the Directorate's file on it. */
function StoryCard({ story, chapter, onChapter, people, paint, onPerson }: { story: UnitStory; chapter: Chapter | null; onChapter: () => void;
  people: Person[]; paint?: string; onPerson: (id: string) => void }) {
  return (
    <section className="cf-story">
      {chapter ? <button className={`cf-chapterchip${chapter.art ? " art" : ""}`} onClick={onChapter} title="Read this chapter of the war, with every unit in it">
        {/* eslint-disable-next-line @next/next/no-img-element -- a draft still from the stories folder */}
        {chapter.art ? <img src={portraitSrc(chapter.art, API)} alt="" loading="lazy" /> : null}
        <span><b>{chapter.title}</b>{chapter.campaign ? <em>{chapter.campaign}</em> : <em>{chapter.when}</em>}</span>
      </button> : null}
      {people.length ? <div className="cf-who" aria-label="People in this story">{people.map(p => (
        <button key={p.id} onClick={() => onPerson(p.id)} title={`${p.role} Follow ${p.name} through the war.`}><Face name={p.name} paint={paint} portrait={p.portrait} />{p.name}</button>
      ))}</div> : null}
      <p className="cf-tale">{story.story}</p>
      <p className="cf-origin">{story.origin}</p>
      {story.crew.length ? <ul className="cf-radio" aria-label="Its crew on the radio">{story.crew.map(l => <li key={l}>{l}</li>)}</ul> : null}
      {story.broker ? <blockquote className="cf-broker"><i aria-hidden="true" /><b>The Broker&apos;s file</b>{story.broker}</blockquote> : null}
    </section>
  );
}

/** A person's badge: a campaign commander's portrait, or anyone else's initials on their faction's colour. */
function Face({ name, paint, portrait }: { name: string; paint?: string; portrait?: string }) {
  const [broken, setBroken] = useState(false);
  return <i className={`cf-face${portrait && !broken ? " pic" : ""}`} style={{ ["--fac" as string]: paint ?? "#6b6f63" }} aria-hidden="true">
    {portrait && !broken
      // eslint-disable-next-line @next/next/no-img-element -- the campaign's published portrait, served by its CDN
      ? <img src={portraitSrc(portrait, API)} alt="" loading="lazy" onError={() => setBroken(true)} />
      : initials(name)}
  </i>;
}

/** A repeatable shuffle (the same seed gives the same order, so paging through a shuffle works). */
function shuffled<T>(list: T[], seed: number) {
  const out = [...list];
  let a = seed * 2654435761 >>> 0;
  const next = () => { a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function ConceptForge() {
  const [index, setIndex] = useState<Index | null>(null);
  const [cat, setCat] = useState<{ data: Catalogue; version: number } | null>(null);
  const [palettes, setPalettes] = useState<Record<string, Palette>>({});
  const [error, setError] = useState("");
  const [source, setSource] = useState<Source>("originals");
  const [kind, setKind] = useState<string>("all");
  const [weapon, setWeapon] = useState("");
  const [query, setQuery] = useState("");
  const [donor, setDonor] = useState<{ h?: string; t?: string } | null>(null);
  // Mixes start shuffled: in catalogue order one hull's sixty mixes sit side by side and the wall looks like one tank.
  const [order, setOrder] = useState<Record<Source, number>>({ originals: 0, mixes: 1, game: 0, story: 0 });
  const [stories, setStories] = useState<Stories>({});
  /** The faction whose war the Story wall tells (the first one with stories until one is picked). */
  const [storyFaction, setStoryFaction] = useState("");
  /** The cast member whose units the Story wall shows (empty: the whole war). */
  const [person, setPerson] = useState("");
  const shuffle = order[source];
  const setShuffle = (to: number | ((n: number) => number)) => setOrder(o => ({ ...o, [source]: typeof to === "function" ? to(o[source]) : to }));
  const [sentTo, setSentTo] = useState<string>("");
  const [more, setMore] = useState({ key: "", n: 0 });
  /** The concept on the stage; empty while the wall shows. */
  const [sel, setSel] = useState<string>("");
  /** The faction whose colours the stage tries on while its "Give it to" button is under the pointer. */
  const [tryOn, setTryOn] = useState<string>("");
  /** Whether the list stays beside the stage; remembered in this browser. */
  const [dock, setDock] = useState(() => { try { return localStorage.getItem("cf-list") !== "off"; } catch { return true; } });
  const toggleDock = () => { const to = !dock; setDock(to); try { localStorage.setItem("cf-list", to ? "on" : "off"); } catch { /* a private window */ } };
  const [player, setPlayer] = useState(PLAYER);
  const [gameUnits, setGameUnits] = useState<GameUnits | null>(null);
  useEffect(() => { void fetch(`${API}/game-units`).then(r => r.json()).then(setGameUnits).catch(() => undefined); }, []);
  const [frames] = useState(() => new FrameStore());
  useEffect(() => { frames.revive(); return () => frames.dispose(); }, [frames]);
  const { muted } = useSoundPrefs();
  const site = useSiteBeside();
  const wallRef = useRef<HTMLDivElement>(null);
  /** The concept that was on the stage before this render. */
  const was = useRef("");
  const endRef = useRef<HTMLDivElement>(null);

  // The drafts change while a wave renders: the page asks every 20 s whether anything is new and reloads what is.
  const stamp = useRef("");
  const reload = useCallback(() => fetch(`${API}/index`).then(r => r.json()).then((d: Index) => {
    setIndex(d);
    void fetch(`${API}/stories`).then(r => r.json()).then((s: { factions?: Stories }) => setStories(s.factions ?? {})).catch(() => undefined);
    setSel(s => s || new URLSearchParams(location.search).get("concept") || "");
    return fetch(forgeFile("catalogue.json")).then(r => (r.ok ? r.json() as Promise<Catalogue> : null)).catch(() => null);
  }).then(c => {
    if (c) { sheets.clear(); setCat(v => ({ data: c, version: (v?.version ?? 0) + 1 })); }
  }).catch(e => setError(String(e))), []);
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void fetch(`${API}/stamp`).then(r => r.json()).then((s: { index: number; catalogue: number; stories?: number }) => {
        const now = `${s.index}:${s.catalogue}:${s.stories ?? 0}`;
        if (stamp.current && stamp.current !== now) void reload();
        stamp.current = now;
      }).catch(() => undefined);
    }, 20000);
    return () => window.clearInterval(timer);
  }, [reload]);
  // The faction palettes, for painting the mixes' pictures.
  const game = index?.game ?? null;
  useEffect(() => {
    if (!game) return;
    void Promise.all(Object.entries(game.palettes).map(async ([f, file]) => [f, decodePal(new Uint8Array(await (await fetch(forgeFile(file))).arrayBuffer()), game.transparent, game.shadow)] as const))
      .then(all => setPalettes(Object.fromEntries(all))).catch(() => undefined);
  }, [game]);

  const originals = index?.concepts ?? NO_CONCEPTS;
  const mixes = cat?.data.mixes ?? NO_MIXES;
  const byId = useMemo(() => new Map(originals.map(c => [c.id, c])), [originals]);
  const mixAt = useMemo(() => new Map(mixes.map((m, i) => [m.id, i])), [mixes]);
  const concept = byId.get(sel) ?? null;
  const mix = useMemo(() => { const i = mixAt.get(sel); return i === undefined ? null : mixes[i]; }, [mixAt, mixes, sel]);
  /** A game unit is selected as game:<faction>:<unit>. */
  const gameUnit = useMemo(() => {
    const [tag, fid, uid] = sel.split(":");
    const f = tag === "game" ? gameUnits?.factions.find(x => x.id === fid) : undefined;
    const u = f?.units.find(x => x.id === uid);
    return f && u?.art ? { faction: f, unit: u, item: { key: sel, spec: u.art.spec, sprite: u.art.sprite } as StageItem } : null;
  }, [sel, gameUnits]);

  // The wall: one source (or everything given to a faction), filtered; it grows as its end comes into view.
  const originalEntries = useMemo(() => originals.map((c): Entry => ({ id: c.id, name: c.name, role: c.role, kind: c.kind, faction: c.faction, weapons: (c.weapons ?? []).map(w => w.kind), at: -1 })), [originals]);
  const mixEntries = useMemo(() => mixes.map((m, i): Entry => ({ id: m.id, name: m.n, role: m.r, kind: m.k, faction: m.f, weapons: m.w, at: i, h: m.h, t: m.t })), [mixes]);
  const gameEntries = useMemo(() => (gameUnits?.factions ?? []).flatMap(f => f.units.map((u): Entry => (
    { id: `game:${f.id}:${u.id}`, name: u.name, role: u.role, kind: "game", faction: f.id, weapons: [], at: -2, cameo: u.cameo, group: f.name }))), [gameUnits]);
  // The Story wall: one faction's war, chapter by chapter, each chapter with the originals and game units that enter
  // it (in the order the story file lists them).
  const told = storyFaction && stories[storyFaction] ? storyFaction : Object.keys(stories)[0] ?? "";
  const tale = stories[told] as Stories[string] | undefined;
  const who = tale?.cast?.find(p => p.id === person);
  const storyEntries = useMemo(() => {
    if (!tale) return [];
    const ours = new Map([...originalEntries, ...gameEntries.filter(e => e.faction === told)].map(e => [e.at === -2 ? e.id.split(":")[2] : e.id, e]));
    const place = new Map(tale.chapters.map((c, i) => [c.id, i]));
    return Object.entries(tale.units)
      .flatMap(([id, s]): Entry[] => { const e = ours.get(id); return e && place.has(s.chapter) && (!who || who.units.includes(id)) ? [{ ...e, group: s.chapter }] : []; })
      .sort((a, b) => place.get(a.group!)! - place.get(b.group!)!);
  }, [tale, told, who, originalEntries, gameEntries]);
  const storyCount = useMemo(() => Object.values(stories).reduce((n, f) => n + Object.keys(f.units ?? {}).length, 0), [stories]);
  const routing = index?.routing;
  const ofGame = source === "game" && !sentTo;
  const ofStory = source === "story" && !sentTo;
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = sentTo ? [...originalEntries, ...mixEntries].filter(e => routing?.[e.id]?.factions?.includes(sentTo))
      : source === "mixes" ? mixEntries : source === "originals" ? originalEntries : source === "story" ? storyEntries : gameEntries;
    const list = from.filter(e => (ofGame || ofStory || ((kind === "all" || e.kind === kind) && (!weapon || (weapon === "none" ? !e.weapons.length : e.weapons.includes(weapon)))))
      && (!q || e.name.toLowerCase().includes(q) || e.role.toLowerCase().includes(q)) && (!donor?.h || e.h === donor.h) && (!donor?.t || e.t === donor.t));
    return shuffle && !ofStory ? shuffled(list, shuffle) : list;
  }, [originalEntries, mixEntries, gameEntries, storyEntries, routing, sentTo, ofGame, ofStory, source, kind, weapon, query, donor, shuffle]);
  const filterKey = `${source}|${kind}|${weapon}|${query}|${donor?.h ?? ""}|${donor?.t ?? ""}|${sentTo}|${shuffle}|${told}|${who?.id ?? ""}`;
  const limit = STEP + (more.key === filterKey ? more.n : 0);
  const shown = useMemo(() => entries.slice(0, limit), [entries, limit]);
  const hasMore = shown.length < entries.length;
  useEffect(() => {
    const end = endRef.current;
    if (!end || !hasMore) return;
    const io = new IntersectionObserver(seen => {
      if (seen.some(s => s.isIntersecting)) setMore(m => ({ key: filterKey, n: (m.key === filterKey ? m.n : 0) + STEP }));
    }, { root: wallRef.current, rootMargin: "800px" });
    io.observe(end);
    return () => io.disconnect();
  }, [filterKey, hasMore, limit]);
  useEffect(() => { wallRef.current?.scrollTo({ top: 0 }); }, [filterKey]);   // a new list starts at its top
  const at = useMemo(() => (sel ? entries.findIndex(e => e.id === sel) : -1), [entries, sel]);
  const near = useMemo(() => (at < 0 ? [] : entries.slice(Math.max(0, at - NEAR), at + NEAR + 1)), [entries, at]);

  // A concept wears its own faction's colours, or those of the first faction it was given to.
  const routeId = concept?.id ?? mix?.id;
  const given = routeId ? routing?.[routeId]?.factions?.[0] : undefined;
  const paintAs = tryOn || given || concept?.faction || mix?.f || "iran";
  const art = useMemo(() => {
    if (concept) return concept.art;
    const h = mix ? byId.get(mix.h)?.art : null, t = mix ? byId.get(mix.t)?.art : null;
    return mix && h && t ? mixArt(mix.id, mix.n, h, t) : null;
  }, [concept, mix, byId]);
  const item = useMemo(() => (gameUnit ? gameUnit.item : art && game ? conceptItem(art, game, paintAs) : null), [gameUnit, art, game, paintAs]);
  const weapons = useMemo(() => (gameUnit ? gameUnit.unit.attack : art ? conceptWeapons(art) : []), [gameUnit, art]);
  const effects = gameUnits?.effects;
  const sounds = useMemo(() => {
    if (gameUnit && effects) { const u = gameUnit.unit, groups = shownSounds(u, null, effects); return (w: string) => weaponSounds(u, groups, null, effects, w); }
    return art ? conceptSounds(art) : undefined;
  }, [gameUnit, art, effects]);
  const self = gameUnit ? (gameUnit.unit.health ? { health: gameUnit.unit.health, armor: gameUnit.unit.armor ?? "none" } : null) : art ? { health: art.health, armor: art.armor } : null;
  // Versus: every original (in its own faction's paint) and every game unit, except the one on the stage.
  const opponents = useMemo((): Opponent[] => {
    if (!game || !sel) return [];
    const fromConcepts = originals.flatMap((c): Opponent[] => (c.art && c.id !== sel ? [{
      id: `forge:${c.id}`, name: c.name, group: KIND_GROUP[c.kind], item: conceptItem(c.art, game, c.faction), weapons: conceptWeapons(c.art),
      health: c.art.health, armor: c.art.armor, sounds: conceptSounds(c.art), cameo: forgeFile(`concepts/${c.id}/art/cameo-${c.faction}.png`),
    }] : []));
    const fromGame = (gameUnits?.factions ?? []).flatMap(f => f.units.flatMap((u): Opponent[] => {
      const key = `game:${f.id}:${u.id}`;
      if (!u.art || !u.health || key === sel) return [];
      const groups = shownSounds(u, null, gameUnits!.effects);
      return [{ id: key, name: u.name, group: `${f.name} (game)`, item: { key, spec: u.art.spec, sprite: u.art.sprite }, weapons: u.attack, health: u.health, armor: u.armor ?? "none", cameo: u.cameo,
        sounds: w => weaponSounds(u, groups, null, gameUnits!.effects, w) }];
    }));
    return [...fromConcepts, ...fromGame];
  }, [originals, game, gameUnits, sel]);
  // How many mixes stand on the selected concept's hull, and how many carry its turret.
  const related = useMemo(() => {
    const h = mix?.h ?? concept?.id, t = mix?.t ?? concept?.id;
    return { h, t, onHull: h ? mixes.reduce((n, m) => n + (m.h === h ? 1 : 0), 0) : 0, withTurret: t ? mixes.reduce((n, m) => n + (m.t === t ? 1 : 0), 0) : 0 };
  }, [mixes, mix, concept]);
  // The story of what is on the stage: an original's own, a game unit's, or for a mix its hull's (a field refit).
  const onStage = useMemo(() => {
    if (gameUnit) return storyOf(stories, gameUnit.faction.id, gameUnit.unit.id);
    if (concept) return storyOf(stories, concept.faction, concept.id);
    const hull = mix ? byId.get(mix.h) : undefined;
    return hull ? storyOf(stories, hull.faction, hull.id) : null;
  }, [stories, gameUnit, concept, mix, byId]);

  /** Put a concept on the stage, or go back to the full wall (an empty id). The address follows; `push` adds a
   *  step to the history (opening one from the full wall), so Back returns to the wall. */
  const show = useCallback((id: string, push = false) => {
    soundEngine.stopAll();
    const u = new URL(location.href);
    if (id) u.searchParams.set("concept", id); else u.searchParams.delete("concept");
    if (push) history.pushState(null, "", u); else history.replaceState(null, "", u);
    setTryOn("");
    setSel(id);
  }, []);
  useEffect(() => {
    const back = () => { soundEngine.stopAll(); setSel(new URLSearchParams(location.search).get("concept") ?? ""); };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  // The list changes width when the stage opens or closes, so its rows move: centre it on the picked one then;
  // while stepping, only keep that one in view.
  useLayoutEffect(() => {
    const id = sel || was.current;
    const tile = id ? wallRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) : null;
    tile?.scrollIntoView({ block: sel && was.current ? "nearest" : "center" });
    was.current = sel;
  }, [sel]);
  const step = useCallback((by: number) => {
    const to = at + by, e = at < 0 ? undefined : entries[to];
    if (!e) return;
    // The list keeps up with the stepping: it grows before the stage reaches its end.
    if (to > limit - 12 && to < limit + STEP) setMore(m => ({ key: filterKey, n: (m.key === filterKey ? m.n : 0) + STEP }));
    show(e.id);
  }, [at, entries, show, limit, filterKey]);
  useEffect(() => {
    if (!sel) return;
    const key = (ev: KeyboardEvent) => {
      const t = ev.target;
      if (t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.getAttribute("role") === "slider")) return;
      if (ev.key === "Escape") show("");
      else if (ev.key === "ArrowRight") step(1);
      else if (ev.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [sel, show, step]);
  /** True while the list stands beside the stage: not on a narrow window, and not when the owner has hidden it. */
  const listBeside = () => !!sel && (wallRef.current?.offsetWidth ?? 0) > 0;
  const browse = (d: { h?: string; t?: string }) => { setDonor(d); setSource("mixes"); setSentTo(""); setKind("all"); setWeapon(""); setQuery(""); if (!listBeside()) show(""); };
  const speak = useCallback((action: string) => {
    if (gameUnit && effects) playAction(shownSounds(gameUnit.unit, null, effects), action);
    else if (art) void soundEngine.playAny(actionSounds(art, index?.voices, paintAs, action));
  }, [gameUnit, effects, art, index, paintAs]);

  const route = async (body: { factions?: string[]; verdict?: string | null; note?: string }) => {
    if (!routeId) return;
    const r = await fetch(`${API}/routing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: routeId, ...body }) });
    if (r.ok) { const next = await r.json() as Routing; setIndex(i => (i ? { ...i, routing: next } : i)); }
  };

  if (error) return <div className="cf-empty">The Concept Forge drafts could not be read: {error}</div>;
  if (!index) return <div className="cf-empty">Opening the Concept Forge…</div>;
  if (!game) return <div className="cf-empty">The drafts are not exported in the game&apos;s format yet: run <code>py -3 tools/forge/forge_export.py</code> in RTSAI-Art.</div>;
  const pal = index.palettes;
  const r = routeId ? index.routing[routeId] : undefined;
  const routed = r?.factions ?? [];
  const facIds = Object.keys(pal.factions);
  const sent = facIds.map(f => [f, Object.values(index.routing).filter(x => x.factions?.includes(f)).length] as const).filter(([f, n]) => n > 0 || f === sentTo);
  const info = concept ? { role: concept.role, name: concept.name, idea: concept.idea, stats: concept.stats }
    : mix ? { role: mix.r, name: mix.n, idea: mix.i, stats: { armour: mix.s[0], firepower: mix.s[1], speed: mix.s[2], range: mix.s[3] } } : null;
  const picture = (e: Entry) => (e.at === -2
    // eslint-disable-next-line @next/next/no-img-element -- the game's own cameo, pixel art
    ? (e.cameo ? <img className="cf-thumb cf-cameo" src={e.cameo} alt="" /> : <span className="cf-thumb" />)
    : e.at < 0 ? <Thumb id={e.id} kind={e.kind} faction={sentTo || e.faction} />
      : cat ? <MixThumb at={e.at} cat={cat.data} version={cat.version} palette={palettes[sentTo || e.faction]} /> : <span className="cf-thumb" />);
  const SOURCES: [Source, string, number, string][] = [["originals", "Originals", originals.length, "Concepts rendered by the forge"],
    ["mixes", "Mixes", mixes.length, "Every rendered turret on every hull or base it fits"], ["game", "Game units", gameEntries.length, "The units in the game today"],
    ...(storyCount ? [["story", "Story", storyCount, "Each faction's war in chapters, with the units that enter each one"] as [Source, string, number, string]] : [])];
  const what = sentTo ? `given to ${pal.factions[sentTo]?.name ?? sentTo}` : source === "mixes" ? "mixes" : source === "originals" ? "originals"
    : source === "story" ? (who ? `with ${who.name}` : `in ${pal.factions[told]?.name ?? told}'s story`) : "game units";
  const toSource = (id: Source) => {
    setSource(id); setSentTo(""); setDonor(null);
    if (id === "mixes" && (kind === "infantry" || kind === "building")) setKind("all");
    if (sel && !listBeside()) show("");   // with the list beside the stage, the stage keeps its concept
  };
  /** Open a faction's war on the Story wall; the unit on the stage stays (it is in that chapter). */
  const openChapter = (faction: string) => { setSource("story"); setSentTo(""); setDonor(null); setQuery(""); setStoryFaction(faction); setPerson(""); };
  /** Follow one person through a faction's war: the Story wall shows only their units, under their path. */
  const openPerson = (faction: string, id: string) => { openChapter(faction); setPerson(id); };
  const chapterOf = (id: string | undefined) => tale?.chapters.find(c => c.id === id);
  const part = mix?.k === "defence" || concept?.kind === "defence" ? "base" : "hull";

  return (
    <div className="cf">
      <MakerBar active="forge" site={site} />
      <header className="cf-top">
        <nav className="cf-tabs">{SOURCES.map(([id, label, n, hint]) => (
          <button key={id} className={source === id && !sentTo ? "on" : ""} onClick={() => toSource(id)} title={hint}><em>{count(n)}</em>{label}</button>
        ))}</nav>
        <a className="cf-quiet" href={`${API}/plan`} target="_blank" rel="noreferrer" title="What has been given to each faction">Plan</a>
        <button className={`cf-quiet ${muted ? "" : "on"}`} onClick={() => soundEngine.setPrefs({ muted: !muted })}>{muted ? "Sound off" : "Sound on"}</button>
      </header>

      <div className={`cf-body${sel ? (dock ? " split dock" : " split") : ""}`}>
        <section className="cf-wall">
          <div className="cf-filters">
            <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" aria-label="Search by name or role" />
            {ofStory ? <div className="cf-chips cf-tellers" aria-label="Whose war">{Object.keys(stories).map(f => (
              <button key={f} className={told === f ? "on" : ""} onClick={() => { setStoryFaction(f); setPerson(""); }} title={stories[f].title}>
                <Flag id={flagId(f)} size="s" />{pal.factions[f]?.name ?? f}<em>{Object.keys(stories[f].units ?? {}).length}</em></button>
            ))}</div> : null}
            {!ofGame && !ofStory ? <div className="cf-chips">{KINDS.filter(([id]) => !(source === "mixes" && !sentTo && (id === "infantry" || id === "building"))).map(([id, label]) => (
              <button key={id} className={kind === id ? "on" : ""} onClick={() => setKind(id)}>{label}</button>
            ))}</div> : null}
            {!ofGame && !ofStory ? <OptionSelect aria-label="Weapon" size="sm" className="cf-weapon" value={weapon || "any"} onValueChange={v => setWeapon(v === "any" ? "" : v)} options={WEAPON_OPTIONS} /> : null}
            {!ofStory ? <div className="cf-chips">
              <button className={shuffle ? "on" : ""} onClick={() => setShuffle(s => s + 1)} title="A new random order">Shuffle</button>
              {shuffle ? <button onClick={() => setShuffle(0)}>In order</button> : null}
            </div> : null}
            {donor ? <button className="cf-donor" onClick={() => setDonor(null)} title="Show every mix again">
              {donor.h ? `On the ${byId.get(donor.h)?.name ?? donor.h}` : `With the turret of the ${byId.get(donor.t ?? "")?.name ?? donor.t}`} ✕</button> : null}
            {sent.length ? <div className="cf-chips cf-given" aria-label="Given to a faction">{sent.map(([f, n]) => (
              <button key={f} className={sentTo === f ? "on" : ""} onClick={() => setSentTo(x => (x === f ? "" : f))} title={`Given to ${pal.factions[f].name}`}
                style={{ ["--fac" as string]: pal.factions[f].paint }}><i />{pal.factions[f].name}<em>{n}</em></button>
            ))}</div> : null}
            <span className="cf-found"><b>{count(entries.length)}</b> {what}</span>
          </div>
          <div className="cf-scroll" ref={wallRef}>
            {ofStory && tale ? <header className="cf-arc"><Flag id={flagId(told)} size="l" /><div><h2>{tale.title}</h2><p>{tale.line}</p></div></header> : null}
            {ofStory && tale?.cast?.length ? <div className="cf-cast" aria-label="The people in this war">{tale.cast.map(p => (
              <button key={p.id} className={p.id === who?.id ? "on" : ""} onClick={() => setPerson(x => (x === p.id ? "" : p.id))}
                title={p.id === who?.id ? "Show the whole war again" : `Follow ${p.name} through the war`}>
                <Face name={p.name} paint={pal.factions[told]?.paint} portrait={p.portrait} /><b>{p.name}</b><span>{p.rank ? `${p.rank} · ` : ""}{p.role}</span>
              </button>
            ))}</div> : null}
            {ofStory && who ? <section className="cf-person">
              <Face name={who.name} paint={pal.factions[told]?.paint} portrait={who.portrait} />
              <h3>{who.name}{who.rank ? <small>{who.rank}</small> : null}</h3>
              <q>{who.line}</q>
              <p>{who.bio}</p>
              <ol className="cf-path">{who.arc.map(a => <li key={a.chapter}><b>{chapterOf(a.chapter)?.title ?? a.chapter}</b>{a.text}</li>)}</ol>
              <button className="cf-allwar" onClick={() => setPerson("")}>The whole war ✕</button>
            </section> : null}
            <div className="cf-grid">{shown.map((e, i) => {
              const rr = index.routing[e.id];
              const ch = ofStory && e.group !== shown[i - 1]?.group ? chapterOf(e.group) : undefined;
              return (
                <Fragment key={e.id}>
                  {ofGame && e.group && e.group !== shown[i - 1]?.group ? <h3 className="cf-group">{e.group}</h3> : null}
                  {ch ? <header className={`cf-chapter${ch.art ? " art" : ""}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a draft still from the stories folder */}
                    {ch.art ? <img src={portraitSrc(ch.art, API)} alt="" loading="lazy" /> : null}
                    <div>
                      <span>{ch.when}{ch.campaign ? <em>{ch.campaign}</em> : null}</span>
                      <h3>{ch.title}</h3>
                      <p>{ch.text}</p>
                    </div>
                  </header> : null}
                  <button data-id={e.id} className={`cf-tile ${rr?.verdict ?? ""}${e.id === sel ? " on" : ""}`} onClick={() => show(e.id, !sel)} title={e.role}>
                    {picture(e)}
                    <span>{e.name}</span>
                    {rr?.factions?.length ? <i className="cf-sent">{rr.factions.map(f => <b key={f} style={{ background: pal.factions[f]?.paint }} title={pal.factions[f]?.name} />)}</i> : null}
                  </button>
                </Fragment>
              );
            })}</div>
            {hasMore ? <div className="cf-end" ref={endRef}>More below…</div> : null}
            {!shown.length ? <p className="cf-none">{source === "mixes" && !mixes.length ? "No mixes yet: run forge_mix.py in RTSAI-Art." : "Nothing matches."}</p> : null}
          </div>
        </section>

        {sel ? <section className="cf-view">
          <div className="cf-viewbar">
            <button className="cf-towall" onClick={() => show("")} title="Back to the full wall (Esc)">← {count(entries.length)} {what}</button>
            <button className="cf-listtoggle" onClick={toggleDock} title={dock ? "Hide the list for a bigger stage" : "Keep the list beside the stage"}>{dock ? "Hide list" : "Show list"}</button>
            {at >= 0 ? <>
              <button onClick={() => step(-1)} disabled={at <= 0} aria-label="Previous" title="Previous (←)">‹</button>
              <span>{count(at + 1)} of {count(entries.length)}</span>
              <button onClick={() => step(1)} disabled={at >= entries.length - 1} aria-label="Next" title="Next (→)">›</button>
            </> : null}
          </div>
          <div className="cf-stagecol">
            <div className="cf-stagehost viewer-stage-slot">
              {item ? <ViewerStage frames={frames} item={item} color={player} onColor={setPlayer} weapons={weapons} dummies={index.dummies}
                sounds={sounds} onAction={id => speak(id)} self={self} opponents={opponents}>
                <div className="viewer-stage-name"><h1>{gameUnit?.unit.name ?? info?.name}</h1><span>{gameUnit ? `${gameUnit.faction.name} · in the game` : info?.role}
                  {onStage && !mix ? <q className="cf-callsign">{onStage.story.callsign}</q> : null}</span></div>
              </ViewerStage> : <div className="cf-empty">{sel.includes("~") && !cat ? "Opening the mixes…" : "This one has no pictures yet."}</div>}
            </div>
            {near.length > 1 ? <div className="cf-strip">{near.map(e => (
              <button key={e.id} className={e.id === sel ? "on" : ""} onClick={() => show(e.id)} title={e.name}>{picture(e)}</button>
            ))}</div> : null}
          </div>
          {gameUnit ? (
            <aside className="cf-info">
              <p className="cf-idea">{gameUnit.unit.role}</p>
              <p className="cf-desc">{gameUnit.unit.description}</p>
              {onStage ? <StoryCard story={onStage.story} chapter={onStage.chapter} onChapter={() => openChapter(onStage.faction)}
                people={onStage.people} paint={pal.factions[onStage.faction]?.paint} onPerson={id => openPerson(onStage.faction, id)} /> : null}
              {gameUnit.unit.health ? <p className="cf-meta">{gameUnit.unit.health} HP · {gameUnit.unit.armor} armor</p> : null}
              <ul className="cf-weapons">{weapons.map(w => (
                <li key={w.id}><b>{w.label}</b><span>{w.damage} damage{w.burst > 1 ? ` ×${w.burst}` : ""} · {w.range} cells · {seconds(w.reloadTicks)}{w.targets.includes("Air") ? " · hits aircraft" : ""}</span></li>
              ))}</ul>
            </aside>
          ) : info ? (
            <aside className="cf-info">
              <p className="cf-idea">{info.idea}</p>
              {onStage && mix ? <p className="cf-refit">A field refit of the {byId.get(mix.h)?.name ?? mix.h}, the one its crews call <q>{onStage.story.callsign}</q>.</p> : null}
              {onStage ? <StoryCard story={onStage.story} chapter={onStage.chapter} onChapter={() => openChapter(onStage.faction)}
                people={onStage.people} paint={pal.factions[onStage.faction]?.paint} onPerson={id => openPerson(onStage.faction, id)} /> : null}
              <Bars stats={info.stats} />
              {art ? <p className="cf-meta">{art.health} HP · {art.armor} armor</p> : null}
              <ul className="cf-weapons">{weapons.map(w => (
                <li key={w.id}><b>{w.label}</b><span>{w.damage} damage{w.burst > 1 ? ` ×${w.burst}` : ""} · {w.range} cells · {seconds(w.reloadTicks)}{w.targets.includes("Air") ? " · hits aircraft" : ""}</span></li>
              ))}</ul>
              {mix ? <>
                <h3>Made from</h3>
                <div className="cf-donors">{([[part, mix.h], ["turret", mix.t]] as const).map(([label, id]) => {
                  const d = byId.get(id);
                  return d ? <button key={label} onClick={() => show(d.id)} title={`Open the ${d.name}`}>
                    <Thumb id={d.id} kind={d.kind} faction={d.faction} />
                    <span><em>{label}</em>{d.name}</span>
                  </button> : null;
                })}</div>
              </> : null}
              {related.onHull || related.withTurret ? <div className="cf-like">
                {related.onHull ? <button onClick={() => browse({ h: related.h })}><b>{count(related.onHull)}</b> mixes on this {part}</button> : null}
                {related.withTurret ? <button onClick={() => browse({ t: related.t })}><b>{count(related.withTurret)}</b> mixes with this turret</button> : null}
              </div> : null}
              <h3>Give it to</h3>
              <div className="cf-route">{facIds.map(f => {
                const on = routed.includes(f);
                return <button key={f} className={on ? "on" : ""} onClick={() => void route({ factions: on ? routed.filter(x => x !== f) : [...routed, f] })}
                  onMouseEnter={() => setTryOn(f)} onMouseLeave={() => setTryOn("")} style={{ ["--fac" as string]: pal.factions[f].paint }}><i />{pal.factions[f].name}</button>;
              })}</div>
              <div className="cf-verdict">{(["keep", "rework", "drop"] as const).map(v => (
                <button key={v} className={r?.verdict === v ? `on ${v}` : v} onClick={() => void route({ verdict: r?.verdict === v ? null : v })}>{v === "keep" ? "Keep" : v === "rework" ? "Rework" : "Drop"}</button>
              ))}</div>
              <textarea placeholder="Notes for the next pass" defaultValue={r?.note ?? ""} key={routeId} onBlur={e => void route({ note: e.target.value })} />
            </aside>
          ) : <aside className="cf-info" />}
        </section> : null}
      </div>
    </div>
  );
}
