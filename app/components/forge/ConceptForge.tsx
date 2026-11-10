"use client";
/**
 * Faction Studio > Concept Forge (local only): exploratory soldiers, vehicles and defences made by RTSAI-Art
 * tools/forge, routed to factions by the owner, next to the game's own units. Three sources, one stage:
 *   Originals   concepts rendered by the forge (forge_build.py, forge_infantry.py)
 *   Mixes       every rendered turret on every hull or base it fits (forge_mix.py): thousands, with no files of their
 *               own; a mix's art is built here from its two donors' art
 *   Game units  the game's own units, exactly as the Faction viewer has them
 * All of them play on the Faction viewer's stage (ViewerStage: the game's sprite format, its animations, the
 * rules-driven Attack demo and Versus), so the Forge has no stage, effects or sounds of its own. Drafts live in
 * D:\Generated\RTSAI\art\concept-forge (lib/concept-forge/server.ts); nothing here changes the game.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FrameStore, type StageItem } from "../art/review/frames";
import { soundEngine, useSoundPrefs } from "../art/review/sound";
import { actionsFor, ViewerStage, type Opponent } from "../art/viewer/ViewerStage";
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
/** One row of the list: an original (at -1) or a mix (its place in the catalogue, which is where its picture is). */
type Entry = { id: string; name: string; role: string; kind: string; faction: string; weapons: string[]; at: number; h?: string; t?: string };
type Source = "originals" | "mixes" | "game";

const KINDS = [["all", "Every kind"], ["infantry", "Soldiers"], ["vehicle", "Vehicles"], ["defence", "Defences"]] as const;
const WEAPONS = [["", "Any weapon"], ["shell", "Guns"], ["bullet", "Machine guns, autocannon"], ["rocket", "Rockets"], ["missile", "Missiles"],
  ["mortar", "Mortars, howitzers"], ["beam", "Beams"], ["arc", "Arc"], ["flame", "Flame"], ["rail", "Rail"], ["none", "Unarmed"]] as const;
const KIND_GROUP: Record<string, string> = { infantry: "Concepts: soldiers", vehicle: "Concepts: vehicles", defence: "Concepts: defences" };
const PLAYER = "F21818";   // the stage's red (houseColors)
const PAGE = 64;
const NO_CONCEPTS: Concept[] = [];
const NO_MIXES: Mix[] = [];
const count = (n: number) => n.toLocaleString("en-US");

/** The list picture of an original: the concept in a faction's paint (forge_export.py cameo-<faction>.png); soldiers at double size. */
function Thumb({ id, kind, faction }: { id: string; kind: string; faction: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const x = ref.current?.getContext("2d"); if (!x) return;
      x.imageSmoothingEnabled = false; x.clearRect(0, 0, 128, 96);
      if (kind === "infantry") x.drawImage(img, 32, 30, 64, 48, 0, 0, 128, 96); else x.drawImage(img, 0, 0);
    };
    img.src = forgeFile(`concepts/${id}/art/cameo-${faction}.png`);
  }, [id, kind, faction]);
  return <canvas ref={ref} width={128} height={96} className="cf-thumb" />;
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
      cv.getContext("2d")!.putImageData(px, 0, 0);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [at, per, cols, cw, ch, version, palette]);
  return <canvas ref={ref} width={cw} height={ch} className="cf-thumb" />;
}

