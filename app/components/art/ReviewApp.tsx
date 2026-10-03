"use client";

/* Candidate images come from the local dev route at their own sizes; next/image cannot serve them. */
/* eslint-disable @next/next/no-img-element */
import { Check, MessageSquare, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderInGame } from "../../../lib/art-lab/client";
import type { RenderSpec } from "../../../lib/art-lab/spec";
import type { SpriteArt } from "../../../lib/art-lab/types";
import {
  candidateRenderSpec, effectiveStatus, hasViewableFiles, needsAttention, reviewStatuses,
  type Candidate, type ReviewAction, type ReviewEntry, type ReviewState, type ReviewStatus, type UnitWorkspace,
} from "../../../lib/art-lab/review";
import type { MapTint } from "./ArtToolbar";
import { PixelCanvas, type PixelImage } from "./PixelCanvas";
import { SpriteViewer } from "./SpriteViewer";
import { VoxelViewer } from "./VoxelViewer";
import "../../art-lab.css";

export type ReviewUnit = {
  id: string; factionId: string; factionName: string; name: string; category: string; role: string;
  spec: RenderSpec; sprite: SpriteArt | null;
};

type Filter = "attention" | "candidates" | "all" | ReviewStatus;

const API = "/api/art-review";

async function post(action: ReviewAction): Promise<ReviewEntry> {
  const response = await fetch(`${API}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
  const payload = await response.json() as { entry?: ReviewEntry; error?: string };
  if (!response.ok || !payload.entry) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload.entry;
}

function StatusPill({ status }: { status: ReviewStatus | "none" }) {
  return <span className={`review-pill is-${status}`}>{status === "none" ? "no candidates" : status}</span>;
}

function CurrentThumb({ spec }: { spec: RenderSpec }) {
  const [image, setImage] = useState<PixelImage | null>(null);
  useEffect(() => {
    let cancelled = false;
    renderInGame(spec, { facing: 896, color: "F21818" }).then(i => { if (!cancelled) setImage(i); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [spec]);
  return image ? <PixelCanvas image={image} zoom={2} backdrop="sand" diamond label={`${spec.name} as shipped`} /> : <span className="art-tile-wait">Rendering…</span>;
}

/** Stock RA2 voxels from reference-local, drawn with RA2 vehicle defaults. Local comparison only. */
function stockSpec(base: RenderSpec, state: ReviewState, stockId: string): RenderSpec | null {
  const unit = state.stock.find(s => s.id === stockId);
  if (!unit || !state.stockPalette || !base.palette) return null;
  const url = (f: string) => `${API}/file?path=${encodeURIComponent(`reference-local/ra2-stock/${f}`)}`;
  const parts = unit.parts.map(part => {
    const name = part === "body" ? stockId : `${stockId}${part}`;
    return {
      id: `stock:${name}`, label: part === "body" ? "body" : part === "tur" ? "turret" : part === "barl" ? "barrel" : part, trait: part,
      vxl: url(`${name}.vxl`), hva: url(`${name}.hva`), offset: [0, 0, 0] as [number, number, number], showShadow: true, requiresCondition: null,
      turretOffset: part === "body" ? null : [0, 0, 0] as [number, number, number], turretInitialFacing: null, tickRate: null, frames: 1,
    };
  });
  return {
    ...base, id: `stock:${stockId}`, name: `RA2 ${stockId} (local reference)`, cameo: null,
    palette: { name: "unittem.pal", url: state.stockPalette, remap: base.palette.remap.length ? Array.from({ length: 16 }, (_, i) => 16 + i) : [], transparent: [0], shadow: [] },
    voxel: { scale: 11.7, cameraPitch: 85, lightPitch: 150, lightYaw: 800, ambient: [-0.5, -0.5, -0.5], diffuse: [1.4, 1.4, 1.4], useClassicPerspectiveFudge: false, normals: "RedAlert2", altitude: null, parts },
    sprite: null,
  };
}

function candidateSpriteSpec(unit: ReviewUnit, candidate: Candidate) {
  const shp = candidate.files.shp?.[0];
  if (!shp || !unit.sprite || !unit.spec.sprite) return null;
  const shpUrl = candidate.urls[shp];
  const palUrl = candidate.files.pal ? candidate.urls[candidate.files.pal] : null;
  if (!shpUrl) return null;
  const swap = <T extends { file: string | null } | null>(s: T): T => (s && s.file ? { ...s, file: shpUrl } : s);
  const spec: RenderSpec = {
    ...unit.spec, id: `${unit.id}:${candidate.id}`, name: `${unit.name} · ${candidate.id}`,
    palette: palUrl && unit.spec.palette ? { ...unit.spec.palette, url: palUrl } : unit.spec.palette,
    sprite: { ...unit.spec.sprite, stand: swap(unit.spec.sprite.stand), turret: swap(unit.spec.sprite.turret), overlay: swap(unit.spec.sprite.overlay) },
  };
  const sprite: SpriteArt = { ...unit.sprite, sequences: unit.sprite.sequences.map(s => (s.file && !s.inherited && !s.file.endsWith(".png") ? { ...s, file: shpUrl } : s)) };
  return { spec, sprite };
}

function CandidateCard({ unit, candidate, focused, approved, onFocus, tints }: {
  unit: ReviewUnit; candidate: Candidate; focused: boolean; approved: boolean; onFocus: () => void; tints: MapTint[];
}) {
  const f = candidate.files;
  const voxelSpec = useMemo(() => candidateRenderSpec(unit.spec, candidate), [unit.spec, candidate]);
  const sprite = useMemo(() => candidateSpriteSpec(unit, candidate), [unit, candidate]);
  const scores = Object.entries(candidate.scores ?? {});
  return (
    <article className={`review-candidate ${focused ? "is-focused" : ""} ${approved ? "is-approved" : ""}`} aria-label={`Candidate ${candidate.id}`}>
      <header>
        <button type="button" className="review-focus" aria-pressed={focused} onClick={onFocus}>{focused ? "Selected" : "Select"}</button>
        <b>{candidate.id}</b>
        <span className="review-kind">{candidate.kind}</span>
        {approved && <span className="review-pill is-approved">approved</span>}
        {candidate.fixture && <span className="review-pill is-draft">fixture</span>}
      </header>
      <p className="review-meta">{candidate.model ?? "unknown model"} · {candidate.createdAt ? new Date(candidate.createdAt).toLocaleString() : "no date"}{typeof candidate.costUsd === "number" ? ` · $${candidate.costUsd.toFixed(3)}` : ""}{candidate.seed !== undefined && candidate.seed !== null ? ` · seed ${candidate.seed}` : ""}{candidate.refusals?.length ? ` · ${candidate.refusals.length} refusal(s)` : ""}</p>
      {candidate.metaError && <p className="art-warn">{candidate.metaError}</p>}
      {f.cameo && candidate.urls[f.cameo] && (
        <div className="review-cameos">
          <img src={candidate.urls[f.cameo]} width={60} height={48} alt="" className="art-cameo-native" />
          <img src={candidate.urls[f.cameo]} width={120} height={96} alt={`${candidate.id} cameo at 2x`} className="art-cameo-2x" />
          {unit.spec.cameo && <span className="review-vs"><img src={unit.spec.cameo} width={60} height={48} alt="current cameo" className="art-cameo-native" /><small>current</small></span>}
        </div>
      )}
      {f.concept && candidate.urls[f.concept] && <a href={candidate.urls[f.concept]} target="_blank" rel="noreferrer"><img src={candidate.urls[f.concept]} alt={`${candidate.id} concept`} className="review-concept" loading="lazy" /></a>}
      {voxelSpec && focused && <VoxelViewer spec={voxelSpec} tints={tints} feedback={null} />}
      {voxelSpec && !focused && <p className="art-hint">Voxel candidate ({f.vxl?.length} VXL). Focus the card to load it in the viewer.</p>}
      {sprite && focused && <SpriteViewer spec={sprite.spec} sprite={sprite.sprite} tints={tints} feedback={null} />}
      {!!f.previews?.length && (
        <details className="review-previews"><summary>Forge previews ({f.previews.length}){candidate.previewNote ? " · made outside the game" : ""}</summary>
          {candidate.previewNote && <p className="art-hint">{candidate.previewNote}</p>}
          {f.previews.map(p => candidate.urls[p] && <a key={p} href={candidate.urls[p]} target="_blank" rel="noreferrer"><img src={candidate.urls[p]} alt={p} loading="lazy" /></a>)}
        </details>
      )}
      {(scores.length > 0 || candidate.critique) && (
        <div className="review-critique">
          {scores.length > 0 && <ul>{scores.map(([k, v]) => <li key={k}><b>{k}</b> {typeof v === "object" ? JSON.stringify(v) : String(v)}</li>)}</ul>}
          {candidate.critique && <p>{candidate.critique}</p>}
        </div>
      )}
      {!hasViewableFiles(candidate) && <p className="art-hint">No viewable files yet.</p>}
      {candidate.prompt && <details><summary>Prompt</summary><p className="art-hint">{candidate.prompt}</p></details>}
    </article>
  );
}

export function ReviewApp({ units, tints }: { units: ReviewUnit[]; tints: MapTint[] }) {
  const [state, setState] = useState<ReviewState | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("attention");
  const [faction, setFaction] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [composer, setComposer] = useState<{ type: "comment" | "approve" | "reject" } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [stockId, setStockId] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API}/state`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setState(await response.json() as ReviewState);
      setError("");
    } catch (cause) {
      setError(`Could not read the RTSAI-Art workspace: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of the local workspace
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const workspace = useMemo(() => new Map((state?.units ?? []).map(u => [u.actor, u])), [state]);
  const rows = useMemo(() => units.map(u => {
    const ws: UnitWorkspace | undefined = workspace.get(u.id);
    const entry = state?.review[u.id];
    const candidates = ws?.candidates ?? [];
    return { unit: u, ws, entry, candidates, attention: ws ? needsAttention(ws, entry) : false, status: candidates.length || entry ? effectiveStatus(entry) : "none" as const };
  }), [units, workspace, state]);
  const visible = rows.filter(r =>
    (faction === "all" || r.unit.factionId === faction) &&
    (filter === "all" || (filter === "attention" ? r.attention : filter === "candidates" ? r.candidates.length > 0 : r.status === filter)));
  const attentionCount = rows.filter(r => r.attention).length;
  const current = rows.find(r => r.unit.id === selected) ?? visible[0] ?? null;
  const candidates = current?.candidates ?? [];
  const focused = candidates[Math.min(focusIndex, Math.max(0, candidates.length - 1))] ?? null;
  const factions = [...new Map(units.map(u => [u.factionId, u.factionName])).entries()];

  const move = (delta: number) => {
    if (!visible.length) return;
    const index = Math.max(0, visible.findIndex(r => r.unit.id === current?.unit.id));
    const next = visible[(index + delta + visible.length) % visible.length];
    setSelected(next.unit.id);
    setFocusIndex(0);
    setComposer(null);
  };

  const act = async (action: ReviewAction, message: string) => {
    setBusy(true);
    try {
      const entry = await post(action);
      setState(s => (s ? { ...s, review: { ...s.review, [action.actor]: entry } } : s));
      setToast(message);
      setComposer(null);
      setText("");
    } catch (cause) {
      setToast(`Not saved: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const submitComposer = () => {
    if (!current || !composer) return;
    const view = focused ? `${focused.kind} candidate` : "unit";
    if (composer.type === "comment") {
      if (!text.trim()) return;
      void act({ type: "comment", actor: current.unit.id, candidate: focused?.id ?? null, view, text }, "Comment saved to review.json");
    } else if (focused) {
      void act({ type: composer.type, actor: current.unit.id, candidate: focused.id, view, text }, `${composer.type === "approve" ? "Approved" : "Rejected"} ${focused.id}`);
    }
  };
  // The key handler reads the latest render through a ref, so it subscribes once.
  const keyState = useRef({ move, candidates, focused, current });
  useEffect(() => { keyState.current = { move, candidates, focused, current }; });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select") || target.isContentEditable)) {
        if (event.key === "Escape") setComposer(null);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const { move, candidates, focused, current } = keyState.current;
      if (key === "j" || event.key === "ArrowDown") { move(1); event.preventDefault(); }
      else if (key === "k" || event.key === "ArrowUp") { move(-1); event.preventDefault(); }
      else if (key === "l" || key === "]") { setFocusIndex(i => Math.min(i + 1, Math.max(0, candidates.length - 1))); event.preventDefault(); }
      else if (key === "h" || key === "[") { setFocusIndex(i => Math.max(0, i - 1)); event.preventDefault(); }
      else if (key === "a" && focused) { setComposer({ type: "approve" }); event.preventDefault(); }
      else if (key === "r" && focused) { setComposer({ type: "reject" }); event.preventDefault(); }
      else if (key === "c" && current) { setComposer({ type: "comment" }); event.preventDefault(); }
      else if (event.key === "Escape") setComposer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (composer) textRef.current?.focus(); }, [composer]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  const stock = state && current && stockId ? stockSpec(current.unit.spec, state, stockId) : null;
  const entry = current?.entry;

  return (
    <div className="review">
      <header className="review-head">
        <div>
          <span className="eyebrow">Local only · npm run dev</span>
          <h1>Review</h1>
          <p className="art-hint">Candidates from <code>{state?.root ?? "RTSAI-Art"}</code>, read in place through a dev-only route. Decisions are written to <code>review.json</code> there. This tab and its API do not exist in production builds.</p>
        </div>
        <button type="button" className="art-check" onClick={() => void load()}><RefreshCw size={14} /> Reload</button>
      </header>
      {error && <p className="art-warn">{error}</p>}
      {state && !state.exists && <p className="art-warn">No workspace at {state.root}.</p>}
      {state?.errors.length ? <ul className="art-warn">{state.errors.map(e => <li key={e}>{e}</li>)}</ul> : null}
      <p className="review-keys" aria-label="Keyboard shortcuts"><kbd>J</kbd>/<kbd>K</kbd> next/previous unit · <kbd>H</kbd>/<kbd>L</kbd> previous/next candidate · <kbd>A</kbd> approve · <kbd>R</kbd> reject · <kbd>C</kbd> comment · <kbd>Esc</kbd> cancel</p>
      <div className="review-layout">
        <aside className="review-queue" aria-label="Units">
          <div className="review-filters">
            <label className="art-control"><span>Faction</span><select value={faction} onChange={e => setFaction(e.target.value)}><option value="all">All</option>{factions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <label className="art-control"><span>Status</span><select value={filter} onChange={e => setFilter(e.target.value as Filter)}>
              <option value="attention">Needs attention ({attentionCount})</option>
              <option value="candidates">Has candidates</option>
              {reviewStatuses.map(s => <option key={s} value={s}>{s}</option>)}
              <option value="all">All units</option>
            </select></label>
          </div>
          <ol>
            {visible.map(r => (
              <li key={r.unit.id}>
                <button type="button" aria-current={current?.unit.id === r.unit.id ? "true" : undefined} onClick={() => { setSelected(r.unit.id); setFocusIndex(0); setComposer(null); }}>
                  {r.unit.spec.cameo ? <img src={r.unit.spec.cameo} width={30} height={24} alt="" /> : <span className="review-noicon" />}
                  <span><b>{r.unit.name}</b><small>{r.unit.factionName} · {r.candidates.length} candidate{r.candidates.length === 1 ? "" : "s"}</small></span>
                  {r.attention && <i className="review-dot" aria-label="needs attention" />}
                  <StatusPill status={r.status} />
                </button>
              </li>
            ))}
            {!visible.length && <li className="art-hint">Nothing matches. {filter === "attention" ? "The queue is clear." : ""}</li>}
          </ol>
        </aside>
        {current && (
          <section className="review-main" aria-label={current.unit.name}>
            <header className="review-unit-head">
              <div>
                <span className="eyebrow">{current.unit.factionName} · {current.unit.category} · {current.unit.role}</span>
                <h2>{current.unit.name} <code>{current.unit.id}</code></h2>
                <p><StatusPill status={current.status} /> {entry?.approved ? <>approved candidate <code>{entry.approved}</code></> : null} · <Link href={`/art/${current.unit.factionId}/${current.unit.id}`}>Unit page →</Link></p>
              </div>
              <div className="review-actions">
                <button type="button" className="art-check" disabled={!focused || busy} onClick={() => setComposer({ type: "approve" })}><Check size={14} /> Approve <kbd>A</kbd></button>
                <button type="button" className="art-check" disabled={!focused || busy} onClick={() => setComposer({ type: "reject" })}><X size={14} /> Reject <kbd>R</kbd></button>
                <button type="button" className="art-check" disabled={busy} onClick={() => setComposer({ type: "comment" })}><MessageSquare size={14} /> Comment <kbd>C</kbd></button>
              </div>
            </header>
            {composer && (
              <form className="review-composer" onSubmit={e => { e.preventDefault(); submitComposer(); }}>
                <label htmlFor="review-text">{composer.type === "comment" ? `Comment${focused ? ` on ${focused.id}` : ""}` : `${composer.type === "approve" ? "Approve" : "Reject"} ${focused?.id} — optional note`}</label>
                <textarea id="review-text" ref={textRef} value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={4000}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitComposer(); } }} />
                <div><button type="submit" className="art-check" disabled={busy || (composer.type === "comment" && !text.trim())}>Save <kbd>Enter</kbd></button><button type="button" className="art-check" onClick={() => setComposer(null)}>Cancel <kbd>Esc</kbd></button></div>
              </form>
            )}
            <div className="review-current">
              <h3>In game now</h3>
              <div className="review-current-row">
                {current.unit.spec.cameo && <span className="review-cameos"><img src={current.unit.spec.cameo} width={60} height={48} alt="" className="art-cameo-native" /><img src={current.unit.spec.cameo} width={120} height={96} alt="current cameo" className="art-cameo-2x" /></span>}
                <CurrentThumb spec={current.unit.spec} />
              </div>
            </div>
            <h3>Candidates ({candidates.length})</h3>
            {!candidates.length && <p className="art-hint">The Forge has not produced candidates for this unit yet.</p>}
            <div className="review-candidates">
              {candidates.map((c, i) => (
                <CandidateCard key={c.id} unit={current.unit} candidate={c} focused={focused?.id === c.id} approved={entry?.approved === c.id} onFocus={() => setFocusIndex(i)} tints={tints} />
              ))}
            </div>
            {state && (current.ws?.comparisons.length || state.stock.length) ? (
              <details className="review-reference">
                <summary>Local RA2 reference (reference-local, never published)</summary>
                {current.ws?.comparisons.map(src => <img key={src} src={src} alt="local comparison" loading="lazy" />)}
                {current.unit.spec.voxel && state.stock.length > 0 && (
                  <>
                    <label className="art-control"><span>Stock voxel</span><select value={stockId} onChange={e => setStockId(e.target.value)}><option value="">Choose…</option>{state.stock.map(s => <option key={s.id} value={s.id}>{s.id} — {s.usedBy.join(", ")}</option>)}</select></label>
                    {stock && <VoxelViewer key={stock.id} spec={stock} tints={tints} feedback={null} />}
                  </>
                )}
              </details>
            ) : null}
            <h3>Comments and decisions</h3>
            {entry?.comments.length ? (
              <ol className="review-comments">{[...entry.comments].reverse().map((c, i) => <li key={i}><small>{new Date(c.at).toLocaleString()} · {c.author}{c.candidate ? ` · ${c.candidate}` : ""}{c.view ? ` · ${c.view}` : ""}</small><p>{c.text}</p></li>)}</ol>
            ) : <p className="art-hint">None yet.</p>}
          </section>
        )}
      </div>
      {toast && <p className="review-toast" role="status">{toast}</p>}
    </div>
  );
}
