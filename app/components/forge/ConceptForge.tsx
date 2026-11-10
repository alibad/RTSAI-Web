"use client";
/**
 * Faction Studio > Concept Forge (local only): exploratory soldiers, vehicles and defences made by RTSAI-Art
 * tools/forge, routed to factions by the owner. They play on the Faction viewer's own stage (ViewerStage: the game's
 * sprite format, its animations and the rules-driven Attack demo), exactly like the game's units, so the Forge has no
 * stage, effects or sounds of its own. Drafts live in D:\Generated\RTSAI\art\concept-forge (lib/concept-forge/server.ts);
 * nothing here changes the game.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FrameStore, type StageItem } from "../art/review/frames";
import { soundEngine, useSoundPrefs } from "../art/review/sound";
import { actionsFor, ViewerStage } from "../art/viewer/ViewerStage";
import type { ViewerDummy } from "../../../lib/weapon-demo";
import { actionSounds, API, conceptItem, conceptSounds, conceptWeapons, forgeFile, type ConceptArt, type ConceptGame, type Voices } from "./stage-item";
import "../art/viewer/viewer.css";
import "./forge.css";

type Faction = { name: string; paint: string; dark: string };
type Concept = {
  id: string; kind: "infantry" | "vehicle" | "defence"; name: string; idea: string; description: string; role: string;
  factions: string[]; faction: string; stats: Record<string, number>; built?: string;
  layers: Record<string, { count: number }>; art: ConceptArt | null;
};
type Routing = Record<string, { factions: string[]; verdict: string | null; note: string; at: string }>;
type Index = { palettes: { factions: Record<string, Faction> }; concepts: Concept[]; routing: Routing; voices?: Voices; game: ConceptGame | null; dummies: ViewerDummy[] };
const KINDS = [{ id: "all", label: "All" }, { id: "infantry", label: "Soldiers" }, { id: "vehicle", label: "Vehicles" }, { id: "defence", label: "Defences" }] as const;
const PLAYER = "#e02a1f";

/** The list picture: the concept in a faction's paint (forge_export.py cameo-<faction>.png); soldiers at double size. */
function Thumb({ c, faction }: { c: Concept; faction: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const x = ref.current?.getContext("2d"); if (!x) return;
      x.imageSmoothingEnabled = false; x.clearRect(0, 0, 128, 96);
      if (c.kind === "infantry") x.drawImage(img, 32, 30, 64, 48, 0, 0, 128, 96); else x.drawImage(img, 0, 0);
    };
    img.src = forgeFile(`concepts/${c.id}/art/cameo-${faction}.png`);
  }, [c.id, c.kind, faction]);
  return <canvas ref={ref} width={128} height={96} className="cf-thumb" />;
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

