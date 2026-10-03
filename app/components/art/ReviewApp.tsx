"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { candidatesForSlot, emptyEntry, needsDecision, slotIds, type ReviewAction, type ReviewEntry, type ReviewState, type SlotId } from "../../../lib/art-lab/review";
import { reviewProgress, versionLabels } from "../../../lib/art-lab/review-ui";
import { facingLabel } from "../../../lib/art-lab/voxel-math";
import { useFeedbackStore } from "../../../lib/stores/feedback-store";
import { CoachMark, slotNames, TopBar, UnitRail, type RailRow } from "./review/Chrome";
import { DecisionPanel, type Decide } from "./review/DecisionPanel";
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
const railKey = "rtsai-art-review-rail";

async function post(action: ReviewAction): Promise<ReviewEntry> {
  const response = await fetch(`${API}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
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
  const [state, setState] = useState<ReviewState | null>(null);
  const [error, setError] = useState("");
  const [faction, setFaction] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotId>("model");
  const [focusKey, setFocusKey] = useState("current");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [help, setHelp] = useState(false);
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

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API}/state`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json() as ReviewState;
      setState(next);
      setError("");
    } catch (cause) {
      setError(`Could not read the RTSAI-Art workspace: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { clearTimeout(first); window.removeEventListener("focus", onFocus); };
  }, [load]);

  // Deep links: /art/review?unit=r2qilin&slot=model&v=sprite-v2 (kept in the address bar as you move).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const unit = params.get("unit");
    const slotParam = params.get("slot") as SlotId | null;
    const v = params.get("v");
    const id = setTimeout(() => {
      if (unit) setSelected(unit);
      if (slotParam && slotIds.includes(slotParam)) setSlot(slotParam);
      if (v) setFocusKey(v);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const workspace = useMemo(() => new Map((state?.units ?? []).map(u => [u.actor, u])), [state]);
  const rows = useMemo(() => units.map(u => {
    const ws = workspace.get(u.id);
    const entry = state?.review[u.id];
    const count = slotIds.reduce((n, s) => n + candidatesForSlot(ws, s).length, 0);
    return { unit: u, ws, entry, count, needs: needsDecision(ws, entry) };
  }), [units, workspace, state]);
  const queue = useMemo(() => rows.filter(r => r.count > 0), [rows]);
  const shown = useMemo(() => queue.filter(r => faction === "all" || r.unit.factionId === faction), [queue, faction]);
  const railRows: RailRow[] = useMemo(() => shown.map(r => ({ unit: r.unit, needs: r.needs })), [shown]);
  const factions = useMemo(() => [...new Map(queue.map(r => [r.unit.factionId, r.unit.factionName])).entries()], [queue]);
  const progress = reviewProgress(rows);
  const current = rows.find(r => r.unit.id === selected) ?? shown.find(r => r.needs) ?? shown[0] ?? queue[0] ?? null;
  const unit = current?.unit ?? null;
  const ws = current?.ws;
  const versions = useMemo(() => (unit ? slotVersions(unit, ws, slot) : []), [unit, ws, slot]);
  const focus = Math.max(0, versions.findIndex(v => v.key === focusKey));
  const focused = versions[focus] ?? null;
  const entry = current?.entry ?? emptyEntry();
  const decision = entry.slots[slot];
  const counts = useMemo(() => Object.fromEntries(slotIds.map(s => [s, candidatesForSlot(ws, s).length])) as Record<SlotId, number>, [ws]);
  const labels = useMemo(() => versionLabels(ws?.candidates ?? []), [ws]);
  const conceptCurrent = useMemo(() => versions.slice(0, 1), [versions]);
  const currentItem = unit ? stageItem(unit, null) : null;
  const radius = useUnitRadius(frames, slot === "icon" ? null : currentItem, tints);
  const thumbZoom = radius !== null && radius <= 26 ? 2 : 1;
  const comments = useMemo(() => entry.comments.slice().reverse(), [entry]);
  const forgeRecommendation = (entry.forgeRecommendation ?? {}) as Record<string, string>;
  const forgePick = focused?.candidate ? forgeRecommendation[String(focused.candidate.kind)] ?? null : null;

  // Keep the address bar in step for deep links.
  useEffect(() => {
    if (!unit) return;
    const url = new URL(window.location.href);
    url.searchParams.set("unit", unit.id);
    url.searchParams.set("slot", slot);
    if (focusKey !== "current") url.searchParams.set("v", focusKey); else url.searchParams.delete("v");
    window.history.replaceState(null, "", url);
  }, [unit, slot, focusKey]);

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

  const selectUnit = useCallback((id: string) => { setSelected(id); setFocusKey("current"); setLab({ zoom: null }); }, []);
  const changeSlot = useCallback((s: SlotId) => { setSlot(s); setFocusKey("current"); setLab({ zoom: null }); }, []);
  const focusIndex = useCallback((i: number) => { const v = versions[i]; if (v) setFocusKey(v.key); }, [versions]);

  const view = () => {
    const s = useLab.getState();
    return `${slotNames[slot]} · ${focused?.label ?? ""}${slot === "model" ? ` · facing ${s.facing} (${facingLabel(s.facing)})` : ""}`;
  };
  const send = async (action: ReviewAction, message: string) => {
    setBusy(true);
    try {
      const next = await post(action);
      setState(s => (s ? { ...s, review: { ...s.review, [action.actor]: next } } : s));
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
  const keys = useRef({ railRows, unit, versions, focus, focused, decision, decide, slot, help });
  useEffect(() => { keys.current = { railRows, unit, versions, focus, focused, decision, decide, slot, help }; });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select") || target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const k = keys.current;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const candidate = k.focused?.candidate ?? null;
      const handled = () => event.preventDefault();
      const goUnit = (delta: number) => {
        if (!k.railRows.length) return;
        const index = k.railRows.findIndex(r => r.unit.id === k.unit?.id);
        const next = k.railRows[((index < 0 ? 0 : index + delta) + k.railRows.length) % k.railRows.length];
        selectUnit(next.unit.id);
      };
      if (key === "j") { goUnit(1); handled(); }
      else if (key === "k") { goUnit(-1); handled(); }
      else if (key === "ArrowRight") { const v = k.versions[Math.min(k.versions.length - 1, k.focus + 1)]; if (v) setFocusKey(v.key); handled(); }
      else if (key === "ArrowLeft") { const v = k.versions[Math.max(0, k.focus - 1)]; if (v) setFocusKey(v.key); handled(); }
      else if (key === "1" || key === "2" || key === "3") { changeSlot(slotIds[Number(key) - 1]); handled(); }
      else if (key === "u" && k.decide) {
        if (candidate) k.decide.choose(candidate.id); else if (k.slot !== "concept") k.decide.choose("current");
        handled();
      } else if (key === "n" && k.decide && k.slot !== "concept") { k.decide.choose("current"); handled(); }
      else if (key === "r" && k.decide && candidate) { (k.decision.rejected.includes(candidate.id) ? k.decide.unreject : k.decide.reject)(candidate.id); handled(); }
      else if (key === "c") { noteRef.current?.focus(); handled(); }
      else if (key === " ") { setLab(s => ({ spin: !s.spin })); handled(); }
      else if (key === "?") { setHelp(h => !h); handled(); }
      else if (key === "Escape") setHelp(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectUnit, changeSlot]);

  let stage: React.ReactNode = null;
  if (unit && focused) {
    if (slot === "model") stage = <ModelStage versions={versions} focus={focus} allowCompare frames={frames} tints={tints} unitId={unit.id} radius={radius} onFocus={focusIndex} />;
    else if (slot === "icon") stage = <IconStage versions={versions} focus={focus} unit={unit} units={units} onFocus={focusIndex} />;
    else if (focused.key === "current") stage = <ModelStage versions={conceptCurrent} focus={0} allowCompare={false} frames={frames} tints={tints} unitId={unit.id} radius={radius} onFocus={focusIndex} />;
    else stage = <ConceptStage version={focused} />;
  }

  return (
    <div className="lab">
      <TopBar slot={slot} counts={counts} onSlot={changeSlot} decided={progress.decided} total={progress.total} tints={tints} help={help} onHelp={setHelp} />
      <div className={`lab-body${collapsed ? " is-collapsed" : ""}`}>
        <UnitRail rows={railRows} selected={unit?.id ?? null} faction={faction} factions={factions} onFaction={setFaction} onSelect={selectUnit} collapsed={collapsed} onCollapse={collapse} />
        <main className="lab-main" id="main-content">
          {error ? <p className="lab-empty">{error}</p>
            : !state ? <p className="lab-empty">Loading the workspace…</p>
            : !unit ? <p className="lab-empty">No candidates yet.</p>
            : stage}
          {unit && focused && (
            <Filmstrip versions={versions} focus={focus} decision={decision} frames={frames} tints={tints} thumbZoom={thumbZoom} radius={radius}
              imageFit={slot === "icon" ? "pixel" : "cover"} onFocus={focusIndex} />
          )}
          {toast && <p className="lab-toast" role="status">{toast}</p>}
        </main>
        {unit && focused && decide ? (
          <DecisionPanel key={unit.id} unit={unit} slot={slot} version={focused} decision={decision} comments={comments} labelFor={c => (c ? label(c) : "Current")}
            busy={busy} decide={decide} noteRef={noteRef} all={ws?.candidates ?? []} now={now} forgePick={forgePick} />
        ) : <aside className="lab-panel" />}
      </div>
      <CoachMark />
    </div>
  );
}