/** One still frame of a stage item, drawn by the shared frame store (the same pixels the stage shows). */
function Still({ frames, item, color }: { frames: FrameStore; item: StageItem; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const animation = actionsFor(item)[0]?.id ?? "stand";
    const draw = () => {
      const cv = ref.current; if (!cv) return;
      const f = frames.get(item, { facing: 896, turret: 0, tick: 0, timeMs: 0, loop: false, animation, color, shadow: true, tint: [1, 1, 1], airborne: item.spec.category === "aircraft" });
      const x = cv.getContext("2d")!; x.clearRect(0, 0, cv.width, cv.height);
      if (!f) return;
      const z = item.spec.category === "infantry" ? 2 : 1;
      x.imageSmoothingEnabled = false;
      x.drawImage(f.canvas, Math.round(cv.width / 2 - f.anchorX * z), Math.round(cv.height * 0.66 - f.anchorY * z), f.width * z, f.height * z);
    };
    draw();
    return frames.subscribe(draw);
  }, [frames, item, color]);
  return <canvas ref={ref} width={88} height={64} />;
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
  const [shuffle, setShuffle] = useState(0);
  const [routedTo, setRoutedTo] = useState<string>("");
  const [pageAt, setPageAt] = useState({ key: "", n: 0 });
  const [sel, setSel] = useState<string>("");
  const [faction, setFaction] = useState<string>("");
  const [player, setPlayer] = useState(PLAYER);
  const [lineup, setLineup] = useState(false);
  const [gameUnits, setGameUnits] = useState<GameUnits | null>(null);
  useEffect(() => { void fetch(`${API}/game-units`).then(r => r.json()).then(setGameUnits).catch(() => undefined); }, []);
  const [frames] = useState(() => new FrameStore());
  useEffect(() => { frames.revive(); return () => frames.dispose(); }, [frames]);
  const { muted } = useSoundPrefs();
  const listRef = useRef<HTMLElement>(null);

  // The drafts change while a wave renders: the page asks every 20 s whether anything is new and reloads what is.
  const stamp = useRef("");
  const reload = useCallback(() => fetch(`${API}/index`).then(r => r.json()).then((d: Index) => {
    setIndex(d);
    setSel(s => s || new URLSearchParams(location.search).get("concept") || d.concepts[0]?.id || "");
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
  // The faction palettes, for painting the mixes' list pictures.
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

  // The list: one source (or everything routed to a faction), filtered, in pages.
  const originalEntries = useMemo(() => originals.map((c): Entry => ({ id: c.id, name: c.name, role: c.role, kind: c.kind, faction: c.faction, weapons: (c.weapons ?? []).map(w => w.kind), at: -1 })), [originals]);
  const mixEntries = useMemo(() => mixes.map((m, i): Entry => ({ id: m.id, name: m.n, role: m.r, kind: m.k, faction: m.f, weapons: m.w, at: i, h: m.h, t: m.t })), [mixes]);
  const routing = index?.routing;
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const from = routedTo ? [...originalEntries, ...mixEntries].filter(e => routing?.[e.id]?.factions?.includes(routedTo)) : source === "mixes" ? mixEntries : source === "originals" ? originalEntries : [];
    const list = from.filter(e => (kind === "all" || e.kind === kind) && (!weapon || (weapon === "none" ? !e.weapons.length : e.weapons.includes(weapon)))
      && (!q || e.name.toLowerCase().includes(q) || e.role.toLowerCase().includes(q)) && (!donor?.h || e.h === donor.h) && (!donor?.t || e.t === donor.t));
    return shuffle ? shuffled(list, shuffle) : list;
  }, [originalEntries, mixEntries, routing, routedTo, source, kind, weapon, query, donor, shuffle]);
  const filterKey = `${source}|${kind}|${weapon}|${query}|${donor?.h ?? ""}|${donor?.t ?? ""}|${routedTo}|${shuffle}`;
  const pages = Math.max(1, Math.ceil(entries.length / PAGE));
  const page = Math.min(pages - 1, pageAt.key === filterKey ? pageAt.n : 0);
  const shown = useMemo(() => entries.slice(page * PAGE, page * PAGE + PAGE), [entries, page]);
  const go = (n: number) => { setPageAt({ key: filterKey, n: Math.max(0, Math.min(pages - 1, n)) }); listRef.current?.scrollTo({ top: 0 }); };

  const paintAs = faction || concept?.faction || mix?.f || "iran";
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
    if (!game) return [];
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
  const facItems = useMemo(() => (art && game ? Object.keys(game.palettes).map(f => [f, conceptItem(art, game, f)] as const) : []), [art, game]);
  // How many mixes stand on the selected concept's hull, and how many carry its turret.
  const related = useMemo(() => {
    const h = mix?.h ?? concept?.id, t = mix?.t ?? concept?.id;
    return { h, t, onHull: h ? mixes.reduce((n, m) => n + (m.h === h ? 1 : 0), 0) : 0, withTurret: t ? mixes.reduce((n, m) => n + (m.t === t ? 1 : 0), 0) : 0 };
  }, [mixes, mix, concept]);

  const select = useCallback((id: string) => {
    setSel(id); soundEngine.stopAll();
    const u = new URL(location.href); u.searchParams.set("concept", id); history.replaceState(null, "", u);
  }, []);
  const browse = (d: { h?: string; t?: string }) => { setDonor(d); setSource("mixes"); setRoutedTo(""); setKind("all"); setWeapon(""); setQuery(""); setLineup(false); };
  const speak = useCallback((action: string, as = paintAs) => {
    if (gameUnit && effects) playAction(shownSounds(gameUnit.unit, null, effects), action);
    else if (art) void soundEngine.playAny(actionSounds(art, index?.voices, as, action));
  }, [gameUnit, effects, art, index, paintAs]);

  const routeId = concept?.id ?? mix?.id;
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
  const gameCount = gameUnits?.factions.reduce((n, f) => n + f.units.length, 0) ?? 0;
  const info = concept ? { role: concept.role, name: concept.name, idea: concept.idea, description: concept.description, stats: concept.stats, fits: concept.factions }
    : mix ? { role: mix.r, name: mix.n, idea: mix.i, description: mix.d, stats: { armour: mix.s[0], firepower: mix.s[1], speed: mix.s[2], range: mix.s[3] }, fits: mix.ff } : null;
  const picture = (e: Entry) => (e.at < 0 ? <Thumb id={e.id} kind={e.kind} faction={faction || e.faction} />
    : cat ? <MixThumb at={e.at} cat={cat.data} version={cat.version} palette={palettes[faction || e.faction]} /> : <span className="cf-thumb" />);
  const SOURCES: [Source, string, number][] = [["originals", "Originals", originals.length], ["mixes", "Mixes", mixes.length], ["game", "Game units", gameCount]];

  return (
    <div className="cf">
      <header className="cf-top">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- standalone Studio entry */}
        <a className="cf-back" href="/art/review">← Faction Studio</a>
        <h1>Concept Forge</h1>
        <nav className="cf-kinds">{SOURCES.map(([id, label, n]) => (
          <button key={id} className={source === id && !routedTo ? "on" : ""} onClick={() => { setSource(id); setRoutedTo(""); setDonor(null); if (id === "mixes" && kind === "infantry") setKind("all"); }}
            title={id === "originals" ? "Concepts rendered by the forge" : id === "mixes" ? "Every rendered turret on every hull or base it fits" : "The game's own units"}>{label}<em>{count(n)}</em></button>
        ))}</nav>
        <span className="cf-total">{count(originals.length + mixes.length)} concepts</span>
        <div className="cf-paint">
          <span>Paint</span>
          <button className={!faction ? "on" : ""} onClick={() => setFaction("")} title="Each concept in its own faction">Own</button>
          {facIds.map(f => <button key={f} className={faction === f ? "on" : ""} onClick={() => setFaction(f)} title={pal.factions[f].name}
            style={{ background: pal.factions[f].paint, color: pal.factions[f].dark }}>{pal.factions[f].name.slice(0, 3)}</button>)}
        </div>
        <button className={`cf-sound ${lineup ? "on" : ""}`} onClick={() => setLineup(l => !l)}>{lineup ? "Back to stage" : "Lineup"}</button>
        <a className="cf-sound" href={`${API}/plan`} target="_blank" rel="noreferrer" title="The routing as a plan, per faction">Plan</a>
        <button className={`cf-sound ${muted ? "" : "on"}`} onClick={() => soundEngine.setPrefs({ muted: !muted })}>{muted ? "Sound off" : "Sound on"}</button>
      </header>

      <aside className="cf-list" ref={listRef}>
        {source !== "game" || routedTo ? <div className="cf-filters">
          <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or role" aria-label="Search concepts" />
          <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind">{KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          <select value={weapon} onChange={e => setWeapon(e.target.value)} aria-label="Weapon">{WEAPONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
          {donor ? <button className="cf-chip" onClick={() => setDonor(null)} title="Show every mix again">
            {donor.h ? `On: ${byId.get(donor.h)?.name ?? donor.h}` : `With: ${byId.get(donor.t ?? "")?.name ?? donor.t}`} ✕</button> : null}
          <div className="cf-pager">
            <button onClick={() => go(page - 1)} disabled={page === 0} aria-label="Previous page">‹</button>
            <span>{page + 1} / {pages}<small>{count(entries.length)} found</small></span>
            <button onClick={() => go(page + 1)} disabled={page >= pages - 1} aria-label="Next page">›</button>
            <button onClick={() => setShuffle(s => s + 1)} title="Shuffle the order">Shuffle</button>
            {shuffle ? <button onClick={() => setShuffle(0)} title="Back to the catalogue order">Sorted</button> : null}
          </div>
        </div> : null}
        <div className="cf-routed" aria-label="Routed to factions">{facIds.map(f => {
          const n = Object.values(index.routing).filter(x => x.factions?.includes(f)).length;
          return <button key={f} className={routedTo === f ? "on" : ""} disabled={!n && routedTo !== f} onClick={() => setRoutedTo(x => (x === f ? "" : f))}
            title={`${pal.factions[f].name}: ${n} routed`} style={{ ["--fac" as string]: pal.factions[f].paint }}><i />{n}</button>;
        })}</div>
        {source === "game" && !routedTo ? (gameUnits?.factions ?? []).map(f => (
          <div key={f.id} className="cf-game-faction">
            <h4>{f.name}</h4>
            {f.units.map(u => {
              const key = `game:${f.id}:${u.id}`;
              return (
                <button key={key} className={`cf-card ${key === sel ? "on" : ""}`} onClick={() => select(key)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- the game's own cameo, pixel art */}
                  {u.cameo ? <img className="cf-thumb cf-cameo" src={u.cameo} alt="" /> : <span className="cf-thumb" />}
                  <span className="cf-card-name">{u.name}</span>
                  <span className="cf-card-role">{u.role}</span>
                </button>
              );
            })}
          </div>
        )) : shown.map(e => {
          const rr = index.routing[e.id];
          return (
            <button key={e.id} className={`cf-card ${e.id === sel ? "on" : ""} ${rr?.verdict ?? ""}`} onClick={() => select(e.id)}>
              {picture(e)}
              <span className="cf-card-name">{e.name}</span>
              <span className="cf-card-role">{e.role}</span>
              {rr?.factions?.length ? <span className="cf-card-routed">{rr.factions.map(f => <i key={f} style={{ background: pal.factions[f]?.paint }} title={pal.factions[f]?.name} />)}</span> : null}
            </button>
          );
        })}
        {(source !== "game" || routedTo) && !shown.length ? <p className="cf-none">{source === "mixes" && !mixes.length ? "No mixes yet: run forge_mix.py in RTSAI-Art." : "Nothing matches these filters."}</p> : null}
      </aside>

      <main className="cf-main">
        {lineup ? <div className="cf-lineup">{shown.map(e => (
          <button key={e.id} onClick={() => { select(e.id); setLineup(false); }} className="cf-lineup-cell">
            {picture(e)}
            <span>{e.name}</span>
          </button>
        ))}</div> : null}
        <div className="cf-stagehost viewer-stage-slot" hidden={lineup}>
          {item ? <ViewerStage frames={frames} item={item} color={player} onColor={setPlayer} weapons={weapons} dummies={index.dummies}
            sounds={sounds} onAction={id => speak(id)} self={self} opponents={opponents}>
            <div className="viewer-stage-name"><h1>{gameUnit?.unit.name ?? info?.name}</h1><span>{gameUnit ? `${gameUnit.faction.name} · game unit` : info?.role}</span></div>
          </ViewerStage> : <div className="cf-empty">{sel.includes("~") && !cat ? "Opening the mixes…" : "This concept has no game-format art yet."}</div>}
        </div>
      </main>

      {gameUnit ? (
        <section className="cf-info">
          <p className="cf-role">{gameUnit.faction.name} · in the game</p>
          <h2>{gameUnit.unit.name}</h2>
          <p className="cf-idea">{gameUnit.unit.role}</p>
          <p className="cf-desc">{gameUnit.unit.description}</p>
          {gameUnit.unit.health ? <p className="cf-meta">{gameUnit.unit.health} HP · {gameUnit.unit.armor} armor</p> : null}
          <ul className="cf-weapons">{weapons.map(w => (
            <li key={w.id}><b>{w.label}</b><span>{w.damage} damage{w.burst > 1 ? ` ×${w.burst}` : ""} · {w.range} cells · {seconds(w.reloadTicks)} reload{w.targets.includes("Air") ? " · hits aircraft" : ""}</span></li>
          ))}</ul>
          <p className="cf-meta">The game&apos;s own unit, exactly as the Faction viewer shows it. Pick a concept in Versus to see them fight.</p>
        </section>
      ) : info ? (
        <section className="cf-info">
          <p className="cf-role">{info.role}</p>
          <h2>{info.name}</h2>
          <p className="cf-idea">{info.idea}</p>
          <p className="cf-desc">{info.description}</p>
          <Bars stats={info.stats} />
          {art ? <p className="cf-meta">{art.health} HP · {art.armor} armor</p> : null}
          <ul className="cf-weapons">{weapons.map(w => (
            <li key={w.id}><b>{w.label}</b><span>{w.damage} damage{w.burst > 1 ? ` ×${w.burst}` : ""} · {w.range} cells · {seconds(w.reloadTicks)} reload{w.targets.includes("Air") ? " · hits aircraft" : ""}</span></li>
          ))}</ul>
          {mix || related.onHull || related.withTurret ? <>
            <h3>{mix ? "Made from" : "Mixes"}</h3>
            <div className="cf-donors">
              {mix ? <button onClick={() => select(mix.h)}>Hull: {byId.get(mix.h)?.name ?? mix.h}</button> : null}
              {mix ? <button onClick={() => select(mix.t)}>Turret: {byId.get(mix.t)?.name ?? mix.t}</button> : null}
              {related.onHull ? <button onClick={() => browse({ h: related.h })}>{count(related.onHull)} on this {mix?.k === "defence" || concept?.kind === "defence" ? "base" : "hull"}</button> : null}
              {related.withTurret ? <button onClick={() => browse({ t: related.t })}>{count(related.withTurret)} with this turret</button> : null}
            </div>
          </> : null}
          <h3>In every faction</h3>
          <div className="cf-facrow">{facItems.map(([f, it]) => (
            <button key={f} title={`${pal.factions[f]?.name}: click to hear its voice`} onMouseEnter={() => setFaction(f)} onMouseLeave={() => setFaction("")} onClick={() => speak("select", f)}>
              <Still frames={frames} item={it} color={player} />
              <span>{pal.factions[f]?.name}</span>
            </button>
          ))}</div>
          <h3>Send to faction</h3>
          <div className="cf-route">{facIds.map(f => {
            const on = routed.includes(f); const fit = info.fits.includes(f);
            return <button key={f} className={`${on ? "on" : ""} ${fit ? "fit" : ""}`} onClick={() => void route({ factions: on ? routed.filter(x => x !== f) : [...routed, f] })}
              onMouseEnter={() => setFaction(f)} onMouseLeave={() => setFaction("")} style={{ ["--fac" as string]: pal.factions[f].paint }}>
              <i />{pal.factions[f].name}{fit ? <em>fits</em> : null}</button>;
          })}</div>
          <div className="cf-verdict">{(["keep", "rework", "drop"] as const).map(v => (
            <button key={v} className={r?.verdict === v ? `on ${v}` : v} onClick={() => void route({ verdict: r?.verdict === v ? null : v })}>{v === "keep" ? "Keep" : v === "rework" ? "Rework" : "Drop"}</button>
          ))}</div>
          <textarea placeholder="Notes for the next pass" defaultValue={r?.note ?? ""} key={routeId} onBlur={e => void route({ note: e.target.value })} />
          <p className="cf-meta">{concept ? `Draft · ${concept.built ?? ""} · ${Object.values(concept.layers).reduce((n, l) => n + l.count, 0)} frames` : "A mix: its two donors' pictures, no files of its own"} · plays on the Faction viewer&apos;s stage</p>
        </section>
      ) : null}
    </div>
  );
}
