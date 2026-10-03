"use client";

/* Candidate images come from the local dev route at their own sizes; next/image cannot serve them. */
/* eslint-disable @next/next/no-img-element */
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderInGame } from "../../../lib/art-lab/client";
import type { RenderSpec } from "../../../lib/art-lab/spec";
import type { SpriteArt } from "../../../lib/art-lab/types";
import { facingLabel } from "../../../lib/art-lab/voxel-math";
import {
  candidateRenderSpec, candidateSprite, candidatesForSlot, emptyEntry, needsDecision, slotIds, slotLabels, slotState,
  type Candidate, type ReviewAction, type ReviewEntry, type ReviewState, type SlotId, type SlotState, type UnitWorkspace,
} from "../../../lib/art-lab/review";
import { ArtStage } from "./ArtStage";
import { PixelCanvas, type PixelImage } from "./PixelCanvas";
import { candidateLabel, Cost, DecisionButtons, ExportBanner, HelpPopover, HowReviewWorks, MadeFrom, Scores, useHowtoDismissed, ZoomableImage, type Decide } from "./review-parts";
import { toolbarFeatures } from "./UnitViewer";
import { ViewerToolbar } from "./ViewerToolbar";
import { CameraLink, useViewSettings, type MapTint, type ViewSettings } from "./viewSettings";
import "../../art-lab.css";

export type ReviewUnit = {
  id: string; factionId: string; factionName: string; name: string; category: string; role: string;
  catalog: { name: string; role: string; story: string } | null;
  queue: string; order: number;
  spec: RenderSpec; sprite: SpriteArt | null;
};

