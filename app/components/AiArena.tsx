"use client";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Bot, BrainCircuit, Compass, Crown, Gamepad2, KeyRound, Play, Square, Swords, Timer, Coins, Check, X, Minus } from "lucide-react";
import { factions } from "../../lib/game-content";
import { FactionFlag } from "./FactionVisuals";
import { OptionSelect, type Option } from "./ui/fields";

// The AI Arena runner (RTSAI-WebGame tools/arena/server.mjs) on this machine; the page shows nothing useful without it.
const endpoint = "http://127.0.0.1:3463";
const OPPONENT_ORDER = ["easy", "normal", "rush", "hard", "brutal"] as const;
const SKILL: Record<string, number> = { easy: 1, normal: 2, rush: 3, hard: 4, brutal: 5 };

type Provider = { label: string; paid: boolean; ready: boolean; keyHint: string; price: { input: number } | null };
type Job = { index: number; opponent: string; ours: string; theirs: string; state: string; gameSeconds?: number; decisions?: number; result?: string; gameId?: string };
type Run = { id: string; status: string; brain: string; provider: string | null; capUsd: number; spentUsd: number; jobs: Job[]; note?: string };
type Status = { ready: boolean; page: { page: string; release: string; since: string } | null; providers: Record<string, Provider>; opponents: Record<string, { label: string; hint: string }>;
  factions: string[]; maps: string[]; budget: { dailyCapUsd: number; spentToday: number; maxParallel: number }; runs: Run[] };
type Game = { id: string; brain: string; provider: string | null; opponent: string; ours: string; theirs: string; map: string; result: string; gameSeconds: number; wallSeconds: number;
  decisionCount: number; questionCount: number; usd: number; ms: { p50: number; p95: number }; fallbacks: number; finishedAt: string; us?: { killsCost: number; deathsCost: number }; stopReason?: string };
type Summary = { matrix: Record<string, Record<string, { win: number; draw: number; loss: number }>>; ladder: { id: string; label: string; rating: number; games: number; kind: string }[];
  perf: Record<string, { label: string; games: number; decisions: number; usdPerGame: number; msMedian: number; wallPerGame: number; fallbacks: number }>; games: Game[] };
type Decision = { tick: number; auto: { label: string; accepted: boolean }[]; questions: { name: string; instructions: string; choice: string | null; accepted?: boolean; options: { value: string; label: string; p: number }[] }[]; ms: number; usd: number; fallback?: boolean };

