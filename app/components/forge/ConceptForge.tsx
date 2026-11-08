"use client";
/**
 * Faction Studio > Concept Forge (local only): exploratory soldiers, vehicles and defences made by RTSAI-Art
 * tools/forge, played on a live stage with their full behaviour and sounds, and routed to factions by the owner.
 * Drafts live in D:\Generated\RTSAI\art\concept-forge (lib/concept-forge/server.ts); nothing here changes the game.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API, fileUrl, loadEncoded, paint, Stage, STAGE_H, STAGE_W, type Concept, type FxMeta, type Palettes, type Voices } from "./engine";
import "./forge.css";

type Routing = Record<string, { factions: string[]; verdict: string | null; note: string; at: string }>;
type Index = { palettes: Palettes; concepts: Concept[]; fx: FxMeta; sounds: string[]; routing: Routing; voices?: Voices };
const KINDS = [{ id: "all", label: "All" }, { id: "infantry", label: "Soldiers" }, { id: "vehicle", label: "Vehicles" }, { id: "defence", label: "Defences" }] as const;
const ZOOM = 3;

function Thumb({ c, pal, faction, player }: { c: Concept; pal: Palettes; faction: string; player: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void loadEncoded(fileUrl(`concepts/${c.id}/thumb.png`)).then(enc => {
      if (!live || !ref.current) return;
      const sheet = paint(enc, `${c.id}/thumb`, pal, faction, player);
      const x = ref.current.getContext("2d")!; x.imageSmoothingEnabled = false;
      x.clearRect(0, 0, 128, 96);
      if (c.kind === "infantry") x.drawImage(sheet, 32, 30, 64, 48, 0, 0, 128, 96);   // soldiers at double size
      else x.drawImage(sheet, 0, 0);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [c.id, c.kind, pal, faction, player]);
  return <canvas ref={ref} width={128} height={96} className="cf-thumb" />;
}

/** Every shown concept on a turntable, painted in the chosen faction: the overview for routing. */
function Lineup({ concepts, index, faction, player, onPick }: { concepts: Concept[]; index: Index; faction: string; player: string; onPick: (id: string) => void }) {
  const refs = useRef(new Map<string, HTMLCanvasElement>());
  const stages = useRef(new Map<string, Stage>());
  useEffect(() => {
    for (const c of concepts) if (!stages.current.has(c.id)) { const st = new Stage(); stages.current.set(c.id, st); void st.load(c, index.palettes, index.fx, true); }
  }, [concepts, index]);
  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      for (const c of concepts) {
        const cv = refs.current.get(c.id); const st = stages.current.get(c.id); if (!cv || !st) continue;
        st.faction = faction || c.faction; st.player = player;
        const x = cv.getContext("2d")!; x.imageSmoothingEnabled = false;
        st.drawTurntable(x, t, cv.width, cv.height);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [concepts, faction, player]);
  return <div className="cf-lineup">{concepts.map(c => (
    <button key={c.id} onClick={() => onPick(c.id)} className="cf-lineup-cell">
      <canvas ref={el => { if (el) refs.current.set(c.id, el); }} width={120} height={96} />
      <span>{c.name}</span>
    </button>
  ))}</div>;
}