type DecisionFilter = "needs" | "decided" | "all";
const API = "/api/art-review";
const dotSymbol: Record<SlotState, string> = { chosen: "✓", current: "↺", undecided: "•", none: "–" };
const dotWords: Record<SlotState, string> = { chosen: "candidate chosen", current: "keep current", undecided: "undecided", none: "no candidates" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

async function post(action: ReviewAction): Promise<ReviewEntry> {
  const response = await fetch(`${API}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
  const payload = await response.json() as { entry?: ReviewEntry; error?: string };
  if (!response.ok || !payload.entry) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload.entry;
}

function Dots({ ws, entry }: { ws: UnitWorkspace | undefined; entry: ReviewEntry | undefined }) {
  return (
    <span className="review-dots">
      {slotIds.map(slot => {
        const state = slotState(ws, entry, slot);
        return <i key={slot} className={`is-${state}`} title={`${slotLabels[slot]}: ${dotWords[state]}`} aria-label={`${slotLabels[slot]}: ${dotWords[state]}`}>{dotSymbol[state]}</i>;
      })}
    </span>
  );
}

function useInGameImage(spec: RenderSpec, settings: ViewSettings) {
  const [image, setImage] = useState<PixelImage | null>(null);
  useEffect(() => {
    let cancelled = false;
    renderInGame(spec, { facing: settings.facing, color: settings.color }).then(i => { if (!cancelled) setImage(i); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [spec, settings.facing, settings.color]);
  return image;
}

/** A mock build palette: the faction's queue, three cameos wide, with this unit's slot holding `cameo`. */
function PaletteContext({ unit, units, cameo, zoom }: { unit: ReviewUnit; units: ReviewUnit[]; cameo: string | null; zoom: number }) {
  const queue = units.filter(u => u.factionId === unit.factionId && u.queue === unit.queue).sort((a, b) => a.order - b.order);
  const at = queue.findIndex(u => u.id === unit.id);
  const start = Math.max(0, Math.min(at - 4, queue.length - 9));
  const shown = queue.slice(start, start + 9);
  return (
    <figure className="review-palette">
      <div className="review-palette-grid" style={{ gridTemplateColumns: `repeat(3, ${60 * zoom}px)` }}>
        {shown.map(u => {
          const src = u.id === unit.id ? cameo : u.spec.cameo;
          return <span key={u.id} className={u.id === unit.id ? "is-this" : undefined}>{src ? <img src={src} width={60 * zoom} height={48 * zoom} alt={u.id === unit.id ? `${u.name} (this slot)` : u.name} /> : null}</span>;
        })}
      </div>
      <figcaption>In context: {unit.factionName} {unit.queue.toLowerCase()} tab, build-palette order, {zoom}×. The marked cell is this unit.</figcaption>
    </figure>
  );
}

type Column = { key: string; candidate: Candidate | null };
type StageItem = { key: string; spec: RenderSpec; sprite: SpriteArt | null };

// Stable item objects per unit and candidate, so the viewers are not rebuilt on every render.
const itemCache = new Map<string, StageItem | null>();
function stageItem(unit: ReviewUnit, candidate: Candidate | null): StageItem | null {
  if (!candidate) {
    const key = `${unit.id}:current`;
    if (!itemCache.has(key)) itemCache.set(key, { key: "current", spec: unit.spec, sprite: unit.sprite });
    return itemCache.get(key)!;
  }
  const key = `${unit.id}:${candidate.id}:${candidate.createdAt}:${(candidate.files.vxl ?? []).join(",")}:${(candidate.files.shp ?? []).join(",")}`;
  if (!itemCache.has(key)) {
    const voxel = candidateRenderSpec(unit.spec, candidate);
    const sprite = voxel ? null : candidateSprite(unit.spec, unit.sprite, candidate);
    itemCache.set(key, voxel ? { key: candidate.id, spec: voxel, sprite: null } : sprite ? { key: candidate.id, spec: sprite.spec, sprite: sprite.sprite } : null);
  }
  return itemCache.get(key)!;
}

export function ReviewApp({ units, tints }: { units: ReviewUnit[]; tints: MapTint[] }) {
  const [state, setState] = useState<ReviewState | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<DecisionFilter>("needs");
  const [faction, setFaction] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotId>("model");
  const [focus, setFocus] = useState(0);
  const [composer, setComposer] = useState<{ slot: SlotId; candidate: string | null } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [help, setHelp] = useState(false);
  const [paletteZoom, setPaletteZoom] = useState<1 | 2>(1);
  const [howtoDismissed, setHowtoDismissed] = useHowtoDismissed();
  const [settings, update] = useViewSettings({ mode: "ingame", zoom: 2 });
  const link = useMemo(() => new CameraLink(), []);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { link.setLinked(settings.linkCameras); }, [link, settings.linkCameras]);

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

  // Deep links: /art/review?unit=r2qilin&slot=model (kept in the address bar as you move).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const unit = params.get("unit");
    const slotParam = params.get("slot") as SlotId | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the deep link after hydration
    if (unit) { setSelected(unit); setFilter("all"); }
    if (slotParam && slotIds.includes(slotParam)) setSlot(slotParam);
  }, []);
  useEffect(() => {
    if (!selected) return;
    const url = new URL(window.location.href);
    url.searchParams.set("unit", selected);
    url.searchParams.set("slot", slot);
    window.history.replaceState(null, "", url);
  }, [selected, slot]);

  const workspace = useMemo(() => new Map((state?.units ?? []).map(u => [u.actor, u])), [state]);
  const rows = useMemo(() => units.map(u => {
    const ws = workspace.get(u.id);
    const entry = state?.review[u.id];
    const count = slotIds.reduce((n, s) => n + candidatesForSlot(ws, s).length, 0);
    return { unit: u, ws, entry, count, needs: needsDecision(ws, entry) };
  }), [units, workspace, state]);
  const visible = rows.filter(r => (faction === "all" || r.unit.factionId === faction)
    && (filter === "all" || (filter === "needs" ? r.needs : r.count > 0 && !r.needs)));
  const needsCount = rows.filter(r => r.needs).length;
  const current = rows.find(r => r.unit.id === selected) ?? visible[0] ?? null;
  const entry = current?.entry ?? emptyEntry();
  const decision = entry.slots[slot];
  const candidates = candidatesForSlot(current?.ws, slot);
  const allCandidates = current?.ws?.candidates ?? [];
  const columns: Column[] = [{ key: "current", candidate: null }, ...candidates.map(c => ({ key: c.id, candidate: c }))];
  const focused = columns[Math.min(focus, columns.length - 1)] ?? columns[0];
  const factions = [...new Map(units.map(u => [u.factionId, u.factionName])).entries()];

  const items: StageItem[] = current ? [stageItem(current.unit, null)!, ...candidates.flatMap(c => { const item = stageItem(current.unit, c); return item ? [item] : []; })] : [];
  const features = { ...toolbarFeatures(items), link: items.filter(i => i.spec.voxel).length > 1 };

  const view = () => `${slotLabels[slot]} · ${slot === "model" ? `${settings.mode === "ingame" ? "in-game" : settings.mode === "orbit" ? "3D orbit" : "exploded"} view, facing ${settings.facing} (${facingLabel(settings.facing)})` : slot === "icon" ? `${settings.zoom}x` : "sheet"}`;
  const send = async (action: ReviewAction, message: string) => {
    setBusy(true);
    try {
      const next = await post(action);
      setState(s => (s ? { ...s, review: { ...s.review, [action.actor]: next } } : s));
      setToast(message);
    } catch (cause) {
      setToast(`Not saved: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setBusy(false);
    }
  };
  const decide: Decide | null = current ? {
    choose: c => void send({ type: "choose", actor: current.unit.id, slot, candidate: c, view: view() }, c === "current" ? `${slotLabels[slot]}: keep current` : slot === "concept" ? `${c}: reference for the next round` : `${slotLabels[slot]}: ${c} chosen for game`),
    clear: () => void send({ type: "clear", actor: current.unit.id, slot }, `${slotLabels[slot]}: decision undone`),
    reject: c => void send({ type: "reject", actor: current.unit.id, slot, candidate: c }, `${c} rejected`),
    unreject: c => void send({ type: "unreject", actor: current.unit.id, slot, candidate: c }, `${c}: rejection undone`),
    comment: c => { setComposer({ slot, candidate: c }); setText(""); },
  } : null;
  const saveComment = () => {
    if (!current || !composer || !text.trim()) return;
    void send({ type: "comment", actor: current.unit.id, slot: composer.slot, candidate: composer.candidate, view: view(), text }, "Comment saved for the Forge").then(() => { setComposer(null); setText(""); });
  };

  const goUnit = (delta: number) => {
    if (!visible.length) return;
    const index = Math.max(0, visible.findIndex(r => r.unit.id === current?.unit.id));
    setSelected(visible[(index + delta + visible.length) % visible.length].unit.id);
    setFocus(0);
    setComposer(null);
  };

  // Keyboard: one listener; it reads the latest render through a ref.
  const keys = useRef({ goUnit, columns, focused, decision, decide, update, settings });
  useEffect(() => { keys.current = { goUnit, columns, focused, decision, decide, update, settings }; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select") || target?.isContentEditable) {
        if (event.key === "Escape") setComposer(null);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const { goUnit, columns, focused, decision, decide, update, settings } = keys.current;
      const key = event.key.toLowerCase();
      const candidate = focused?.candidate?.id ?? null;
      const handled = () => event.preventDefault();
      if (key === "j") { goUnit(1); handled(); }
      else if (key === "k") { goUnit(-1); handled(); }
      else if (key === "l") { setFocus(f => Math.min(f + 1, columns.length - 1)); handled(); }
      else if (key === "h") { setFocus(f => Math.max(0, f - 1)); handled(); }
      else if (key === "1" || key === "2" || key === "3") { setSlot(slotIds[Number(key) - 1]); setFocus(0); setComposer(null); handled(); }
      else if (key === "u" && decide && candidate && !decision.rejected.includes(candidate)) { decide.choose(candidate); handled(); }
      else if (key === "n" && decide) { decide.choose("current"); handled(); }
      else if (key === "r" && decide && candidate) { (decision.rejected.includes(candidate) ? decide.unreject : decide.reject)(candidate); handled(); }
      else if (key === "c" && decide) { decide.comment(candidate); handled(); }
      else if (event.key === " " && !target?.closest("button")) { update({ spin: !settings.spin }); handled(); }
      else if (event.key === "?") { setHelp(h => !h); handled(); }
      else if (event.key === "Escape") { setComposer(null); setHelp(false); }
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

  const unitComments = entry.comments.slice().reverse();
  return (
    <div className="review">
      <HowReviewWorks open={!howtoDismissed} onClose={() => setHowtoDismissed(true)} />
      <ExportBanner />
      {error && <p className="art-warn">{error}</p>}
      {state && !state.exists && <p className="art-warn">No workspace at {state.root}.</p>}
      {state?.errors.length ? <p className="art-hint">Skipped {plural(state.errors.length, "candidate folder")} without a readable meta.json (the Forge may still be writing them): {state.errors.map(e => e.replace(/\/meta\.json.*$/, "")).join(", ")}.</p> : null}
      <div className="review-layout">
        <aside className="review-rail" aria-label="Units">
          <div className="review-filters">
            <label className="art-control"><span>Faction</span><select value={faction} onChange={e => setFaction(e.target.value)}><option value="all">All factions</option>{factions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
            <div className="review-segment" role="group" aria-label="Show">
              {([["needs", `Needs your decision (${needsCount})`], ["decided", "Decided"], ["all", "All"]] as const).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
              ))}
            </div>
            <p className="review-legend">Slots: model · icon · concept. <b className="is-chosen">✓</b> chosen <b className="is-current">↺</b> keep current <b className="is-undecided">•</b> undecided</p>
          </div>
          <ol>
            {visible.map(r => (
              <li key={r.unit.id}>
                <button type="button" aria-current={current?.unit.id === r.unit.id ? "true" : undefined} onClick={() => { setSelected(r.unit.id); setFocus(0); setComposer(null); }}>
                  {r.unit.spec.cameo ? <img src={r.unit.spec.cameo} width={45} height={36} alt="" /> : <span className="review-noicon" />}
                  <span><b>{r.unit.name}</b><small>{r.unit.factionName} · {r.needs ? "Needs your decision" : r.count ? "Decided" : "No candidates"}</small></span>
                  <Dots ws={r.ws} entry={r.entry} />
                </button>
              </li>
            ))}
            {!visible.length && <li className="art-hint">{filter === "needs" ? "Nothing needs your decision." : "Nothing matches."}</li>}
          </ol>
        </aside>
        {current && decide && (
          <section className="review-main" aria-label={current.unit.name}>
            <header className="review-unit-head">
              <div>
                <span className="eyebrow">{current.unit.factionName} · {current.unit.category} · {current.unit.role}</span>
                <h2>{current.unit.name} <code>{current.unit.id}</code></h2>
                {current.unit.catalog && <p className="review-catalog">Catalog: <b>{current.unit.catalog.name}</b> · {current.unit.catalog.role} · {current.unit.catalog.story}</p>}
              </div>
              <div className="review-head-actions">
                {howtoDismissed && <button type="button" className="art-check" onClick={() => setHowtoDismissed(false)}>How review works</button>}
                <HelpPopover open={help} onToggle={() => setHelp(h => !h)} />
                <button type="button" className="art-check" onClick={() => void load()}><RefreshCw size={14} /> Reload</button>
                <Link className="art-check" href={`/art/${current.unit.factionId}/${current.unit.id}`}>Unit page</Link>
              </div>
            </header>
            <div className="review-tabs" role="tablist" aria-label="Slots">
              {slotIds.map((id, i) => {
                const st = slotState(current.ws, current.entry, id);
                return (
                  <button key={id} type="button" role="tab" aria-selected={slot === id} onClick={() => { setSlot(id); setFocus(0); setComposer(null); }}>
                    <kbd>{i + 1}</kbd> {slotLabels[id]} <small>{plural(candidatesForSlot(current.ws, id).length, "candidate")} · {id === "concept" ? (st === "chosen" ? "reference chosen" : "reference only") : dotWords[st]}</small>
                  </button>
                );
              })}
            </div>
            {slot === "model" && <ViewerToolbar settings={settings} update={update} tints={tints} features={features} className="is-sticky" />}
            {slot === "icon" && (
              <div className="art-toolbar is-sticky" role="toolbar" aria-label="Icon view"><div className="art-control" role="group" aria-label="Palette scale"><span>Palette scale</span>{([1, 2] as const).map(z => <button key={z} type="button" aria-pressed={paletteZoom === z} onClick={() => setPaletteZoom(z)}>{z}×</button>)}</div><span className="art-hint">Players see cameos at 1×.</span></div>
            )}
            {composer && (
              <form className="review-composer" onSubmit={e => { e.preventDefault(); saveComment(); }}>
                <label htmlFor="review-text">Comment for the Forge · {slotLabels[composer.slot]}{composer.candidate ? ` · ${composer.candidate}` : " · the current asset"}</label>
                <textarea id="review-text" ref={textRef} value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={4000} placeholder="What should the next round change?"
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveComment(); } }} />
                <div><button type="submit" className="art-check" disabled={busy || !text.trim()}>Save <kbd>Enter</kbd></button><button type="button" className="art-check" onClick={() => setComposer(null)}>Cancel <kbd>Esc</kbd></button></div>
              </form>
            )}
            {candidates.length === 0 && <p className="art-hint review-empty">The Forge has no {slotLabels[slot].toLowerCase()} candidates for this unit yet. The column below shows what is in game.</p>}
            <div className={`review-grid is-${slot}`}>
              {columns.map((col, i) => {
                const id = col.candidate?.id ?? "current";
                const chosen = decision.chosen === id;
                const rejected = col.candidate ? decision.rejected.includes(col.candidate.id) : false;
                return (
                  <article key={col.key} className={`review-col ${focused.key === col.key ? "is-focused" : ""} ${chosen ? "is-chosen" : ""} ${rejected ? "is-rejected" : ""}`}
                    onPointerDownCapture={() => setFocus(i)} onFocusCapture={() => setFocus(i)} aria-label={col.candidate ? candidateLabel(col.candidate) : "Now in game"}>
                    <h3 className="review-col-title">{col.candidate ? candidateLabel(col.candidate) : slot === "concept" ? "Now in game (for reference)" : "Now in game"}</h3>
                    <ColumnBody slot={slot} unit={current.unit} units={units} candidate={col.candidate} items={items} settings={settings} tints={tints} link={link} paletteZoom={paletteZoom} />
                    <div className="review-col-foot">
                      {col.candidate ? (
                        <>
                          <MadeFrom candidate={col.candidate} all={allCandidates} />
                          <Scores candidate={col.candidate} />
                          <p className="review-col-meta"><Cost candidate={col.candidate} all={allCandidates} /> · {new Date(col.candidate.createdAt).toLocaleString()}{col.candidate.fixture ? " · fixture" : ""}</p>
                          {!!col.candidate.files.previews?.length && (
                            <details className="review-previews"><summary>Forge previews ({col.candidate.files.previews.length}), made outside the game</summary>
                              {col.candidate.files.previews.map(p => col.candidate!.urls[p] && <a key={p} href={col.candidate!.urls[p]} target="_blank" rel="noreferrer"><img src={col.candidate!.urls[p]} alt={p} loading="lazy" /></a>)}
                            </details>
                          )}
                        </>
                      ) : <p className="review-col-meta">{slot === "concept" ? "Concept art never ships; this is what players see today." : "Shipped in the mod now."}</p>}
                      {(slot !== "concept" || col.candidate) && <DecisionButtons slot={slot} candidate={id} decision={decision} decide={decide} busy={busy} />}
                    </div>
                  </article>
                );
              })}
            </div>
            <section className="review-history" aria-label="Comments for the Forge">
              <h3>Comments for the Forge</h3>
              {unitComments.length ? (
                <ol>{unitComments.map((c, i) => <li key={i}><small>{c.at ? new Date(c.at).toLocaleString() : ""} · {c.slot ? slotLabels[c.slot] : "unit"}{c.candidate ? ` · ${c.candidate}` : ""}{c.view ? ` · ${c.view}` : ""}</small><p>{c.text}</p></li>)}</ol>
              ) : <p className="art-hint">None yet. Press <kbd>C</kbd> to leave one on the focused column.</p>}
            </section>
          </section>
        )}
      </div>
      {toast && <p className="review-toast" role="status">{toast}</p>}
    </div>
  );
}

