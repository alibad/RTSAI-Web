"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { candidatesForSlot, emptyEntry, needsDecision, slotIds, type ReviewAction, type ReviewEntry, type ReviewState, type SlotId, type UnitWorkspace } from "../../../lib/art-lab/review";
import { reviewProgress, versionLabels } from "../../../lib/art-lab/review-ui";
import { facingLabel } from "../../../lib/art-lab/voxel-math";
import { useFeedbackStore } from "../../../lib/stores/feedback-store";
import type { RosterPayload } from "../../../lib/art-lab/originals";
import { railFilters, slotNames, TopBar, UnitRail, type FactionSummary, type Origin, type RailFilter, type RailRow } from "./review/Chrome";
import { DecisionPanel, type Decide } from "./review/DecisionPanel";
import { ActionShelf, BehaviorPanel, StudioBar } from "./review/Studio";
import { SourceLibrary } from "./review/Sources";
import { Arena } from "./review/Arena";
import { Filmstrip } from "./review/Filmstrip";
import { FrameStore } from "./review/frames";
import { ConceptStage, IconStage, preloadImages } from "./review/ImageStages";
import { rememberView, setLab, useLab } from "./review/lab-store";
import { ModelStage, useUnitRadius } from "./review/Stage";
import { slotVersions, stageItem, type ReviewUnit } from "./review/versions";
import type { MapTint } from "./viewSettings";
import "./review/review.css";

export type { ReviewUnit } from "./review/versions";

const API = "/api/art-review";

type Row = { unit: ReviewUnit; ws: UnitWorkspace | undefined; entry: ReviewEntry | undefined; count: number; needs: boolean; origin: Origin };
/** "main-battle-tank" -> "Main battle tank"; falls back to the category. */
const roleText = (roles: string[], category: string) => {
  const text = (roles[0] ?? category).replace(/-/g, " ");
  return text[0].toUpperCase() + text.slice(1);
};
const railKey = "rtsai-art-review-rail";

