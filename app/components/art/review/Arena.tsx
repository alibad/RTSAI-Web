"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Swords } from "lucide-react";
import type { DuelRequest, DuelResult, DuelSample } from "../../../../lib/art-lab/duel-server";
import type { RosterPayload } from "../../../../lib/art-lab/originals";
import type { FrameStore } from "./frames";
import { stageItem, type ReviewUnit } from "./versions";
import { useLab } from "./lab-store";
export function Arena({ mode, units, selected, roster, frames, onSelect }: { mode: "ra2" | "classic"; units: ReviewUnit[]; selected: ReviewUnit; roster: RosterPayload | null; frames: FrameStore; onSelect: (id: string) => void }) {
  const eligible = useMemo(() => units.filter(u => roster?.stock[u.id]?.behavior.health).sort((a, b) => a.name.localeCompare(b.name)), [units, roster]);
  const [a, setA] = useState(eligible.some(u => u.id === selected.id) ? selected.id : eligible[0]?.id ?? selected.id);
  const [lastSelected, setLastSelected] = useState(selected.id);
  const [b, setB] = useState(mode === "ra2" ? "htnk" : "3tnk");
  const [countA, setCountA] = useState(1), [countB, setCountB] = useState(1);
  const [deployA, setDeployA] = useState(false), [deployB, setDeployB] = useState(false);
  const [factionA, setFactionA] = useState(selected.factionId), [factionB, setFactionB] = useState("");
  const owners = (id: string) => roster?.factions.filter(f => f.units.some(u => u.id === id)) ?? [];
  const owner = (id: string, requested: string) => owners(id).find(f => f.id === requested)?.id ?? owners(id).find(f => f.id === (mode === "ra2" ? "america" : "england"))?.id ?? owners(id)[0]?.id;
  if (lastSelected !== selected.id) { setLastSelected(selected.id); setA(eligible.some(u => u.id === selected.id) ? selected.id : eligible[0]?.id ?? selected.id); setDeployA(false); }
  const [gap, setGap] = useState(12), [level, setLevel] = useState(0), [healthA, setHealthA] = useState(100);
  const [result, setResult] = useState<DuelResult | null>(null), [history, setHistory] = useState<DuelResult[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [playing, setPlaying] = useState(false), [index, setIndex] = useState(0), [speed, setSpeed] = useState(1), [ranges, setRanges] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null), aborted = useRef(false), drawState = useRef({ result, index, a, b, ranges });
  useEffect(() => { drawState.current = { result, index, a, b, ranges }; });
  useEffect(() => { aborted.current = false; return () => { aborted.current = true; }; }, []);
  const restore = useCallback((r: DuelResult) => {
    setLastSelected(r.request.a.id); setA(r.request.a.id); onSelect(r.request.a.id);
    setB(r.request.b.id); setCountA(r.request.a.count); setCountB(r.request.b.count);
    setDeployA(r.request.a.deploy); setDeployB(r.request.b.deploy);
    setFactionA(r.request.a.faction ?? ""); setFactionB(r.request.b.faction ?? "");
    setGap(r.request.gap); setLevel(r.request.level);
    const baseHealth = roster?.stock[r.request.a.id]?.behavior.health ?? r.request.a.health ?? 1;
    setHealthA(r.request.a.health ? Math.round(r.request.a.health / baseHealth * 100) : 100);
    setResult(r); setIndex(0); setPlaying(false);
  }, [onSelect, roster]);
  useEffect(() => {
    let stored: string[] = [];
    try { const value = JSON.parse(localStorage.getItem(`rtsai-studio-notebook:${mode}`) ?? "[]"); if (Array.isArray(value)) stored = value.filter(id => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)); } catch { /* Browser storage is optional. */ }
    void Promise.all(stored.slice(0, 6).map(id => fetch(`/api/art-review/duel/${id}`).then(r => r.ok ? r.json() : null).catch(() => null))).then(jobs => {
      if (aborted.current) return;
      const results = jobs.filter(j => j?.status === "complete" && j.result?.request.mode === mode).map(j => j.result as DuelResult);
      setHistory(results); if (results[0]) restore(results[0]);
    });
  }, [mode, restore]);
  const actorMap = useMemo(() => new Map(units.map(u => [u.id, u])), [units]);
  const draw = useCallback(() => {
    const el = canvas.current, ctx = el?.getContext("2d"); if (!el || !ctx) return;
    const width = el.clientWidth, height = el.clientHeight, dpr = Math.min(window.devicePixelRatio, 2);
    if (width < 1 || height < 1) return;
    if (el.width !== width * dpr || el.height !== height * dpr) { el.width = width * dpr; el.height = height * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const state = drawState.current, r = state.result;
    const water = r?.request.waterSide;
    if (water && water !== "none") { ctx.fillStyle = "#142834"; ctx.fillRect(water === "b" ? width / 2 : 0, 0, water === "both" ? width : width / 2, height); }
    const project = (x: number, y: number, z = 0) => mode === "ra2" ? [(x - y) * 30 / 1024, (x + y) * 15 / 1024 - z * 30 / 1024] : [x * 24 / 1024, y * 24 / 1024 - z * 24 / 1024];
    const sample: DuelSample = r?.samples[state.index] ?? { tick: 0, actors: [{ side: 0, index: 1, x: -6144, y: 0, z: 0, facing: 768, health: 1, maxHealth: 1 }, { side: 1, index: 1, x: 6144, y: 0, z: 0, facing: 256, health: 1, maxHealth: 1 }] };
    const all = r?.samples.flatMap(s => s.actors) ?? sample.actors;
    const points = all.map(p => project(p.x, p.y));
    const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
    const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
    const scale = Math.max(.1, Math.min(2, (width - 180) / Math.max(220, maxX - minX), (height - 140) / Math.max(160, maxY - minY)));
    const center = [(minX + maxX) / 2, (minY + maxY) / 2];
    const screen = (p: number[]) => [width / 2 + (p[0] - center[0]) * scale, height / 2 + (p[1] - center[1]) * scale];
    ctx.strokeStyle = "rgba(170,200,150,.06)"; ctx.lineWidth = 1;
    for (let x = -height; x < width + height; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + height, height); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - height, height); ctx.stroke(); }
    const ids = r ? [r.request.a.id, r.request.b.id] : [state.a, state.b];
    for (const p of [...sample.actors].sort((a, b) => a.x + a.y - b.x - b.y)) {
      const unit = actorMap.get(ids[p.side]), item = unit && stageItem(unit, null); if (!unit || !item) continue;
      const [x, y] = screen(project(p.x, p.y, p.z)), ground = screen(project(p.x, p.y));
      const color = p.side === 0 ? "E04444" : "4477EE";
      if (state.ranges) {
        const range = roster?.stock[unit.id]?.behavior.weapons[0]?.range ?? 0;
        ctx.strokeStyle = `${p.side === 0 ? "#E04444" : "#4477EE"}40`; ctx.fillStyle = `${p.side === 0 ? "#E04444" : "#4477EE"}07`;
        ctx.beginPath(); ctx.ellipse(ground[0], ground[1], range * (mode === "ra2" ? 42.43 : 24) * scale, range * (mode === "ra2" ? 21.21 : 24) * scale, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      const previous = r?.samples[Math.max(0, state.index - 1)]?.actors.find(q => q.side === p.side && q.index === p.index);
      const damaged = previous && p.health < previous.health;
      const firing = r?.events?.some(e => e.kind === "damage" && e.tick <= sample.tick && e.tick > sample.tick - 5 && e.attackerSide === p.side && e.attackerIndex === p.index);
      const moving = previous && (previous.x !== p.x || previous.y !== p.y);
      const frame = frames.get(item, { facing: p.facing, turret: 0, tick: Math.floor(sample.tick / 3), animation: r?.request[p.side === 0 ? "a" : "b"].deploy && item.sprite?.sequences.some(s => s.name === "deployed") ? firing ? "shoot-deployed" : "deployed" : firing ? "attack" : moving ? "move" : "stand", color, shadow: true, tint: [1, 1, 1] });
      if (frame) { ctx.imageSmoothingEnabled = false; ctx.drawImage(frame.canvas, x - frame.anchorX * scale, y - frame.anchorY * scale, frame.width * scale, frame.height * scale); }
      else { ctx.fillStyle = "#e8b08c"; ctx.font = "10px Arial"; ctx.fillText(frames.failed(item) ?? "Loading art…", x, y - 20); ctx.fillStyle = `#${color}`; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); }
      const bar = Math.max(32, 40 * scale); ctx.fillStyle = "#141814"; ctx.fillRect(x - bar / 2, y - 43 * scale, bar, 4); ctx.fillStyle = `#${color}`; ctx.fillRect(x - bar / 2, y - 43 * scale, bar * p.health / p.maxHealth, 4);
      ctx.fillStyle = "#f0eee6"; ctx.font = "12px Arial"; ctx.textAlign = "center"; ctx.fillText(`${unit.name}${p.index > 1 ? ` ${p.index}` : ""}`, x, y + 30 * scale);
      if (damaged) { ctx.strokeStyle = "#f7d899"; ctx.beginPath(); ctx.arc(x, y - 10, 15, 0, Math.PI * 2); ctx.stroke(); }
    }
    for (const wreck of sample.wrecks ?? []) {
      const unit = actorMap.get(ids[wreck.side]), item = unit && stageItem(unit, null); if (!item) continue;
      const [x, y] = screen(project(wreck.x, wreck.y, wreck.z));
      const frame = frames.get(item, { facing: wreck.facing, turret: 0, tick: Math.floor(sample.tick / 3), animation: "stand", color: wreck.side === 0 ? "E04444" : "4477EE", shadow: true, tint: [.45, .45, .45] });
      if (frame) { ctx.imageSmoothingEnabled = false; ctx.drawImage(frame.canvas, x - frame.anchorX * scale, y - frame.anchorY * scale, frame.width * scale, frame.height * scale); }
      ctx.fillStyle = "#f7d899"; ctx.font = "12px Arial"; ctx.textAlign = "center"; ctx.fillText(wreck.z > 0 ? `Falling wreck · ${(wreck.z / 1024).toFixed(2)}c` : "Wreck", x, y + 30 * scale);
    }
  }, [mode, actorMap, frames, roster]);
  useEffect(() => { draw(); const off = frames.subscribe(draw), offLab = useLab.subscribe(draw); const observer = new ResizeObserver(draw); if (canvas.current) observer.observe(canvas.current); return () => { off(); offLab(); observer.disconnect(); }; }, [draw, frames]);
  useEffect(() => { draw(); }, [result, index, a, b, ranges, draw]);
  useEffect(() => {
    if (!playing || !result) return;
    const timer = setInterval(() => { if (!document.hidden) setIndex(i => { if (i >= result.samples.length - 1) { setPlaying(false); return i; } return Math.min(result.samples.length - 1, i + 1); }); }, 200 / speed);
    return () => clearInterval(timer);
  }, [playing, result, speed]);
  const run = async () => {
    setBusy(true); setError(""); setPlaying(false);
    try {
      const request: DuelRequest = { mode, a: { id: a, count: countA, deploy: deployA, faction: owner(a, factionA), ...(healthA !== 100 ? { health: Math.round((roster?.stock[a]?.behavior.health ?? 1) * healthA / 100) } : {}) }, b: { id: b, count: countB, deploy: deployB, faction: owner(b, factionB) }, gap, level };
      const response = await fetch("/api/art-review/duel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const first = await response.json(); if (!response.ok) throw new Error(first.error);
      while (!aborted.current) {
        await new Promise(r => setTimeout(r, 1000));
        const poll = await fetch(`/api/art-review/duel/${first.id}`); const job = await poll.json();
        if (!poll.ok || job.status === "failed") throw new Error(job.error);
        if (job.status === "complete") { try { const key = `rtsai-studio-notebook:${mode}`; const ids = JSON.parse(localStorage.getItem(key) ?? "[]"); localStorage.setItem(key, JSON.stringify([first.id, ...ids].slice(0, 6))); } catch { /* Storage unavailable: current match still works. */ }
          setResult(job.result); setHistory(h => [job.result, ...h].slice(0, 6)); setIndex(0); setPlaying(true); break; }
      }
    } catch (e) { if (!aborted.current) setError(e instanceof Error ? e.message : "Match failed"); }
    finally { if (!aborted.current) setBusy(false); }
  };
  const side = (id: string, set: (s: string) => void, count: number, setCount: (n: number) => void, deploy: boolean, setDeploy: (v: boolean) => void, label: string) => <div className={`arena-side is-${label}`}><span>{label === "a" ? "RED TEAM" : "BLUE TEAM"}</span><select aria-label={`${label} actor`} value={id} onChange={e => { set(e.target.value); if (label === "a") onSelect(e.target.value); setDeploy(false); }} disabled={busy}>{eligible.map(u => <option key={u.id} value={u.id}>{u.name} · {u.category}</option>)}</select><label>Count<input aria-label={`${label} count`} type="number" min={1} max={6} value={count} onChange={e => setCount(Number(e.target.value))} disabled={busy} /></label><label className="arena-faction">Faction<select aria-label={`${label} faction`} value={owner(id, label === "a" ? factionA : factionB) ?? ""} onChange={e => (label === "a" ? setFactionA : setFactionB)(e.target.value)} disabled={busy}>{owners(id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>{roster?.stock[id]?.behavior.actions.some(a => a.id === "GrantConditionOnDeploy") && <label><input type="checkbox" checked={deploy} onChange={e => setDeploy(e.target.checked)} disabled={busy} /> Start deployed</label>}</div>;
  return <div className="arena"><div className="arena-heading"><div><span className="lab-label">COMBAT PLAYGROUND</span><h2>Put the idea to the test.</h2><p>Actual game combat. Scrub the encounter, then change one thing.</p></div><span className="lab-pill is-good">{result ? "Measured · OpenRA" : "Local engine"}</span></div>
    <div className="arena-matchup">{side(a, setA, countA, setCountA, deployA, setDeployA, "a")}<Swords size={24} />{side(b, setB, countB, setCountB, deployB, setDeployB, "b")}</div>
    <div className="arena-options"><label title="Separation in map columns; RA2's isometric columns span more than one world cell">Starting gap <input type="range" min={4} max={24} value={gap} onChange={e => setGap(Number(e.target.value))} disabled={busy} /><b>{gap} map columns</b></label><label>Veterancy<select value={level} onChange={e => setLevel(Number(e.target.value))} disabled={busy}><option value={0}>Rookie</option><option value={1}>Veteran</option><option value={2}>Elite</option></select></label><label title="A disposable rule override; never changes the mod">Red health<input type="range" min={50} max={200} step={5} value={healthA} onChange={e => setHealthA(Number(e.target.value))} disabled={busy} /><b>{healthA}%</b></label><button className="lab-primary" disabled={busy} onClick={() => void run()}>{busy ? "Running the engine…" : "Run encounter"}</button></div>
    {error && <p className="arena-error" role="alert">{error}</p>}
    <div className="arena-field"><canvas ref={canvas} aria-label="Combat replay" /><span className="arena-caption">{result ? "Positions & health measured · effects & animation illustrative" : "Preview · run an encounter to measure combat"}</span></div>
    <div className="arena-timeline"><button className="lab-icon-btn" aria-label="Restart replay" onClick={() => { setIndex(0); setPlaying(true); }} disabled={!result}><RotateCcw size={16} /></button><button className="lab-icon-btn" aria-label={playing ? "Pause replay" : "Play replay"} onClick={() => setPlaying(v => !v)} disabled={!result}>{playing ? <Pause size={17} /> : <Play size={17} />}</button><input aria-label="Replay position" type="range" min={0} max={Math.max(1, (result?.samples.length ?? 1) - 1)} value={index} onChange={e => { setPlaying(false); setIndex(Number(e.target.value)); }} disabled={!result} /><b>{((result?.samples[index]?.tick ?? 0) / 25).toFixed(1)}s</b><select aria-label="Replay speed" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={.5}>½×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select><label><input type="checkbox" checked={ranges} onChange={e => setRanges(e.target.checked)} /> Range</label></div>
    {history.length > 0 && <div className="arena-history"><h3>Encounter notebook <small>Measured · one run per row</small></h3><table><thead><tr><th>Match</th><th>Red remaining</th><th>Blue remaining</th><th>Time</th></tr></thead><tbody>{history.map((r, i) => { const last = r.samples.at(-1)!; return <tr key={i} onClick={() => restore(r)}><td>{actorMap.get(r.request.a.id)?.name} ×{r.request.a.count} <span>vs</span> {actorMap.get(r.request.b.id)?.name} ×{r.request.b.count}</td><td>{last.actors.filter(a => a.side === 0).length}</td><td>{last.actors.filter(a => a.side === 1).length}</td><td>{last.tick / 25}s</td></tr>; })}</tbody></table></div>}
    <p className="arena-note">Actual faction owners · land, water or coast selected for the actors · no aircraft service base. Use repeated runs and equal costs before drawing balance conclusions.</p>
  </div>;
}