function ColumnBody({ slot, unit, units, candidate, items, settings, tints, link, paletteZoom }: {
  slot: SlotId; unit: ReviewUnit; units: ReviewUnit[]; candidate: Candidate | null; items: StageItem[];
  settings: ViewSettings; tints: MapTint[]; link: CameraLink; paletteZoom: 1 | 2;
}) {
  if (slot === "model") {
    const item = items.find(i => i.key === (candidate?.id ?? "current"));
    if (!item) return <p className="art-hint">This candidate has no files the game could draw ({candidate?.files.vxl?.length ? "VXL without matching HVA" : "no VXL or SHP"}).</p>;
    return <ArtStage spec={item.spec} sprite={item.sprite} settings={settings} tints={tints} link={link} height={340} />;
  }
  if (slot === "icon") {
    const cameo = candidate ? (candidate.files.cameo ? candidate.urls[candidate.files.cameo] : null) : unit.spec.cameo;
    return (
      <div className="review-icon">
        <div className="review-icon-sizes">
          {cameo ? <><figure><img src={cameo} width={60} height={48} alt="" className="art-cameo-native" /><figcaption>1×</figcaption></figure><figure><img src={cameo} width={120} height={96} alt={`${unit.name} cameo at 2x`} className="art-cameo-2x" /><figcaption>2×</figcaption></figure></> : <span className="art-hint">No cameo file.</span>}
        </div>
        <PaletteContext unit={unit} units={units} cameo={cameo} zoom={paletteZoom} />
      </div>
    );
  }
  if (!candidate) return <CurrentReference unit={unit} settings={settings} tints={tints} />;
  const sheet = candidate.files.concept ? candidate.urls[candidate.files.concept] : null;
  return sheet ? <ZoomableImage src={sheet} alt={`${candidate.id} concept sheet`} /> : <p className="art-hint">No concept image.</p>;
}

function CurrentReference({ unit, settings, tints }: { unit: ReviewUnit; settings: ViewSettings; tints: MapTint[] }) {
  const image = useInGameImage(unit.spec, settings);
  const tint = tints.find(t => t.map === settings.tintMap)?.tint ?? [1, 1, 1] as [number, number, number];
  return (
    <div className="review-current-ref">
      {unit.spec.cameo && <img src={unit.spec.cameo} width={120} height={96} alt={`${unit.name} cameo`} className="art-cameo-2x" />}
      {image && <PixelCanvas image={image} zoom={2} backdrop={settings.backdrop} tint={tint} diamond label={`${unit.name} in game`} />}
    </div>
  );
}