const competitor = (g: { brain: string; provider: string | null }) => (g.brain === "decision" ? `decision:${g.provider}` : g.brain);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const money = (usd: number) => (usd === 0 ? "$0" : usd < 0.01 ? `${(usd * 100).toFixed(2)}¢` : `$${usd.toFixed(2)}`);
function faction(id: string) {
  const f = factions.find(x => x.id === (id === "saudi" ? "saudi-arabia" : id));
  return { id, name: f?.name ?? id, accent: f?.accent ?? "#c9b782" };
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(endpoint + path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

const BRAIN_TILES = [
  { id: "decision", label: "Decision brain", icon: BrainCircuit, hint: "Picks from the options a turn allows" },
  { id: "adviser", label: "Built-in adviser", icon: Compass, hint: "The public game's co-commander" },
  { id: "bot", label: "Normal AI", icon: Bot, hint: "The engine's AI in our seat" },
] as const;

export function AiArena() {
  const [status, setStatus] = useState<Status | null>(null), [offline, setOffline] = useState(false), [summary, setSummary] = useState<Summary | null>(null);
  const [brain, setBrain] = useState<string>("decision"), [provider, setProvider] = useState("scripted");
  const [opponents, setOpponents] = useState<string[]>(["normal", "rush", "hard", "brutal"]), [games, setGames] = useState(2);
  const [side, setSide] = useState("rotate"), [map, setMap] = useState("ra2-tournament-2B"), [cap, setCap] = useState(1);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [key, setKey] = useState("");
  const [selected, setSelected] = useState<string | null>(null), [log, setLog] = useState<Decision[] | null>(null), [filter, setFilter] = useState<{ c?: string; o?: string }>({});

  const refresh = useCallback(async () => {
    try { const [s, m] = await Promise.all([api<Status>("/status"), api<Summary>("/summary")]); setStatus(s); setSummary(m); setOffline(false); }
    catch { setOffline(true); }
  }, []);
  useEffect(() => { const first = setTimeout(refresh, 0); const t = setInterval(refresh, 4000); return () => { clearTimeout(first); clearInterval(t); }; }, [refresh]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    api<Decision[]>(`/games/${selected}/decisions`).then(d => { if (live) setLog(d); }).catch(() => { if (live) setLog([]); });
    return () => { live = false; };
  }, [selected]);

  const p = status?.providers[provider];
  const paid = brain === "decision" && !!p?.paid;
  const total = opponents.length * games;
  const avgWall = summary?.perf[brain === "decision" ? `decision:${provider}` : brain]?.wallPerGame || 300;
  const minutes = Math.max(1, Math.round(total * avgWall / 60 / (status?.budget.maxParallel ?? 2)));
  const canStart = !!status?.ready && opponents.length > 0 && !busy && (brain !== "decision" || !!p?.ready);

  async function start() {
    setBusy(true); setError(""); setNotice("");
    try {
      await api("/runs", { brain, provider, opponents, games, ours: side, theirs: "mirror", map, capUsd: cap, speed: 6 });
      setNotice(`${total} game${total === 1 ? "" : "s"} queued.`); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function play(opponent: string) {
    setError("");
    try { await api("/play", { opponent, ours: side === "rotate" ? "saudi" : side, theirs: "mirror", map }); setNotice(`A game window is opening: you vs ${status?.opponents[opponent]?.label}. Your result lands on the ladder when the match ends.`); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function saveKey() {
    try { await api("/keys", { provider, key }); setKey(""); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  const rows = useMemo(() => {
    const ids = Object.keys(summary?.matrix ?? {});
    return ids.sort((a, b) => (summary!.ladder.find(l => l.id === b)?.rating ?? 0) - (summary!.ladder.find(l => l.id === a)?.rating ?? 0));
  }, [summary]);
  const label = (id: string) => summary?.ladder.find(l => l.id === id)?.label ?? summary?.perf[id]?.label ?? id;
  const shown = (summary?.games ?? []).filter(g => (!filter.c || competitor(g) === filter.c) && (!filter.o || g.opponent === filter.o)).slice(0, 40);
  const activeRuns = (status?.runs ?? []).filter(r => ["queued", "running"].includes(r.status));
  const ladder = summary?.ladder ?? [];
  const [lo, hi] = ladder.length ? [Math.min(...ladder.map(l => l.rating)) - 60, Math.max(...ladder.map(l => l.rating)) + 20] : [0, 1];

  if (offline && !status) return <section className="arena-offline">
    <Swords size={40} aria-hidden="true" />
    <h2>The Arena runner is not running</h2>
    <p>It plays the matches on this machine. The local app starts it; to start it by hand:</p>
    <code>node tools/arena/server.mjs</code><small>in RTSAI-WebGame</small>
  </section>;

  return <div className="arena">
    <div className="arena-strip" aria-live="polite">
      <span className={status?.ready ? "ok" : "warn"}><i />{status?.ready ? "Runner online" : offline ? "Runner offline" : "No live game to test"}</span>
      {status?.page && <span title={`Release ${status.page.release}`}><Gamepad2 size={14} aria-hidden="true" />Live game {status.page.page} · {new Date(status.page.since).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>}
      {status && <span><Coins size={14} aria-hidden="true" />Today {money(status.budget.spentToday)} of {money(status.budget.dailyCapUsd)}</span>}
    </div>

    <div className="arena-layout">
      <aside className="arena-panel">
        <h2>Brain</h2>
        <div className="arena-tiles">{BRAIN_TILES.map(t => <button key={t.id} className={brain === t.id ? "active" : ""} onClick={() => setBrain(t.id)}><t.icon size={22} aria-hidden="true" /><b>{t.label}</b><small>{t.hint}</small></button>)}</div>
        {brain === "decision" && status && <>
          <h3>Who answers</h3>
          <div className="arena-providers">{Object.entries(status.providers).map(([id, v]) => <button key={id} className={provider === id ? "active" : ""} onClick={() => setProvider(id)}>
            <b>{v.label}</b><small>{v.paid ? `$${v.price?.input}/M tokens` : id === "local" ? (v.ready ? "Free · on this PC" : "Free · not running") : "Free"}</small>
            {v.paid && !v.ready && <KeyRound size={13} aria-label="Needs a key" />}
          </button>)}</div>
          {paid && !p!.ready && <div className="arena-key"><label>Your {p!.label} key<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="Paste key" /></label><button onClick={saveKey} disabled={!key}>Save</button><small>Kept on this PC only.</small></div>}
          {paid && p!.ready && <p className="arena-keyhint"><KeyRound size={13} aria-hidden="true" /> Key {p!.keyHint} <button onClick={() => { setKey(""); void api("/keys", { provider, key: "" }).then(refresh); }}>Remove</button></p>}
          {provider === "local" && !p?.ready && <p className="arena-hint">Start the local AI stack (gateway on port 4000) to use it.</p>}
        </>}

        <h2>Opponents</h2>
        <div className="arena-opponents">{OPPONENT_ORDER.map(o => <button key={o} className={opponents.includes(o) ? "active" : ""} title={status?.opponents[o]?.hint} onClick={() => setOpponents(v => v.includes(o) ? v.filter(x => x !== o) : [...v, o].sort((a, b) => SKILL[a] - SKILL[b]))}>
          <span className="pips" aria-hidden="true">{[1, 2, 3, 4, 5].map(i => <i key={i} className={i <= SKILL[o] ? "on" : ""} />)}</span>{status?.opponents[o]?.label ?? o}
        </button>)}</div>
        <div className="arena-two">
          <label>Games each<OptionSelect value={games} onValueChange={setGames} options={[1, 2, 4, 6, 10].map(n => ({ value: n, label: String(n) }))} /></label>
          <label>Map<OptionSelect value={map} onValueChange={setMap} options={(status?.maps ?? [map]).map(m => ({ value: m, label: m.replace(/^ra2-/, "").replace(/-/g, " ") }))} /></label>
        </div>
        <label>Faction (both sides)<OptionSelect value={side} onValueChange={setSide} options={[{ value: "rotate", label: "Rotate the seven factions" }, ...(status?.factions ?? []).map(f => ({ value: f, label: faction(f).name }))] as Option[]} /></label>
        {paid && <label>Spending cap for this run<OptionSelect value={cap} onValueChange={setCap} options={[0.25, 1, 2, 5].map(n => ({ value: n, label: `$${n.toFixed(2)}` }))} /></label>}
        <button className="primary" disabled={!canStart} onClick={start}><Play size={15} aria-hidden="true" />Play {total} game{total === 1 ? "" : "s"}</button>
        <p className="arena-estimate">≈ {minutes} min{paid ? ` · at most ${money(cap)}` : " · free"}</p>
        {error && <p className="arena-error" role="alert">{error}</p>}
        {notice && <p className="arena-notice">{notice}</p>}

        <h2 className="arena-you"><Crown size={16} aria-hidden="true" />Play it yourself</h2>
        <div className="arena-opponents compact">{OPPONENT_ORDER.map(o => <button key={o} onClick={() => play(o)} disabled={!status?.ready}>vs {status?.opponents[o]?.label ?? o}</button>)}</div>
      </aside>

      <section className="arena-results">
        {activeRuns.map(r => <div key={r.id} className="arena-card arena-run">
          <div className="arena-heading"><h2>{r.brain === "decision" ? `Decision · ${status?.providers[r.provider ?? ""]?.label ?? r.provider}` : r.brain === "you" ? "You" : r.brain === "adviser" ? "Built-in adviser" : "Normal AI"} playing</h2>
            <span>{r.jobs.filter(j => j.state === "done").length} / {r.jobs.length}{r.spentUsd ? ` · ${money(r.spentUsd)}` : ""}</span>
            <button onClick={() => void api(`/runs/${r.id}/stop`, {}).then(refresh)}><Square size={13} aria-hidden="true" />Stop</button></div>
          <div className="arena-jobs">{r.jobs.map(j => <span key={j.index} className={`job ${j.state} ${j.result ?? ""}`} title={`${faction(j.ours).name} vs ${status?.opponents[j.opponent]?.label}`}>
            <b>{status?.opponents[j.opponent]?.label}</b>{j.state === "running" ? <small>{clock(j.gameSeconds ?? 0)} · {j.decisions ?? 0}</small> : j.result ? <small>{j.result}</small> : <small>{j.state}</small>}
          </span>)}</div>
        </div>)}

        <div className="arena-card">
          <div className="arena-heading"><h2>Ladder</h2><span>Rating from every finished game · Normal AI = 1000</span></div>
          {ladder.length ? <ol className="arena-ladder">{ladder.map(l => <li key={l.id} className={l.kind}>
            <button className="name" disabled={l.kind === "opponent"} title={l.kind === "opponent" ? undefined : `Show ${l.label}'s games`} onClick={() => setFilter({ c: l.id })}>{l.kind === "you" ? <Crown size={14} aria-hidden="true" /> : l.kind === "opponent" ? <Bot size={14} aria-hidden="true" /> : <BrainCircuit size={14} aria-hidden="true" />}{l.label}</button>
            <span className="bar"><i style={{ width: `${Math.max(3, (l.rating - lo) / (hi - lo) * 100)}%` }} /></span>
            <b>{l.rating}</b><small>{l.games} games</small>
          </li>)}</ol> : <p className="arena-empty">No finished games yet. Start a run, or play one yourself.</p>}
        </div>

        {rows.length > 0 && <div className="arena-card">
          <div className="arena-heading"><h2>Wins against each AI</h2><span>win – loss (– draw)</span></div>
          <div className="arena-matrix" style={{ "--cols": OPPONENT_ORDER.length } as CSSProperties}>
            <span />{OPPONENT_ORDER.map(o => <span key={o} className="col"><span className="pips" aria-hidden="true">{[1, 2, 3, 4, 5].map(i => <i key={i} className={i <= SKILL[o] ? "on" : ""} />)}</span>{status?.opponents[o]?.label ?? o}</span>)}
            {rows.map(c => <div key={c} className="row">
              <span className="who">{label(c)}</span>
              {OPPONENT_ORDER.map(o => {
                const cell = summary!.matrix[c]?.[o];
                if (!cell) return <span key={o} className="cell none">·</span>;
                const n = cell.win + cell.loss + cell.draw, rate = (cell.win + cell.draw / 2) / n;
                return <button key={o} className="cell" style={{ "--rate": rate } as CSSProperties} onClick={() => setFilter({ c, o })} title={`${Math.round(rate * 100)}% over ${n} games`}>
                  <b>{cell.win}–{cell.loss}{cell.draw ? `–${cell.draw}` : ""}</b><small>{Math.round(rate * 100)}%</small></button>;
              })}
            </div>)}
          </div>
        </div>}

        {summary && Object.keys(summary.perf).length > 0 && <div className="arena-card">
          <div className="arena-heading"><h2>Speed and cost</h2><span>per brain</span></div>
          <div className="arena-perf">{Object.entries(summary.perf).filter(([id]) => id !== "bot").map(([id, v]) => <div key={id}>
            <b>{v.label}</b>
            <span><Timer size={13} aria-hidden="true" />{id.startsWith("decision:") ? `${v.msMedian} ms a turn` : "—"}</span>
            <span><Coins size={13} aria-hidden="true" />{money(v.usdPerGame)} a game</span>
            <span><BrainCircuit size={13} aria-hidden="true" />{Math.round(v.decisions / Math.max(1, v.games))} turns a game</span>
            {v.fallbacks > 0 && <span className="warn">{v.fallbacks} failed calls</span>}
          </div>)}</div>
        </div>}

        {summary && summary.games.length > 0 && <div className="arena-card">
          <div className="arena-heading"><h2>Games</h2>
            {(filter.c || filter.o) ? <button onClick={() => setFilter({})}><X size={13} aria-hidden="true" />{[filter.c && label(filter.c), filter.o && status?.opponents[filter.o]?.label].filter(Boolean).join(" vs ")}</button> : <span>newest first</span>}</div>
          <ul className="arena-games">{shown.map(g => <li key={g.id} className={selected === g.id ? "open" : ""}>
            <button onClick={() => { setLog(null); setSelected(selected === g.id ? null : g.id); }}>
              <span className={`result ${g.result}`}>{g.result === "win" ? <Check size={14} /> : g.result === "loss" ? <X size={14} /> : <Minus size={14} />}{g.result}</span>
              <span className="side"><FactionFlag factionId={faction(g.ours).id === "saudi" ? "saudi-arabia" : g.ours} name={faction(g.ours).name} accent={faction(g.ours).accent} size="sm" />{label(competitor(g))}</span>
              <span className="vs">vs {status?.opponents[g.opponent]?.label ?? g.opponent}</span>
              <span>{clock(g.gameSeconds)}</span>
              <span>{g.decisionCount} turns</span>
              <span>{g.ms?.p50 ? `${g.ms.p50} ms` : ""}</span>
              <span>{g.usd ? money(g.usd) : ""}</span>
            </button>
            {selected === g.id && <DecisionLog log={log} />}
          </li>)}</ul>
        </div>}
      </section>
    </div>
  </div>;
}

const QUESTION_LABEL: Record<string, string> = { build: "Build", defense: "Defense", infantry: "Infantry", vehicle: "Vehicles", aircraft: "Aircraft", ship: "Ships", army: "Army", advice: "Adviser" };

function DecisionLog({ log }: { log: Decision[] | null }) {
  if (!log) return <p className="arena-empty">Loading the decisions…</p>;
  const asked = log.filter(d => d.questions.length);
  if (!asked.length) return <p className="arena-empty">This brain makes no recorded choices: the engine&apos;s own AI plays.</p>;
  return <ol className="arena-log">{asked.slice(0, 400).map((d, i) => <li key={i}>
    <span className="when">{clock(d.tick / 25)}</span>
    <div className="qs">{d.questions.map(q => {
      const top = [...q.options].sort((a, b) => b.p - a.p).slice(0, 3);
      return <div key={q.name} className={`q ${q.accepted === false ? "refused" : ""}`}>
        <span className="qn">{QUESTION_LABEL[q.name] ?? q.name}</span>
        <div className="opts">{top.map(o => <span key={o.value} className={o.value === q.choice ? "chosen" : ""}><i style={{ width: `${Math.round(o.p * 100)}%` }} /><em>{o.label}</em><small>{Math.round(o.p * 100)}%</small></span>)}</div>
      </div>;
    })}</div>
    <span className="cost">{d.fallback ? "fallback" : d.ms ? `${d.ms} ms` : ""}{d.usd ? ` · ${money(d.usd)}` : ""}</span>
  </li>)}</ol>;
}