/** The selected concept in every faction's paint at once; clicking one plays that faction's voice for it. */
function FactionRow({ concept, index, player, onHover }: { concept: Concept; index: Index; player: string; onHover: (f: string) => void }) {
  const ids = Object.keys(index.palettes.factions);
  const refs = useRef(new Map<string, HTMLCanvasElement>());
  const stages = useRef(new Map<string, Stage>());
  useEffect(() => {
    stages.current = new Map(ids.map(f => { const st = new Stage(); st.faction = f; st.voices = index.voices ?? {}; void st.load(concept, index.palettes, index.fx, true); return [f, st]; }));
  }, [concept, index]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      for (const f of ids) {
        const cv = refs.current.get(f); const st = stages.current.get(f); if (!cv || !st) continue;
        st.player = player; const x = cv.getContext("2d")!; x.imageSmoothingEnabled = false;
        st.drawTurntable(x, t, cv.width, cv.height);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [concept, player]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="cf-facrow">{ids.map(f => (
    <button key={f} title={`${index.palettes.factions[f].name}: click to hear its voice`} onMouseEnter={() => onHover(f)} onMouseLeave={() => onHover("")}
      onClick={() => { const st = stages.current.get(f); if (st) { st.sound.ensure(); st.mode = "idle"; st.lastVoice = 0; st.say("select"); } }}>
      <canvas ref={el => { if (el) refs.current.set(f, el); }} width={72} height={60} />
      <span>{index.palettes.factions[f].name}</span>
    </button>
  ))}</div>;
}

function Bars({ stats }: { stats: Record<string, number> }) {
  return <div className="cf-bars">{Object.entries(stats).filter(([, v]) => v > 0).map(([k, v]) => (
    <div key={k} className="cf-bar"><span>{k}</span><i>{[1, 2, 3, 4, 5].map(n => <b key={n} className={n <= v ? "on" : ""} />)}</i></div>
  ))}</div>;
}

export function ConceptForge() {
  const [index, setIndex] = useState<Index | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [routedTo, setRoutedTo] = useState<string>("");
  const [sel, setSel] = useState<string>("");
  const [faction, setFaction] = useState<string>("");
  const [player, setPlayer] = useState("#e02a1f");
  const [sound, setSound] = useState(true);
  const [, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [lineup, setLineup] = useState(false);
  const [ground, setGround] = useState<"desert" | "steppe" | "urban">("desert");
  const overlay = useRef({ caption: "", name: "", role: "", recording: false });
  const canvas = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  /** The stage engine, created on first use (never during render). */
  const engine = useCallback(() => (stageRef.current ??= new Stage()), []);
  useEffect(() => { const st = engine(); st.terrain = ground; st.ground = null; }, [ground, engine]);
  const others = useRef<Stage[]>([]);
  const [foeId, setFoeId] = useState("");
  const [fighting, setFighting] = useState(false);
  const recordFight = useRef(false);
  useEffect(() => { (window as unknown as { __forge: Stage }).__forge = engine(); }, [engine]);
  const demo = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);

  const reload = useCallback(() => fetch(`${API}/index`).then(r => r.json()).then((d: Index) => {
    setIndex(d);
    setSel(s => s || new URLSearchParams(location.search).get("concept") || d.concepts[0]?.id || "");
  }).catch(e => setError(String(e))), []);
  useEffect(() => { void reload(); }, [reload]);

  const concept = useMemo(() => index?.concepts.find(c => c.id === sel) ?? null, [index, sel]);
  const shown = useMemo(() => (index?.concepts ?? []).filter(c => (kind === "all" || c.kind === kind)
    && (!routedTo || index?.routing[c.id]?.factions?.includes(routedTo))), [index, kind, routedTo]);
  const paintAs = faction || concept?.faction || "iran";

  /** Select a concept: stop whatever the stage was doing for the previous one. */
  const select = useCallback((id: string) => {
    demo.current++; setBusy(false); setCaption(""); others.current = []; setFighting(false);
    const st = engine(); st.auto = false; st.onImpact = null;
    setSel(id);
  }, [engine]);

  // load the selected concept into the stage
  useEffect(() => {
    if (!index || !concept) return;
    const st = engine();
    st.voices = index.voices ?? {};
    void st.load(concept, index.palettes, index.fx);
    const u = new URL(location.href); u.searchParams.set("concept", concept.id); history.replaceState(null, "", u);
  }, [index, concept, engine]);
  useEffect(() => { const st = engine(); st.faction = paintAs; st.player = player; }, [paintAs, player, engine]);
  useEffect(() => { const st = engine(); st.sound.enabled = sound; if (!sound) st.sound.stopAll(); }, [sound, engine]);

  // render loop
  useEffect(() => {
    let raf = 0, last = performance.now();
    const world = document.createElement("canvas"); world.width = STAGE_W; world.height = STAGE_H;
    const w = world.getContext("2d")!;
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      const st = engine();
      st.update(t, dt); st.draw(w, t);
      const rest = others.current;
      if (rest.length) {
        // every armed unit aims at the nearest living enemy; units are drawn back to front
        const all = [st, ...rest];
        const aim = (u: Stage) => ({ x: u.x, y: u.y - (u.concept?.air && u.mode !== "dead" ? u.concept.altitude ?? 30 : 6) });
        for (const u of all) {
          const foes = all.filter(v => v.team !== u.team && v.mode !== "dead");
          if (foes.length) u.target = aim(foes.reduce((m, v) => (Math.hypot(v.x - u.x, v.y - u.y) < Math.hypot(m.x - u.x, m.y - u.y) ? v : m)));
        }
        for (const u of rest) u.update(t, dt);
        for (const u of [...rest].sort((a, b) => a.y - b.y)) u.draw(w, t);
      }
      const ctxScreen = canvas.current?.getContext("2d");
      if (ctxScreen) {
        ctxScreen.imageSmoothingEnabled = false; ctxScreen.drawImage(world, 0, 0, world.width * ZOOM, world.height * ZOOM);
        // captions and the name are drawn into the canvas so a recorded video carries them
        const o = overlay.current; const W = world.width * ZOOM;
        ctxScreen.textBaseline = "middle"; ctxScreen.textAlign = "center";
        if (o.caption) {
          ctxScreen.font = "bold 22px Arial"; const tw = ctxScreen.measureText(o.caption).width + 40;
          ctxScreen.fillStyle = "rgba(0,0,0,0.62)"; ctxScreen.beginPath(); ctxScreen.roundRect(W / 2 - tw / 2, 20, tw, 40, 20); ctxScreen.fill();
          ctxScreen.fillStyle = "#fff"; ctxScreen.fillText(o.caption, W / 2, 41);
        }
        if (o.recording && o.name) {
          ctxScreen.textAlign = "left"; ctxScreen.fillStyle = "rgba(0,0,0,0.55)"; ctxScreen.fillRect(0, world.height * ZOOM - 74, 520, 74);
          ctxScreen.fillStyle = "#d7ae5f"; ctxScreen.font = "bold 13px Arial"; ctxScreen.fillText(o.role.toUpperCase(), 22, world.height * ZOOM - 52);
          ctxScreen.fillStyle = "#fff"; ctxScreen.font = "bold 24px Arial"; ctxScreen.fillText(o.name, 22, world.height * ZOOM - 27);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // ---------------------------------------------------------------- recording
  const startRecording = useCallback((c: Concept | null) => {
    const cv = canvas.current; const st = engine(); if (!cv) return;
    st.sound.ensure();
    const stream = cv.captureStream(30);
    const audio = st.sound.dest?.stream.getAudioTracks()[0]; if (audio) stream.addTrack(audio);
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm" });
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => { overlay.current.recording = false; setVideoUrl(URL.createObjectURL(new Blob(chunks, { type: "video/webm" }))); setRecording(null); };
    rec.start(250); recorder.current = rec; setRecording(c?.id ?? ""); setVideoUrl(null);
    overlay.current = { ...overlay.current, recording: true, name: c?.name ?? "", role: c?.role ?? "" };
  }, [engine]);
  const stopRecording = useCallback(() => { if (recorder.current?.state === "recording") recorder.current.stop(); }, []);

  // ---------------------------------------------------------------- actions
  const act = useCallback((a: string) => {
    const st = engine(); const t = performance.now(); st.sound.ensure();
    if (a === "fire") st.fire(t);
    else if (a === "move") st.setMode(st.mode === "move" ? "idle" : "move", t);
    else if (a === "stop") st.setMode("idle", t);
    else if (a === "damage") st.damaged = !st.damaged;
    else if (a === "destroy") st.setMode("dead", t);
    else if (a === "build") { st.reset(t); st.setMode("build", t); }
    else if (a === "prone") st.setMode(st.mode === "prone" ? "idle" : "prone", t);
    else if (a === "reset") { demo.current++; setBusy(false); setCaption(""); overlay.current.caption = ""; others.current = []; setFighting(false); st.auto = false; st.onImpact = null; st.team = 0; st.reset(t); }
    else if (a === "select") { st.sound.play(concept?.sounds.select, { gain: 0.6 }); st.say("select"); }
  }, [concept, engine]);

  /** Versus and Battle: two teams fire on their own at the nearest living enemy until one team is destroyed. The
   *  selected concept leads team A (the paint chosen above); team B wears another faction and player colour. */
  const battle = useCallback(async (teamA: Concept[], teamB: Concept[], label: string, record = false) => {
    if (!index || !teamA.length || !teamB.length) return;
    demo.current++; setBusy(true);
    const st = engine(); const t = performance.now(); st.sound.ensure(); st.reset(t);
    const facIds = Object.keys(index.palettes.factions);
    const facB = teamB[0].factions.find(f => f !== paintAs) ?? facIds.find(f => f !== paintAs) ?? teamB[0].faction;
    const playerB = player === "#2f6fe0" ? "#e02a1f" : "#2f6fe0";
    const spotsA = [[100, 160], [58, 122], [150, 192]], spotsB = [[268, 78], [312, 112], [226, 52]];
    const all: Stage[] = [st];
    st.team = 0; [st.x, st.y] = spotsA[0];
    const make = async (c: Concept, team: number, spot: number[]) => {
      const u = new Stage(); u.sound = st.sound; u.voices = index.voices ?? {}; u.noGround = true; u.team = team;
      u.faction = team ? facB : paintAs; u.player = team ? playerB : player;
      await u.load(c, index.palettes, index.fx, true);
      [u.x, u.y] = spot; return u;
    };
    for (let i = 1; i < teamA.length; i++) all.push(await make(teamA[i], 0, spotsA[i]));
    for (let i = 0; i < teamB.length; i++) all.push(await make(teamB[i], 1, spotsB[i]));
    const hp = (k: Concept) => 60 + (k.stats?.armour ?? 2) * 40 + (k.kind === "defence" ? 60 : k.kind === "infantry" ? -40 : 0);
    const alive = (team: number) => all.filter(v => v.team === team && v.mode !== "dead");
    for (const a of all) {
      const ex = a.team ? 140 : 280, ey = a.team ? 170 : 70;
      a.ang = a.tang = Math.atan2(-(ex - a.x), -2 * (ey - a.y));
      a.hp = a.maxHp = hp(a.concept!); a.auto = a.concept!.weapons.length > 0;
      a.reloadUntil = t + 400 + Math.random() * 900;
      a.onImpact = (x, y, w) => {
        for (const b of all) {
          if (b.team === a.team || b.mode === "dead") continue;
          const by = b.y - (b.concept!.air ? b.concept!.altitude ?? 30 : 0);
          if (Math.hypot(x - b.x, (y - by) * 1.6) > (b.concept!.kind === "infantry" ? 10 : 22)) continue;
          const dmg = { shell: 34, rail: 60, rocket: 18, missile: 36, mortar: 40, bullet: b.concept!.kind === "infantry" ? 9 : 3, beam: 16, arc: 22, flame: 30 }[w.kind] ?? 10;
          b.hp -= dmg; if (b.hp < b.maxHp * 0.5) b.damaged = true;
          if (b.hp <= 0) {
            b.burning = b.concept!.kind === "infantry" && (w.kind === "flame" || w.kind === "arc");
            b.auto = false; b.firing = null; b.setMode("dead", performance.now());
            if (!alive(b.team).length) {
              for (const v of all) { v.auto = false; v.firing = null; }
              setTimeout(() => { setBusy(false); if (recordFight.current) { recordFight.current = false; stopRecording(); } }, 3600);
            }
          }
          break;
        }
      };
    }
    others.current = all.slice(1); setFighting(true);
    if (record) { startRecording(teamA[0]); overlay.current = { ...overlay.current, name: label, role: teamA.length > 1 ? "Battle" : "Versus" }; }
    recordFight.current = record;
    st.say("attack");
  }, [index, paintAs, player, engine, startRecording, stopRecording]);

  /** The Versus menu: one opponent, or a three-against-three battle around the selected concept. */
  const fight = useCallback((otherId: string, record = false) => {
    const c = concept; if (!c || !index) return;
    if (otherId === "__battle__") {
      const armed = index.concepts.filter(x => x.id !== c.id && x.weapons.length);
      const shuffled = [...armed].sort(() => Math.random() - 0.5);
      const mates = shuffled.filter(x => x.factions.includes(paintAs)).slice(0, 2);
      const rest = shuffled.filter(x => !mates.includes(x));
      const teamA = [c, ...mates, ...rest].slice(0, 3);
      const teamB = rest.filter(x => !teamA.includes(x)).slice(0, 3);
      void battle(teamA, teamB, `${c.name} and squad  vs  ${teamB.map(x => x.name).join(", ")}`, record);
      return;
    }
    const other = index.concepts.find(x => x.id === otherId); if (!other) return;
    void battle([c], [other], `${c.name}  vs  ${other.name}`, record);
  }, [concept, index, paintAs, battle]);
  const endFight = () => { const st = engine(); others.current = []; setFighting(false); st.auto = false; st.onImpact = null; st.team = 0; st.reset(performance.now()); setBusy(false); };

  const wait = (ms: number, token: number) => new Promise<boolean>(ok => setTimeout(() => ok(demo.current === token), ms));

  /** Every behaviour in order, with captions: the "video" of the concept. */
  const playAll = useCallback(async (record = false) => {
    const c = concept; if (!c) return;
    const token = ++demo.current; setBusy(true);
    const st = engine(); st.sound.ensure(); st.reset(performance.now());
    const say = (s: string) => { setCaption(s); overlay.current.caption = s; };
    const aimAt = (x: number, y: number) => { st.target = { x, y }; };
    if (record) startRecording(c);
    const steps: Array<[string, () => void, number]> = [];
    if (c.kind === "defence") steps.push(["Construction", () => act("build"), 1800]);
    steps.push(["Selected", () => act("select"), 1200]);
    if (c.weapons.length) {
      steps.push(["Turning to a new target", () => aimAt(70, 70), 1500]);
      steps.push([c.weapons[0].name, () => act("fire"), Math.max(1600, (c.weapons[0]?.burst ?? 1) * (c.weapons[0]?.interval ?? 0) + 1400)]);
      const w2 = c.weapons[1];
      steps.push([w2 ? w2.name : "Turning and firing again", () => { aimAt(300, 170); setTimeout(() => act("fire"), 700); }, w2 ? Math.max(2600, w2.burst * w2.interval + 1800) : 2600]);
    } else if (c.spin) steps.push(["Scanning", () => undefined, 3000]);
    else if (c.pulse) steps.push(["Shield up", () => undefined, 3000]);
    if (c.kind !== "defence") {
      steps.push(["On the move", () => { aimAt(290, 70); act("move"); }, 2200]);
      if (c.weapons.length) steps.push(["Firing on the move", () => act("fire"), 2600]);
      steps.push(["Halt", () => act("stop"), 900]);
    }
    if (c.kind === "infantry") steps.push(["Going prone and firing", () => { act("prone"); setTimeout(() => act("fire"), 600); }, 2200]);
    steps.push(["Under fire", () => st.underFire(performance.now()), 2200]);
    if (c.kind !== "infantry") steps.push(["Taking damage", () => { act("damage"); aimAt(90, 175); if (c.weapons.length) setTimeout(() => act("fire"), 500); }, 2600]);
    steps.push(["Destroyed", () => act("destroy"), c.kind === "infantry" ? 2200 : 4200]);
    for (const [label, run, ms] of steps) {
      if (demo.current !== token) break;
      say(label); run();
      if (!(await wait(ms, token))) break;
    }
    if (demo.current === token) { say(""); setBusy(false); } else overlay.current.caption = "";
    if (record) setTimeout(stopRecording, 300);
  }, [concept, act, engine, startRecording, stopRecording]);


  // keyboard
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      const map: Record<string, string> = { " ": "fire", f: "fire", m: "move", s: "stop", d: "damage", x: "destroy", b: "build", p: "prone", r: "reset" };
      if (e.key === "Enter") { e.preventDefault(); void playAll(); return; }
      if (map[e.key]) { e.preventDefault(); act(map[e.key]); return; }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); const i = shown.findIndex(c => c.id === sel); const n = shown[(i + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length]; if (n) select(n.id);
      }
    };
    addEventListener("keydown", k); return () => removeEventListener("keydown", k);
  }, [act, playAll, shown, sel, select]);

  // stage pointer: click = new target (and fire), drag = turn the unit
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const toWorld = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * STAGE_W, y: (e.clientY - r.top) / r.height * STAGE_H }; };
  const onDown = (e: React.PointerEvent) => { drag.current = { ...toWorld(e), moved: false }; (e.target as HTMLElement).setPointerCapture(e.pointerId); engine().sound.ensure(); };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return; const p = toWorld(e);
    if (Math.hypot(p.x - d.x, p.y - d.y) > 4) { d.moved = true; const st = engine(); st.ang = Math.atan2(-(p.x - st.x), -2 * (p.y - st.y)); st.tang = st.ang; }
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null; if (!d || d.moved) return;
    const p = toWorld(e); const st = engine();
    if (Math.hypot(p.x - st.x, (p.y - (st.y - 8)) * 1.4) < 16) { act("select"); return; }   // the unit: select it (it answers)
    st.target = p; act("fire");
  };

  // routing
  const route = async (body: { factions?: string[]; verdict?: string | null; note?: string }) => {
    if (!concept) return;
    const r = await fetch(`${API}/routing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: concept.id, ...body }) });
    if (r.ok) { const routing = await r.json() as Routing; setIndex(i => (i ? { ...i, routing } : i)); }
  };

  if (error) return <div className="cf-empty">The Concept Forge drafts could not be read: {error}</div>;
  if (!index) return <div className="cf-empty">Opening the Concept Forge…</div>;
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
        <div className="cf-players">{Object.entries(pal.players).map(([n, h]) => (
          <button key={n} title={n} aria-label={`Player colour ${n}`} className={player === h ? "on" : ""} style={{ background: h }} onClick={() => setPlayer(h)} />
        ))}</div>
        <button className="cf-sound" onClick={() => setGround(g => (g === "desert" ? "steppe" : g === "steppe" ? "urban" : "desert"))} title="Ground under the stage">{ground === "desert" ? "Desert" : ground === "steppe" ? "Steppe" : "Urban"}</button>
        <button className={`cf-sound ${lineup ? "on" : ""}`} onClick={() => setLineup(l => !l)}>{lineup ? "Back to stage" : "Lineup"}</button>
        <a className="cf-sound" href={`${API}/plan`} target="_blank" rel="noreferrer" title="The routing as a plan, per faction">Plan</a>
        <button className={`cf-sound ${sound ? "on" : ""}`} onClick={() => setSound(s => !s)}>{sound ? "Sound on" : "Sound off"}</button>
      </header>

      <aside className="cf-list">
        <div className="cf-routed" aria-label="Routed to factions">{facIds.map(f => {
          const n = index.concepts.filter(c => index.routing[c.id]?.factions?.includes(f)).length;
          return <button key={f} className={routedTo === f ? "on" : ""} disabled={!n && routedTo !== f} onClick={() => setRoutedTo(r => (r === f ? "" : f))}
            title={`${pal.factions[f].name}: ${n} routed`} style={{ ["--fac" as string]: pal.factions[f].paint }}><i />{n}</button>;
        })}</div>
        {shown.map(c => {
        const rr = index.routing[c.id];
        return (
          <button key={c.id} className={`cf-card ${c.id === sel ? "on" : ""} ${rr?.verdict ?? ""}`} onClick={() => select(c.id)}>
            <Thumb c={c} pal={pal} faction={faction || c.faction} player={player} />
            <span className="cf-card-name">{c.name}</span>
            <span className="cf-card-role">{c.role}</span>
            {rr?.factions?.length ? <span className="cf-card-routed">{rr.factions.map(f => <i key={f} style={{ background: pal.factions[f]?.paint }} title={pal.factions[f]?.name} />)}</span> : null}
          </button>
        );
      })}</aside>

      <main className="cf-main">
        {lineup ? <Lineup concepts={shown} index={index} faction={faction} player={player} onPick={id => { select(id); setLineup(false); }} /> : null}
        <div className="cf-stage" hidden={lineup}>
          <canvas ref={canvas} width={STAGE_W * ZOOM} height={STAGE_H * ZOOM}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
          {recording ? <div className="cf-rec">● Recording</div> : null}
          <div className="cf-hint">Click the unit to select it · click the ground to fire there · drag to turn · Enter plays everything</div>
        </div>
        <div className="cf-actions" hidden={lineup}>
          <button className="cf-primary" disabled={busy} onClick={() => void playAll()}>▶ Show everything <kbd>Enter</kbd></button>
          <button onClick={() => act("fire")}>Fire <kbd>F</kbd></button>
          {concept?.kind !== "defence" ? <button onClick={() => act("move")}>Move <kbd>M</kbd></button> : <button onClick={() => act("build")}>Build <kbd>B</kbd></button>}
          {concept?.kind === "infantry" ? <button onClick={() => act("prone")}>Prone <kbd>P</kbd></button> : <button onClick={() => act("damage")}>Damage <kbd>D</kbd></button>}
          <button onClick={() => act("destroy")}>Destroy <kbd>X</kbd></button>
          <button onClick={() => act("reset")}>Reset <kbd>R</kbd></button>
          <span className="cf-gap" />
          <select className="cf-versus" value={foeId} onChange={e => setFoeId(e.target.value)} aria-label="Opponent">
            <option value="">Versus…</option>
            <option value="__battle__">Battle: three against three</option>
            {index.concepts.filter(x => x.id !== concept?.id && x.weapons.length).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <button disabled={!foeId || !concept?.weapons.length} onClick={() => (fighting ? endFight() : fight(foeId))}>{fighting ? "End fight" : "Fight"}</button>
          <button disabled={busy || !!recording} onClick={() => (foeId && concept?.weapons.length ? fight(foeId, true) : void playAll(true))}>● Record video</button>
          {videoUrl ? <a className="cf-download" href={videoUrl} download={`${concept?.id ?? "concept"}.webm`}>Save video</a> : null}
        </div>
      </main>

      {concept ? (
        <section className="cf-info">
          <p className="cf-role">{concept.role}</p>
          <h2>{concept.name}</h2>
          <p className="cf-idea">{concept.idea}</p>
          <p className="cf-desc">{concept.description}</p>
          <Bars stats={concept.stats} />
          <ul className="cf-weapons">{concept.weapons.map(w => <li key={w.name}><b>{w.name}</b><span>{w.burst > 1 ? `${w.burst}-round ${w.kind}` : w.kind}{w.air ? " · hits aircraft" : ""}{w.pierce ? " · pierces" : ""}</span></li>)}</ul>
          <h3>In every faction</h3>
          <FactionRow concept={concept} index={index} player={player} onHover={setFaction} />
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
          <p className="cf-meta">Draft · {concept.built ?? ""} · {Object.values(concept.layers).reduce((n, l) => n + l.count, 0)} frames</p>
        </section>
      ) : null}
    </div>
  );
}