async function post(action: ReviewAction, mode: "ra2" | "classic"): Promise<ReviewEntry> {
  const response = await fetch(`${API}/action?mode=${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
  const payload = await response.json() as { entry?: ReviewEntry; error?: string };
  if (!response.ok || !payload.entry) throw new Error(payload.error ?? `HTTP ${response.status}`);
  return payload.entry;
}

/**
 * Faction Art Lab · Review (local development only). A full-height review tool: slim top bar, unit rail, the
 * stage (the art, large and directly manipulable), a filmstrip of versions and a compact decision panel.
 * Choices go to RTSAI-Art/review.json through the dev-only API; nothing reaches the mod until export.
 */
export function ReviewApp({ units, tints }: { units: ReviewUnit[]; tints: MapTint[] }) {
  const [mode, setMode] = useState<"ra2" | "classic">("ra2");
  const [surface, setSurface] = useState<"art" | "arena">("art");
  const [linkReady, setLinkReady] = useState(false);
  const [state, setState] = useState<ReviewState | null>(null);
  const [error, setError] = useState("");
  const [faction, setFaction] = useState<string | null>(null);
  const [filter, setFilter] = useState<RailFilter>("all");
  const [roster, setRoster] = useState<RosterPayload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotId>("model");
  const [focusKey, setFocusKey] = useState("current");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [help, setHelp] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(0);
  const [frames] = useState(() => new FrameStore());
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // One WebGL context for the page, released on unmount (re-armed after a StrictMode remount).
  useEffect(() => { frames.revive(); return () => frames.dispose(); }, [frames]);
  // An app screen: no floating site Feedback button over the stage.
  useEffect(() => {
    const feedback = useFeedbackStore.getState();
    feedback.setHideTrigger(true);
    return () => feedback.setHideTrigger(false);
  }, []);
  useEffect(() => rememberView(), []);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);
  useEffect(() => {
    let saved = false;
    try { saved = localStorage.getItem(railKey) === "collapsed"; } catch { /* storage unavailable */ }
    if (!saved) return;
    const id = setTimeout(() => setCollapsed(true), 0);
    return () => clearTimeout(id);
  }, []);
  const collapse = useCallback((value: boolean) => {
    setCollapsed(value);
    try { localStorage.setItem(railKey, value ? "collapsed" : "open"); } catch { /* ignore */ }
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    const loadingMode = mode;
    try {
      const response = await fetch(`${API}/state?mode=${loadingMode}`, { cache: "no-store", signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json() as ReviewState;
      if (signal?.aborted) return;
      setState(next);
      setError("");
    } catch (cause) {
      if (signal?.aborted) return;
      setError(`Could not read the RTSAI-Art workspace: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, [mode]);
  useEffect(() => {
    const controller = new AbortController();
    const first = setTimeout(() => void load(controller.signal), 0);
    const onFocus = () => void load(controller.signal);
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); clearTimeout(first); window.removeEventListener("focus", onFocus); };
  }, [load]);
  // Every faction's roster, with original RA2 units served from the local cache (dev only).
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/roster?mode=${mode}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() as Promise<RosterPayload> : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(r => { if (!cancelled) setRoster(r); })
      .catch(cause => { if (!cancelled) setToast(`Game roster unavailable: ${cause instanceof Error ? cause.message : String(cause)}`); });
    return () => { cancelled = true; };
  }, [mode]);

  // Deep links: /art/review?unit=r2qilin&slot=model&v=sprite-v2 (kept in the address bar as you move).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const unit = params.get("unit");
    const slotParam = params.get("slot") as SlotId | null;
    const v = params.get("v");
    const factionParam = params.get("faction");
    const id = setTimeout(() => {
      if (params.get("mode") === "classic") setMode("classic");
      const surface = params.get("view");
      if (surface === "arena") setSurface(surface);
      if (factionParam) setFaction(factionParam);
      if (unit) setSelected(unit);
      if (slotParam && slotIds.includes(slotParam)) setSlot(slotParam);
      if (v) setFocusKey(v);
      setLinkReady(true);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const workspace = useMemo(() => new Map((state?.units ?? []).map(u => [u.actor, u])), [state]);
  const rowFor = useCallback((u: ReviewUnit): Row => {
    const ws = workspace.get(u.id);
    const entry = state?.review[u.id];
    const count = slotIds.reduce((n, s) => n + candidatesForSlot(ws, s).length, 0);
    return { unit: u, ws, entry, count, needs: needsDecision(ws, entry), origin: u.origin ?? "new" };
  }, [workspace, state]);
  // Every unit by id: our new units (page data) and the original RA2 units (dev API).
  const unitIndex = useMemo(() => {
    const m = new Map<string, ReviewUnit>((mode === "ra2" ? units : []).map(u => [u.id, { ...u, origin: "new" as const }]));
    for (const [id, s] of Object.entries(roster?.stock ?? {})) {
      const existing = m.get(id);
      const info = s.info;
      const category = info?.category ?? s.spec.category;
      m.set(id, {
        ...existing, id, factionId: existing?.factionId ?? "", factionName: existing?.factionName ?? "", name: info?.name || id, category, role: roleText(info?.roles ?? [], category), catalog: null,
        queue: info?.queue ?? "", order: info?.order ?? 9999, spec: s.spec, sprite: s.sprite, origin: info?.origin ?? "original", files: s.files, fromModBits: s.fromModBits, sources: s.sources,
      });
    }
    return m;
  }, [units, roster, mode]);
  // Dev-only test hook (this whole component is stubbed out of production builds): the exact 1x picture the
  // stage draws for a unit, for pixel comparisons against the engine's own render.
  useEffect(() => {
    const hook = {
      async frame(id: string, facing: number, color: string | null, turret = 0) {
        const u = unitIndex.get(id);
        if (!u) return null;
        const item = stageItem(u, null);
        if (!item) return null;
        const pose = { facing, turret, tick: 0, animation: "stand", color, shadow: true, tint: [1, 1, 1] };
        for (let i = 0; i < 200; i++) {
          const f = frames.get(item, pose);
          if (f) return { width: f.width, height: f.height, anchorX: f.anchorX, anchorY: f.anchorY, png: f.canvas.toDataURL("image/png") };
          await new Promise(r => setTimeout(r, 25));
        }
        return null;
      },
    };
    (window as unknown as { __artReview?: typeof hook }).__artReview = hook;
    return () => { delete (window as unknown as { __artReview?: typeof hook }).__artReview; };
  }, [frames, unitIndex]);
  const rosterInfo = useMemo(() => new Map((roster?.factions ?? []).flatMap(f => f.units.map(u => [`${f.id}:${u.id}`, u] as const))), [roster]);
  const rows = useMemo(() => units.map(u => rowFor({ ...u, origin: "new" })), [units, rowFor]);
  const factionIds = useMemo(() => (roster?.factions.map(f => f.id) ?? [...new Set(units.map(u => u.factionId))]), [roster, units]);
  // Each faction's whole roster (new and original units), in build-palette order; new units only until it loads.
  const rostersById = useMemo(() => new Map(factionIds.map(id => {
    const f = roster?.factions.find(x => x.id === id);
    const ids = f ? f.units.map(u => u.id) : units.filter(u => u.factionId === id).map(u => u.id);
    return [id, ids.flatMap(i => { const u = unitIndex.get(i); return u ? [rowFor(u)] : []; })] as const;
  })), [factionIds, roster, units, unitIndex, rowFor]);
  const factionSummaries: FactionSummary[] = useMemo(() => factionIds.map(id => {
    const list = rostersById.get(id) ?? [];
    const withCandidates = list.filter(r => r.count > 0);
    const name = roster?.factions.find(f => f.id === id)?.name ?? units.find(u => u.factionId === id)?.factionName ?? id;
    return { id, name, units: list.length, withCandidates: withCandidates.length, decided: withCandidates.filter(r => !r.needs).length };
  }), [factionIds, rostersById, roster, units]);
  const factionId = faction && factionIds.includes(faction) ? faction
    : factionSummaries.find(f => (rostersById.get(f.id) ?? []).some(r => r.needs))?.id ?? factionIds[0] ?? "china";
  const factionName = factionSummaries.find(f => f.id === factionId)?.name ?? factionId;
  const factionRows = useMemo(() => rostersById.get(factionId) ?? [], [rostersById, factionId]);
  const railRows: RailRow[] = useMemo(() => factionRows.map(r => ({ unit: r.unit, origin: r.origin, count: r.count, needs: r.needs })), [factionRows]);
  const visibleRows = useMemo(() => {
    const test = railFilters.find(f => f.id === filter)?.test ?? (() => true);
    return railRows.filter(test);
  }, [railRows, filter]);
  const progress = reviewProgress(rows);
  const selectedUnit = selected ? unitIndex.get(selected) : undefined;
  const current = selectedUnit ? rowFor(selectedUnit)
    : factionRows.find(r => r.needs) ?? factionRows.find(r => r.count > 0) ?? factionRows[0] ?? null;
  const currentUnit = current?.unit ?? null;
  // Original units are shared by several factions; show them in the faction being browsed.
  const unit = useMemo(() => (currentUnit ? { ...currentUnit, factionId: currentUnit.factionId || factionId, factionName: currentUnit.factionName || factionName } : null), [currentUnit, factionId, factionName]);
  const ws = current?.ws;
  const info = unit ? rosterInfo.get(`${factionId}:${unit.id}`) ?? [...rosterInfo.entries()].find(([k]) => k.endsWith(`:${unit.id}`))?.[1] : undefined;
  const reference = info?.reference ? unitIndex.get(info.reference) ?? null : null;
  const referenceWhy = info?.referenceWhy;
  const paletteUnits = useMemo(() => factionRows.map(r => ({ ...r.unit, factionId })), [factionRows, factionId]);
  const unitKey = unit?.id ?? null;
  const versions = useMemo(() => (unit ? slotVersions(unit, ws, slot, reference, referenceWhy) : []), [unit, ws, slot, reference, referenceWhy]);
  const focus = Math.max(0, versions.findIndex(v => v.key === focusKey));
  const focused = versions[focus] ?? null;
  const entry = current?.entry ?? emptyEntry();
  const decision = entry.slots[slot];
  const counts = useMemo(() => Object.fromEntries(slotIds.map(s => [s, candidatesForSlot(ws, s).length])) as Record<SlotId, number>, [ws]);
  const labels = useMemo(() => versionLabels(ws?.candidates ?? []), [ws]);
  const conceptCurrent = useMemo(() => versions.slice(0, 1), [versions]);
  const currentItem = useMemo(() => unit ? stageItem(unit, null) : null, [unit]);
  const radius = useUnitRadius(frames, surface === "art" && slot !== "icon" ? currentItem : null, tints);
  // Thumbnails at the largest whole zoom that keeps the unit's turning circle inside the card.
  const thumbZoom = radius === null ? 1 : Math.max(1, Math.min(3, Math.floor(104 / (2 * radius))));
  // The lineup already lists every version as a clickable row, so it takes the filmstrip's height.
  const compareMode = useLab(s => s.compare);
  const lineupOnly = compareMode === "lineup" && slot !== "concept" && versions.length > 1;
  const comments = useMemo(() => entry.comments.slice().reverse(), [entry]);
  const forgeRecommendation = (entry.forgeRecommendation ?? {}) as Record<string, string>;
  const forgePick = focused?.candidate ? forgeRecommendation[String(focused.candidate.kind)] ?? null : null;

  // Keep the address bar in step for deep links.
  useEffect(() => {
    if (!linkReady || !unitKey) return;
    const url = new URL(window.location.href);
    url.searchParams.set("faction", factionId);
    url.searchParams.set("unit", unitKey);
    url.searchParams.set("slot", slot);
    url.searchParams.set("mode", mode);
    url.searchParams.set("view", surface);
    if (focusKey !== "current") url.searchParams.set("v", focusKey); else url.searchParams.delete("v");
    window.history.replaceState(null, "", url);
  }, [linkReady, unitKey, factionId, slot, focusKey, mode, surface]);

  // Preload the neighbours of the focused version (models warm in the stage's frame cache).
  useEffect(() => {
    if (slot === "model") return;
    preloadImages([versions[focus - 1]?.image, versions[focus + 1]?.image]);
  }, [versions, focus, slot]);

  // Auto-spin: one facing step every 110 ms while visible; stops itself when the tab is hidden.
  const spin = useLab(s => s.spin);
  useEffect(() => {
    if (!spin) return;
    const timer = setInterval(() => { if (!document.hidden) setLab(s => ({ facing: (s.facing - 32 + 1024) % 1024 })); }, 110);
    return () => clearInterval(timer);
  }, [spin]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const selectUnit = useCallback((id: string) => { setSelected(id); setFocusKey("current"); setLab({ zoom: null, spin: false, animation: "stand", turret: 0 }); }, []);
  const changeFaction = useCallback((id: string) => { setFaction(id); setSelected(null); setFocusKey("current"); setLab({ zoom: null, spin: false, animation: "stand", turret: 0 }); }, []);
  const changeSlot = useCallback((s: SlotId) => { setSlot(s); setFocusKey("current"); setLab({ zoom: null }); }, []);
  const focusIndex = useCallback((i: number) => { const v = versions[i]; if (v) setFocusKey(v.key); }, [versions]);

  const view = () => {
    const s = useLab.getState();
    const ref = focused?.reference ? ` (${focused.reference.id})` : "";
    return `${slotNames[slot]} · ${focused?.label ?? ""}${ref}${slot === "model" ? ` · facing ${s.facing} (${facingLabel(s.facing)})` : ""}`;
  };
  const send = async (action: ReviewAction, message: string) => {
    setBusy(true);
    try {
      const sendingMode = mode;
      const sendingRoot = state?.root;
      const next = await post(action, sendingMode);
      setState(s => (s && s.root === sendingRoot ? { ...s, review: { ...s.review, [action.actor]: next } } : s));
      setToast(message);
      return true;
    } catch (cause) {
      setToast(`Not saved: ${cause instanceof Error ? cause.message : String(cause)}`);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const label = (id: string) => (id === "current" ? "Current" : labels.get(id) ?? id);
  const decide: Decide | null = unit ? {
    choose: c => void send({ type: "choose", actor: unit.id, slot, candidate: c, view: view() },
      c === "current" ? "Keeping current" : slot === "concept" ? `${label(c)} is the reference` : `${label(c)} will be used in game`),
    clear: () => void send({ type: "clear", actor: unit.id, slot }, "Decision undone"),
    reject: c => void send({ type: "reject", actor: unit.id, slot, candidate: c }, `${label(c)} rejected`),
    unreject: c => void send({ type: "unreject", actor: unit.id, slot, candidate: c }, "Reject undone"),
    comment: text => send({ type: "comment", actor: unit.id, slot, candidate: focused?.candidate?.id ?? null, view: view(), text }, "Note saved"),
  } : null;

  // Keyboard: one listener reading the latest render through a ref.
  // Original units and references are for comparison only: no Use, Keep or Reject.
  const referenceOnly = (unit?.origin === "original" && !focused?.candidate) || focused?.kind === "reference";
  const keys = useRef({ visibleRows, unit, versions, focus, focused, decision, decide, slot, help, referenceOnly });
  useEffect(() => { keys.current = { visibleRows, unit, versions, focus, focused, decision, decide, slot, help, referenceOnly }; });
  useEffect(() => {
    if (surface !== "art") return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select") || target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const k = keys.current;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const candidate = k.focused?.candidate ?? null;
      const handled = () => event.preventDefault();
      const goUnit = (delta: number) => {
        const list = k.visibleRows;
        if (!list.length) return;
        const index = list.findIndex(r => r.unit.id === k.unit?.id);
        const next = list[((index < 0 ? 0 : index + delta) + list.length) % list.length];
        selectUnit(next.unit.id);
      };
      if (key === "j") { goUnit(1); handled(); }
      else if (key === "k") { goUnit(-1); handled(); }
      else if (key === "ArrowRight") { const v = k.versions[Math.min(k.versions.length - 1, k.focus + 1)]; if (v) setFocusKey(v.key); handled(); }
      else if (key === "ArrowLeft") { const v = k.versions[Math.max(0, k.focus - 1)]; if (v) setFocusKey(v.key); handled(); }
      else if (key === "1" || key === "2" || key === "3") { changeSlot(slotIds[Number(key) - 1]); handled(); }
      else if ((key === "u" || key === "n" || key === "r") && k.referenceOnly) handled();
      else if (key === "u" && k.decide) {
        if (candidate) k.decide.choose(candidate.id); else if (k.slot !== "concept") k.decide.choose("current");
        handled();
      } else if (key === "n" && k.decide && k.slot !== "concept") { k.decide.choose("current"); handled(); }
      else if (key === "r" && k.decide && candidate) { (k.decision.rejected.includes(candidate.id) ? k.decide.unreject : k.decide.reject)(candidate.id); handled(); }
      else if (key === "c") { noteRef.current?.focus(); handled(); }
      else if (key === " ") { if (k.unit?.spec.voxel || k.unit?.sprite?.sequences.some(s => Math.abs(s.facings) > 1)) setLab(s => ({ spin: !s.spin })); handled(); }
      else if (key === "?") { setHelp(h => !h); handled(); }
      else if (key === "Escape") setHelp(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectUnit, changeSlot, surface]);

  let stage: React.ReactNode = null;
  if (unit && focused) {
    if (slot === "model") stage = <ModelStage key={mode} versions={versions} focus={focus} allowCompare frames={frames} tints={tints} unitId={unit.id} radius={radius} onFocus={focusIndex} />;
    else if (slot === "icon") stage = <IconStage versions={versions} focus={focus} unit={unit} units={paletteUnits} onFocus={focusIndex} />;
    else if (focused.key === "current") stage = <ModelStage key={mode} versions={conceptCurrent} focus={0} allowCompare={false} frames={frames} tints={tints} unitId={unit.id} radius={radius} onFocus={focusIndex} />;
    else stage = <ConceptStage version={focused} />;
  }

  return (
    <div className={`lab${surface === "arena" ? " is-encounter" : ""}`}>
      {sourcesOpen && <SourceLibrary mode={mode} roster={roster} onClose={() => setSourcesOpen(false)} />}
      <StudioBar onSources={() => setSourcesOpen(true)} mode={mode} onMode={m => { setMode(m); setState(null); setRoster(null); setSelected(null); setFaction(null); setFilter("all"); frames.clearQueue(); setLab({ spin: false, zoom: null, animation: "stand" }); }} surface={surface} onSurface={s => { setSurface(s); setLab({ spin: false, playing: false }); if (s !== "art") setSlot("model"); }} />
      <TopBar slot={slot} counts={counts} onSlot={changeSlot} decided={progress.decided} total={progress.total} tints={tints} help={help} onHelp={setHelp} name={unit?.name} encounter={surface === "arena"} />
      <div className={`lab-body${collapsed ? " is-collapsed" : ""}`}>
        {surface !== "arena" && <UnitRail rows={railRows} selected={unit?.id ?? null} faction={factionId} factions={factionSummaries} onFaction={changeFaction}
          filter={filter} onFilter={setFilter} onSelect={selectUnit} collapsed={collapsed} onCollapse={collapse} />}
        <main className={`lab-main${surface !== "arena" && slot === "model" ? " has-actions" : ""}`} id="main-content">
          {error ? <p className="lab-empty">{error}</p>
            : !state ? <p className="lab-empty">Loading the workspace…</p>
            : !unit ? <p className="lab-empty">No units.</p>
            : surface === "arena" ? <Arena key={mode} mode={mode} units={[...unitIndex.values()]} selected={unit} roster={roster} frames={frames} onSelect={selectUnit} /> : stage}
          {unit && focused && surface !== "arena" && !lineupOnly && (
            <Filmstrip versions={versions} focus={focus} decision={decision} frames={frames} tints={tints} thumbZoom={thumbZoom} radius={radius}
              imageFit={slot === "icon" ? "pixel" : "cover"} onFocus={focusIndex} />
          )}
          {unit && surface !== "arena" && slot === "model" && <ActionShelf unit={unit} onEncounter={() => { setSurface("arena"); setLab({ spin: false, playing: false }); }} />}
          {toast && <p className="lab-toast" role="status">{toast}</p>}
        </main>
        {surface !== "arena" && <aside className="studio-inspector" aria-label="Actor details">
        {unit && <BehaviorPanel unit={unit} facts={roster?.stock[unit.id]?.behavior ?? null} />}
        {unit && focused && decide && <details className="studio-review-notes"><summary>Art review & notes{counts[slot] ? ` · ${counts[slot]} alternatives` : ""}</summary>
          <DecisionPanel key={unit.id} unit={unit} slot={slot} version={focused} decision={decision} comments={comments} labelFor={c => (c ? label(c) : "Current")}
            busy={busy} decide={decide} noteRef={noteRef} all={ws?.candidates ?? []} now={now} forgePick={forgePick} referenceOnly={referenceOnly} reference={reference} />
        </details>}
        </aside>}
      </div>
    </div>
  );
}