export function ConceptForge() {
  const [index, setIndex] = useState<Index | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [routedTo, setRoutedTo] = useState<string>("");
  const [sel, setSel] = useState<string>("");
  const [faction, setFaction] = useState<string>("");
  const [player, setPlayer] = useState(PLAYER);
  const [lineup, setLineup] = useState(false);
  const [frames] = useState(() => new FrameStore());
  useEffect(() => { frames.revive(); return () => frames.dispose(); }, [frames]);
  const { muted } = useSoundPrefs();

  const reload = useCallback(() => fetch(`${API}/index`).then(r => r.json()).then((d: Index) => {
    setIndex(d);
    setSel(s => s || new URLSearchParams(location.search).get("concept") || d.concepts[0]?.id || "");
  }).catch(e => setError(String(e))), []);
  useEffect(() => { void reload(); }, [reload]);

  const concept = useMemo(() => index?.concepts.find(c => c.id === sel) ?? null, [index, sel]);
  const shown = useMemo(() => (index?.concepts ?? []).filter(c => (kind === "all" || c.kind === kind)
    && (!routedTo || index?.routing[c.id]?.factions?.includes(routedTo))), [index, kind, routedTo]);
  const paintAs = faction || concept?.faction || "iran";
  const art = concept?.art ?? null;
  const item = useMemo(() => (art && index?.game ? conceptItem(art, index.game, paintAs) : null), [art, index, paintAs]);
  const weapons = useMemo(() => (art ? conceptWeapons(art) : []), [art]);
  const sounds = useMemo(() => (art ? conceptSounds(art) : undefined), [art]);
  const facItems = useMemo(() => (art && index?.game ? Object.keys(index.game.palettes).map(f => [f, conceptItem(art, index.game!, f)] as const) : []), [art, index]);

  const select = useCallback((id: string) => {
    setSel(id); soundEngine.stopAll();
    const u = new URL(location.href); u.searchParams.set("concept", id); history.replaceState(null, "", u);
  }, []);
  const speak = useCallback((action: string, as = paintAs) => { if (art) void soundEngine.playAny(actionSounds(art, index?.voices, as, action)); }, [art, index, paintAs]);

  const route = async (body: { factions?: string[]; verdict?: string | null; note?: string }) => {
    if (!concept) return;
    const r = await fetch(`${API}/routing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: concept.id, ...body }) });
    if (r.ok) { const routing = await r.json() as Routing; setIndex(i => (i ? { ...i, routing } : i)); }
  };

  if (error) return <div className="cf-empty">The Concept Forge drafts could not be read: {error}</div>;
  if (!index) return <div className="cf-empty">Opening the Concept Forge…</div>;
  if (!index.game) return <div className="cf-empty">The drafts are not exported in the game&apos;s format yet: run <code>py -3 tools/forge/forge_export.py</code> in RTSAI-Art.</div>;
  const pal = index.palettes;
  const r = concept ? index.routing[concept.id] : undefined;
  const routed = r?.factions ?? [];
  const facIds = Object.keys(pal.factions);

  return (
    <div className="cf">
      <header className="cf-top">
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- standalone Studio entry */}
        <a className="cf-back" href="/art/review">← Faction Studio</a>
        <h1>Concept Forge</h1>
        <nav className="cf-kinds">{KINDS.map(k => (
          <button key={k.id} className={kind === k.id ? "on" : ""} onClick={() => setKind(k.id)}>{k.label}<em>{k.id === "all" ? index.concepts.length : index.concepts.filter(c => c.kind === k.id).length}</em></button>
        ))}</nav>
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

      <aside className="cf-list">
        <div className="cf-routed" aria-label="Routed to factions">{facIds.map(f => {
          const n = index.concepts.filter(c => index.routing[c.id]?.factions?.includes(f)).length;
          return <button key={f} className={routedTo === f ? "on" : ""} disabled={!n && routedTo !== f} onClick={() => setRoutedTo(x => (x === f ? "" : f))}
            title={`${pal.factions[f].name}: ${n} routed`} style={{ ["--fac" as string]: pal.factions[f].paint }}><i />{n}</button>;
        })}</div>
        {shown.map(c => {
          const rr = index.routing[c.id];
          return (
            <button key={c.id} className={`cf-card ${c.id === sel ? "on" : ""} ${rr?.verdict ?? ""}`} onClick={() => select(c.id)}>
              <Thumb c={c} faction={faction || c.faction} />
              <span className="cf-card-name">{c.name}</span>
              <span className="cf-card-role">{c.role}</span>
              {rr?.factions?.length ? <span className="cf-card-routed">{rr.factions.map(f => <i key={f} style={{ background: pal.factions[f]?.paint }} title={pal.factions[f]?.name} />)}</span> : null}
            </button>
          );
        })}
      </aside>

      <main className="cf-main">
        {lineup ? <div className="cf-lineup">{shown.map(c => (
          <button key={c.id} onClick={() => { select(c.id); setLineup(false); }} className="cf-lineup-cell">
            <Thumb c={c} faction={faction || c.faction} />
            <span>{c.name}</span>
          </button>
        ))}</div> : null}
        <div className="cf-stagehost viewer-stage-slot" hidden={lineup}>
          {item ? <ViewerStage frames={frames} item={item} color={player} onColor={setPlayer} weapons={weapons} dummies={index.dummies}
            sounds={sounds} onAction={id => speak(id)}>
            <div className="viewer-stage-name"><h1>{concept?.name}</h1><span>{concept?.role}</span></div>
          </ViewerStage> : <div className="cf-empty">This concept has no game-format art yet.</div>}
        </div>
      </main>

      {concept ? (
        <section className="cf-info">
          <p className="cf-role">{concept.role}</p>
          <h2>{concept.name}</h2>
          <p className="cf-idea">{concept.idea}</p>
          <p className="cf-desc">{concept.description}</p>
          <Bars stats={concept.stats} />
          {art ? <p className="cf-meta">{art.health} HP · {art.armor} armor</p> : null}
          <ul className="cf-weapons">{weapons.map(w => (
            <li key={w.id}><b>{w.label}</b><span>{w.damage} damage{w.burst > 1 ? ` ×${w.burst}` : ""} · {w.range} cells · {seconds(w.reloadTicks)} reload{w.targets.includes("Air") ? " · hits aircraft" : ""}</span></li>
          ))}</ul>
          <h3>In every faction</h3>
          <div className="cf-facrow">{facItems.map(([f, it]) => (
            <button key={f} title={`${pal.factions[f]?.name}: click to hear its voice`} onMouseEnter={() => setFaction(f)} onMouseLeave={() => setFaction("")} onClick={() => speak("select", f)}>
              <Still frames={frames} item={it} color={player} />
              <span>{pal.factions[f]?.name}</span>
            </button>
          ))}</div>
          <h3>Send to faction</h3>
          <div className="cf-route">{facIds.map(f => {
            const on = routed.includes(f); const fit = concept.factions.includes(f);
            return <button key={f} className={`${on ? "on" : ""} ${fit ? "fit" : ""}`} onClick={() => void route({ factions: on ? routed.filter(x => x !== f) : [...routed, f] })}
              onMouseEnter={() => setFaction(f)} onMouseLeave={() => setFaction("")} style={{ ["--fac" as string]: pal.factions[f].paint }}>
              <i />{pal.factions[f].name}{fit ? <em>fits</em> : null}</button>;
          })}</div>
          <div className="cf-verdict">{(["keep", "rework", "drop"] as const).map(v => (
            <button key={v} className={r?.verdict === v ? `on ${v}` : v} onClick={() => void route({ verdict: r?.verdict === v ? null : v })}>{v === "keep" ? "Keep" : v === "rework" ? "Rework" : "Drop"}</button>
          ))}</div>
          <textarea placeholder="Notes for the next pass" defaultValue={r?.note ?? ""} key={concept.id} onBlur={e => void route({ note: e.target.value })} />
          <p className="cf-meta">Draft · {concept.built ?? ""} · {Object.values(concept.layers).reduce((n, l) => n + l.count, 0)} frames · plays on the Faction viewer&apos;s stage</p>
        </section>
      ) : null}
    </div>
  );
}
