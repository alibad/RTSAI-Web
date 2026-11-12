"use client";
/**
 * Faction Studio > Concept Forge (local only): exploratory soldiers, vehicles and defences made by RTSAI-Art
 * tools/forge, next to the game's own units. The page opens as a wall of pictures; a click puts one on the stage.
 *   Originals   concepts rendered by the forge (forge_build.py, forge_infantry.py)
 *   Mixes       every rendered turret on every hull or base it fits (forge_mix.py): thousands, with no files of their
 *               own; a mix's art is built here from its two donors' art
 *   Game units  the game's own units, exactly as the Faction viewer has them
 * All of them play on the Faction viewer's stage (ViewerStage: the game's sprite format, its animations, the
 * rules-driven Attack demo and Versus), so the Forge has no stage, effects or sounds of its own. A faction changes
 * only a concept's paint, so there is no paint mode: a concept wears its own faction's colours until it is given to
 * another. Drafts live in D:\Generated\RTSAI\art\concept-forge (lib/concept-forge/server.ts); nothing here changes
 * the game.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FrameStore, type StageItem } from "../art/review/frames";
import { soundEngine, useSoundPrefs } from "../art/review/sound";
import { ViewerStage, type Opponent } from "../art/viewer/ViewerStage";
import { playAction, shownSounds, weaponSounds } from "../art/viewer/FactionViewer";
import { decodePal, type Palette } from "../../../lib/art-lab/pal";
import type { ViewerDummy } from "../../../lib/weapon-demo";
import type { ViewerUnit } from "../../../lib/viewer";
import type { PublicClip } from "../../../lib/faction-audio";
import { actionSounds, API, conceptItem, conceptSounds, conceptWeapons, forgeFile, mixArt, type ConceptArt, type ConceptGame, type Voices } from "./stage-item";
import "../art/viewer/viewer.css";
import "./forge.css";

type Faction = { name: string; paint: string; dark: string };
type Concept = {
  id: string; kind: "infantry" | "vehicle" | "defence"; name: string; idea: string; description: string; role: string;
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
type Source = "originals" | "mixes" | "game";

const KINDS = [["all", "All"], ["infantry", "Soldiers"], ["vehicle", "Vehicles"], ["defence", "Defences"]] as const;
const WEAPONS = [["", "Any weapon"], ["shell", "Guns"], ["bullet", "Machine guns, autocannon"], ["rocket", "Rockets"], ["missile", "Missiles"],
  ["mortar", "Mortars, howitzers"], ["beam", "Beams"], ["arc", "Arc"], ["flame", "Flame"], ["rail", "Rail"], ["none", "Unarmed"]] as const;
const KIND_GROUP: Record<string, string> = { infantry: "Concepts: soldiers", vehicle: "Concepts: vehicles", defence: "Concepts: defences" };
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
  const [order, setOrder] = useState<Record<Source, number>>({ originals: 0, mixes: 1, game: 0 });
  const shuffle = order[source];
  const setShuffle = (to: number | ((n: number) => number)) => setOrder(o => ({ ...o, [source]: typeof to === "function" ? to(o[source]) : to }));
  const [sentTo, setSentTo] = useState<string>("");
  const [more, setMore] = useState({ key: "", n: 0 });
  /** The concept on the stage; empty while the wall shows. */
  const [sel, setSel] = useState<string>("");
  /** The faction whose colours the stage tries on while its "Give it to" button is under the pointer. */
  const [tryOn, setTryOn] = useState<string>("");
  const [player, setPlayer] = useState(PLAYER);
  const [gameUnits, setGameUnits] = useState<GameUnits | null>(null);
  useEffect(() => { void fetch(`${API}/game-units`).then(r => r.json()).then(setGameUnits).catch(() => undefined); }, []);
  const [frames] = useState(() => new FrameStore());
  useEffect(() => { frames.revive(); return () => frames.dispose(); }, [frames]);
  const { muted } = useSoundPrefs();
  const wallRef = useRef<HTMLElement>(null);
  const wallTop = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);

  // The drafts change while a wave renders: the page asks every 20 s whether anything is new and reloads what is.
  const stamp = useRef("");
  const reload = useCallback(() => fetch(`${API}/index`).then(r => r.json()).then((d: Index) => {
    setIndex(d);
    setSel(s => s || new URLSearchParams(location.search).get("concept") || "");
    return fetch(forgeFile("catalogue.json")).then(r => (r.ok ? r.json() as Promise<Catalogue> : null)).catch(() => null);
  }).then(c => {
    if (c) { sheets.clear(); setCat(v => ({ data: c, version: (v?.version ?? 0) + 1 })); }
  }).catch(e => setError(String(e))), []);
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void fetch(`${API}/stamp`).then(r => r.json()).then((s: { index: number; catalogue: number }) => {
        const now = `${s.index}:${s.catalogue}`;
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
  const routing = index?.routing;
  const ofGame = source === "game" && !sentTo;
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = sentTo ? [...originalEntries, ...mixEntries].filter(e => routing?.[e.id]?.factions?.includes(sentTo)) : source === "mixes" ? mixEntries : source === "originals" ? originalEntries : gameEntries;
    const list = from.filter(e => (ofGame || ((kind === "all" || e.kind === kind) && (!weapon || (weapon === "none" ? !e.weapons.length : e.weapons.includes(weapon)))))
      && (!q || e.name.toLowerCase().includes(q) || e.role.toLowerCase().includes(q)) && (!donor?.h || e.h === donor.h) && (!donor?.t || e.t === donor.t));
    return shuffle ? shuffled(list, shuffle) : list;
  }, [originalEntries, mixEntries, gameEntries, routing, sentTo, ofGame, source, kind, weapon, query, donor, shuffle]);
  const filterKey = `${source}|${kind}|${weapon}|${query}|${donor?.h ?? ""}|${donor?.t ?? ""}|${sentTo}|${shuffle}`;
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
      health: c.art.health, armor: c.art.armor, sounds: conceptSounds(c.art),
    }] : []));
    const fromGame = (gameUnits?.factions ?? []).flatMap(f => f.units.flatMap((u): Opponent[] => {
      const key = `game:${f.id}:${u.id}`;
      if (!u.art || !u.health || key === sel) return [];
      const groups = shownSounds(u, null, gameUnits!.effects);
      return [{ id: key, name: u.name, group: `${f.name} (game)`, item: { key, spec: u.art.spec, sprite: u.art.sprite }, weapons: u.attack, health: u.health, armor: u.armor ?? "none",
        sounds: w => weaponSounds(u, groups, null, gameUnits!.effects, w) }];
    }));
    return [...fromConcepts, ...fromGame];
  }, [originals, game, gameUnits, sel]);
  // How many mixes stand on the selected concept's hull, and how many carry its turret.
  const related = useMemo(() => {
    const h = mix?.h ?? concept?.id, t = mix?.t ?? concept?.id;
    return { h, t, onHull: h ? mixes.reduce((n, m) => n + (m.h === h ? 1 : 0), 0) : 0, withTurret: t ? mixes.reduce((n, m) => n + (m.t === t ? 1 : 0), 0) : 0 };
  }, [mixes, mix, concept]);

  /** Put a concept on the stage, or go back to the wall (an empty id). The address follows, so Back works. */
  const show = useCallback((id: string, fromWall = false) => {
    soundEngine.stopAll();
    if (fromWall) wallTop.current = wallRef.current?.scrollTop ?? 0;
    const u = new URL(location.href);
    if (id) u.searchParams.set("concept", id); else u.searchParams.delete("concept");
    if (fromWall) history.pushState(null, "", u); else history.replaceState(null, "", u);
    setTryOn("");
    setSel(id);
  }, []);
  useEffect(() => {
    const back = () => { soundEngine.stopAll(); setSel(new URLSearchParams(location.search).get("concept") ?? ""); };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  useEffect(() => { if (!sel && wallRef.current) wallRef.current.scrollTop = wallTop.current; }, [sel]);
  const step = useCallback((by: number) => { const e = at < 0 ? undefined : entries[at + by]; if (e) show(e.id); }, [at, entries, show]);
  useEffect(() => {
    if (!sel) return;
    const key = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.getAttribute("role") === "slider")) return;
      if (ev.key === "Escape") show("");
      else if (ev.key === "ArrowRight") step(1);
      else if (ev.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [sel, show, step]);
  const browse = (d: { h?: string; t?: string }) => { setDonor(d); setSource("mixes"); setSentTo(""); setKind("all"); setWeapon(""); setQuery(""); wallTop.current = 0; show(""); };
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
    ["mixes", "Mixes", mixes.length, "Every rendered turret on every hull or base it fits"], ["game", "Game units", gameEntries.length, "The units in the game today"]];
  const what = sentTo ? `given to ${pal.factions[sentTo]?.name ?? sentTo}` : source === "mixes" ? "mixes" : source === "originals" ? "originals" : "game units";
  const toSource = (id: Source) => {
    setSource(id); setSentTo(""); setDonor(null);
    if (id === "mixes" && kind === "infantry") setKind("all");
    wallTop.current = 0; wallRef.current?.scrollTo({ top: 0 });
    if (sel) show("");
  };
  const part = mix?.k === "defence" || concept?.kind === "defence" ? "base" : "hull";

  return (
    <div className="cf">
      <header className="cf-top">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- standalone Studio entry */}
        <a className="cf-back" href="/art/review">← Faction Studio</a>
        <h1>Concept Forge</h1>
        <nav className="cf-tabs">{SOURCES.map(([id, label, n, hint]) => (
          <button key={id} className={source === id && !sentTo ? "on" : ""} onClick={() => toSource(id)} title={hint}><em>{count(n)}</em>{label}</button>
        ))}</nav>
        <a className="cf-quiet" href={`${API}/plan`} target="_blank" rel="noreferrer" title="What has been given to each faction">Plan</a>
        <button className={`cf-quiet ${muted ? "" : "on"}`} onClick={() => soundEngine.setPrefs({ muted: !muted })}>{muted ? "Sound off" : "Sound on"}</button>
      </header>

      <section className="cf-wall" ref={wallRef} hidden={!!sel}>
        <div className="cf-filters">
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" aria-label="Search by name or role" />
          {!ofGame ? <div className="cf-chips">{KINDS.filter(([id]) => !(source === "mixes" && !sentTo && id === "infantry")).map(([id, label]) => (
            <button key={id} className={kind === id ? "on" : ""} onClick={() => setKind(id)}>{label}</button>
          ))}</div> : null}
          {!ofGame ? <select value={weapon} onChange={e => setWeapon(e.target.value)} aria-label="Weapon">{WEAPONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select> : null}
          <div className="cf-chips">
            <button className={shuffle ? "on" : ""} onClick={() => setShuffle(s => s + 1)} title="A new random order">Shuffle</button>
            {shuffle ? <button onClick={() => setShuffle(0)}>In order</button> : null}
          </div>
          {donor ? <button className="cf-donor" onClick={() => setDonor(null)} title="Show every mix again">
            {donor.h ? `On the ${byId.get(donor.h)?.name ?? donor.h}` : `With the turret of the ${byId.get(donor.t ?? "")?.name ?? donor.t}`} ✕</button> : null}
          {sent.length ? <div className="cf-chips cf-given" aria-label="Given to a faction">{sent.map(([f, n]) => (
            <button key={f} className={sentTo === f ? "on" : ""} onClick={() => setSentTo(x => (x === f ? "" : f))} title={`Given to ${pal.factions[f].name}`}
              style={{ ["--fac" as string]: pal.factions[f].paint }}><i />{pal.factions[f].name}<em>{n}</em></button>
          ))}</div> : null}
          <span className="cf-found"><b>{count(entries.length)}</b> {what}</span>
        </div>
        <div className="cf-grid">{shown.map((e, i) => {
          const rr = index.routing[e.id];
          return (
            <Fragment key={e.id}>
              {ofGame && e.group && e.group !== shown[i - 1]?.group ? <h3 className="cf-group">{e.group}</h3> : null}
              <button className={`cf-tile ${rr?.verdict ?? ""}`} onClick={() => show(e.id, true)} title={e.role}>
                {picture(e)}
                <span>{e.name}</span>
                {rr?.factions?.length ? <i className="cf-sent">{rr.factions.map(f => <b key={f} style={{ background: pal.factions[f]?.paint }} title={pal.factions[f]?.name} />)}</i> : null}
              </button>
            </Fragment>
          );
        })}</div>
        {hasMore ? <div className="cf-end" ref={endRef}>More below…</div> : null}
        {!shown.length ? <p className="cf-none">{source === "mixes" && !mixes.length ? "No mixes yet: run forge_mix.py in RTSAI-Art." : "Nothing matches."}</p> : null}
      </section>

      {sel ? <section className="cf-view">
        <div className="cf-viewbar">
          <button className="cf-towall" onClick={() => show("")} title="Back to the wall (Esc)">← {count(entries.length)} {what}</button>
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
              <div className="viewer-stage-name"><h1>{gameUnit?.unit.name ?? info?.name}</h1><span>{gameUnit ? `${gameUnit.faction.name} · in the game` : info?.role}</span></div>
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
            {gameUnit.unit.health ? <p className="cf-meta">{gameUnit.unit.health} HP · {gameUnit.unit.armor} armor</p> : null}
            <ul className="cf-weapons">{weapons.map(w => (
              <li key={w.id}><b>{w.label}</b><span>{w.damage} damage{w.burst > 1 ? ` ×${w.burst}` : ""} · {w.range} cells · {seconds(w.reloadTicks)}{w.targets.includes("Air") ? " · hits aircraft" : ""}</span></li>
            ))}</ul>
          </aside>
        ) : info ? (
          <aside className="cf-info">
            <p className="cf-idea">{info.idea}</p>
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
  );
}
