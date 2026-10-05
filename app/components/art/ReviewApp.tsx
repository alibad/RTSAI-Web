"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { candidatesForSlot, emptyEntry, needsDecision, slotIds, type ReviewAction, type ReviewEntry, type ReviewState, type SlotId, type UnitWorkspace } from "../../../lib/art-lab/review";
import { kindTags, reviewProgress, versionLabels } from "../../../lib/art-lab/review-ui";
import { actionCoverage, candidateChecks, chainSteps, decisionState, defaultModelFocus, designFor, fromModel, glbOptions, isChainStep, meshCandidate, nativeCandidates, rosterCounts, type ChainStep, type PreviewStatus } from "../../../lib/art-lab/chain";
import type { ModelLibrary } from "../../../lib/art-lab/models";
import { houseColors } from "../../../lib/art-lab/remap";
import { facingLabel } from "../../../lib/art-lab/voxel-math";
import { useFeedbackStore } from "../../../lib/stores/feedback-store";
import type { RosterPayload } from "../../../lib/art-lab/originals";
import { railFilters, slotNames, TopBar, UnitRail, type FactionSummary, type Origin, type RailFilter, type RailRow } from "./review/Chrome";
import { DecisionPanel, type Decide } from "./review/DecisionPanel";
import { ActionRow, ActionShelf, BehaviorPanel, ChecksPanel, StudioBar } from "./review/Studio";
import { SourceLibrary } from "./review/Sources";
import { Arena } from "./review/Arena";
import { Filmstrip } from "./review/Filmstrip";
import { FrameStore } from "./review/frames";
import { ConceptStage, IconStage, preloadImages } from "./review/ImageStages";
import { rememberView, setLab, useLab } from "./review/lab-store";
import { ModelStage, useUnitRadius } from "./review/Stage";
import { slotVersions, stageItem, type ReviewUnit } from "./review/versions";
import { AssetChain, RosterTally, type ChainData } from "./review/Chain";
import { GlbStage } from "./review/GlbStage";
import { ReviewBoard } from "./review/ReviewBoard";
import type { MapTint } from "./viewSettings";
import "./review/review.css";

export type { ReviewUnit } from "./review/versions";

const API = "/api/art-review";
/** Focus sentinel: the newest native candidate (or the design), resolved once the workspace is known. */
const AUTO = "auto";
/** How long a faction switch defers frame rendering (measured: the switch paint presents within this on SwiftShader). */
const SWITCH_HOLD_MS = 150;

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
 * Faction Studio (local development only). One asset chain per actor sits above the stage: in game now, design,
 * 3D model, game model, animations, checks and your call. Each step opens on the stage. Choices go to
 * RTSAI-Art/review.json through the dev-only API; nothing reaches the mod until a separate export.
 */
export function ReviewApp({ units, tints }: { units: ReviewUnit[]; tints: MapTint[] }) {
  const [mode, setMode] = useState<"ra2" | "classic">("ra2");
  const [surface, setSurface] = useState<"art" | "arena" | "board">("art");
  const [linkReady, setLinkReady] = useState(false);
  const [state, setState] = useState<ReviewState | null>(null);
  const [library, setLibrary] = useState<ModelLibrary | null>(null);
  const [preview, setPreview] = useState<PreviewStatus | null>(null);
  const [error, setError] = useState("");
  const [faction, setFaction] = useState<string | null>(null);
  const [filter, setFilter] = useState<RailFilter>("all");
  const [roster, setRoster] = useState<RosterPayload | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState<ChainStep | typeof AUTO>(AUTO);
  const [iconMode, setIconMode] = useState(false);
  const [focusKey, setFocusKey] = useState(AUTO);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [help, setHelp] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  /** Authored-only: hides original RA2 units and references (for screenshots that may be shared). */
  const [authored, setAuthored] = useState(false);
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
  // The model library (generated 3D models) and the local preview mod: small, read-only, refreshed with the state.
  const loadSide = useCallback(async (signal?: AbortSignal) => {
    const get = async <T,>(path: string): Promise<T | null> => {
      try { const r = await fetch(`${API}/${path}`, { cache: "no-store", signal }); return r.ok ? await r.json() as T : null; } catch { return null; }
    };
    const [models, local] = await Promise.all([get<ModelLibrary>(`models?mode=${mode}`), get<PreviewStatus>(`preview?mode=${mode}`)]);
    if (signal?.aborted) return;
    setLibrary(models);
    setPreview(local);
  }, [mode]);
  useEffect(() => {
    const controller = new AbortController();
    const first = setTimeout(() => { void load(controller.signal); void loadSide(controller.signal); }, 0);
    const onFocus = () => { void load(controller.signal); void loadSide(controller.signal); };
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); clearTimeout(first); window.removeEventListener("focus", onFocus); };
  }, [load, loadSide]);
  // New candidates land while the owner reviews (other agents write them): a tiny fingerprint every 15 s,
  // only while the tab is visible; the full state is fetched again only when it changes.
  useEffect(() => {
    const controller = new AbortController();
    let last: string | null = null;
    const check = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`${API}/stamp?mode=${mode}`, { cache: "no-store", signal: controller.signal });
        const { stamp } = await r.json() as { stamp: string };
        if (last !== null && stamp !== last) { void load(controller.signal); void loadSide(controller.signal); }
        last = stamp;
      } catch { /* offline or closed */ }
    };
    void check();
    const timer = setInterval(() => void check(), 15_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [mode, load, loadSide]);
  // Every faction's roster, with original RA2 units served from the local cache (dev only).
  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/roster?mode=${mode}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() as Promise<RosterPayload> : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(r => { if (!cancelled) setRoster(r); })
      .catch(cause => { if (!cancelled) setToast(`Game roster unavailable: ${cause instanceof Error ? cause.message : String(cause)}`); });
    return () => { cancelled = true; };
  }, [mode]);

  // Deep links: /art/review?unit=r2mantis&step=game&v=voxel-v5-glb (kept in the address bar as you move).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const unit = params.get("unit");
    const slotParam = params.get("slot");
    const stepParam = params.get("step");
    const v = params.get("v");
    const factionParam = params.get("faction");
    const id = setTimeout(() => {
      if (params.get("mode") === "classic") setMode("classic");
      const surface = params.get("view");
      if (surface === "arena" || surface === "board") setSurface(surface);
      if (params.get("authored") === "1") { setAuthored(true); setFilter("new"); }
      if (factionParam) setFaction(factionParam);
      if (unit) setSelected(unit);
      if (isChainStep(stepParam)) setStep(stepParam);
      else if (params.get("models") === "1") setStep("glb");
      else if (slotParam === "concept") setStep("design");
      if (slotParam === "icon") setIconMode(true);
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
      /** GPU resource counts of the shared engine (programs, geometries, textures) for performance checks. */
      engineInfo() { const info = frames.engine?.renderer.info; return info ? { programs: info.programs?.length ?? 0, geometries: info.memory.geometries, textures: info.memory.textures } : null; },
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
    const list = ids.flatMap(i => { const u = unitIndex.get(i); return u ? [rowFor(u)] : []; });
    return [id, authored ? list.filter(r => r.origin === "new") : list] as const;
  })), [factionIds, roster, units, unitIndex, rowFor, authored]);
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
  const boardFactions = useMemo(() => [...new Map(units.map(u => [u.factionId, { id: u.factionId, name: u.factionName }])).values()], [units]);
  const boardUnits = useMemo(() => units.map(u => ({ ...(unitIndex.get(u.id) ?? u), factionId: u.factionId, factionName: u.factionName, origin: "new" as const })), [units, unitIndex]);
  const boardUnitsFor = useCallback((id: string) => boardUnits.filter(u => u.factionId === id), [boardUnits]);
  const boardFaction = boardFactions.some(f => f.id === factionId) ? factionId : boardFactions[0]?.id ?? factionId;
  const counts = useMemo(() => (mode === "ra2" && state ? rosterCounts(units.map(u => u.id), workspace, library, preview, state.review) : null), [mode, state, units, workspace, library, preview]);
  const selectedUnit = selected ? unitIndex.get(selected) : undefined;
  const current = selectedUnit && (!authored || selectedUnit.origin !== "original") ? rowFor(selectedUnit)
    : factionRows.find(r => r.needs) ?? factionRows.find(r => r.count > 0) ?? factionRows[0] ?? null;
  const currentUnit = current?.unit ?? null;
  // Original units are shared by several factions; show them in the faction being browsed.
  const unit = useMemo(() => (currentUnit ? { ...currentUnit, factionId: currentUnit.factionId || factionId, factionName: currentUnit.factionName || factionName } : null), [currentUnit, factionId, factionName]);
  const ws = current?.ws;
  const entry = current?.entry ?? emptyEntry();
  const isNew = unit?.origin !== "original";
  const natives = useMemo(() => nativeCandidates(ws), [ws]);
  // The chain step: the newest native candidate opens by default; an actor without one opens on what ships now.
  const chainStep: ChainStep = step === AUTO ? (natives.length ? "game" : "now") : step;
  const slot: SlotId = iconMode ? "icon" : chainStep === "design" ? "concept" : "model";
  const info = unit ? rosterInfo.get(`${factionId}:${unit.id}`) ?? [...rosterInfo.entries()].find(([k]) => k.endsWith(`:${unit.id}`))?.[1] : undefined;
  const reference = !authored && info?.reference ? unitIndex.get(info.reference) ?? null : null;
  const referenceWhy = info?.referenceWhy;
  const paletteUnits = useMemo(() => factionRows.map(r => ({ ...r.unit, factionId })), [factionRows, factionId]);
  const unitKey = unit?.id ?? null;
  const versions = useMemo(() => (unit ? slotVersions(unit, ws, slot, reference, referenceWhy) : []), [unit, ws, slot, reference, referenceWhy]);
  const nativeChoice = defaultModelFocus(ws, entry.slots.model);
  const fallbackNative = natives.find(c => c.id === nativeChoice) ?? null;
  const meshSource = useMemo(() => meshCandidate(ws, fallbackNative), [ws, fallbackNative]);
  const design = useMemo(() => designFor(ws, meshSource, fallbackNative), [ws, meshSource, fallbackNative]);
  const resolvedKey = focusKey !== AUTO ? focusKey
    : slot === "model" ? (chainStep === "now" ? "current" : nativeChoice)
    : slot === "concept" ? design?.candidate.id ?? "current" : "current";
  const focus = Math.max(0, versions.findIndex(v => v.key === resolvedKey));
  const focused = versions[focus] ?? null;
  const decision = entry.slots[slot];
  const slotCounts = useMemo(() => Object.fromEntries(slotIds.map(s => [s, candidatesForSlot(ws, s).length])) as Record<SlotId, number>, [ws]);
  const labels = useMemo(() => versionLabels(ws?.candidates ?? []), [ws]);
  const conceptCurrent = useMemo(() => versions.slice(0, 1), [versions]);
  const currentItem = useMemo(() => unit ? stageItem(unit, null) : null, [unit]);
  const radius = useUnitRadius(frames, surface === "art" && slot !== "icon" ? currentItem : null, tints);
  // Thumbnails at the largest whole zoom that keeps the unit's turning circle inside the card.
  const thumbZoom = radius === null ? 1 : Math.max(1, Math.min(3, Math.floor(104 / (2 * radius))));
  const chainZoom = radius === null ? 1 : Math.max(1, Math.min(2, Math.floor(56 / (2 * radius))));
  // The lineup already lists every version as a clickable row, so it takes the filmstrip's height.
  const compareMode = useLab(s => s.compare);
  const lineupOnly = compareMode === "lineup" && slot !== "concept" && versions.length > 1;
  const comments = useMemo(() => entry.comments.slice().reverse(), [entry]);
  const forgeRecommendation = (entry.forgeRecommendation ?? {}) as Record<string, string>;
  const forgePick = focused?.candidate ? forgeRecommendation[String(focused.candidate.kind)] ?? null : null;

  // The chain: the game-model step follows the focused native candidate, else the newest one.
  const gameCandidate = slot === "model" && focused?.candidate ? focused.candidate : fallbackNative;
  const gameItem = useMemo(() => (unit && gameCandidate ? stageItem(unit, gameCandidate) : null), [unit, gameCandidate]);
  const modelActor = library?.actors.find(a => a.actor === unit?.id);
  const glb = useMemo(() => glbOptions(modelActor, meshSource), [modelActor, meshSource]);
  const chain: ChainData | null = unit && isNew ? {
    current: { item: currentItem, tag: unit.spec.voxel ? "VXL" : "SHP" },
    design,
    glb: { options: glb },
    game: {
      candidate: gameCandidate, item: gameItem, tag: gameCandidate ? kindTags[gameCandidate.kind] ?? String(gameCandidate.kind).toUpperCase() : "",
      fromGlb: gameCandidate ? fromModel(gameCandidate, ws?.candidates) : false, count: natives.length,
      preview: Boolean(gameCandidate && preview?.actors[unit.id]?.model === gameCandidate.id),
      light: gameCandidate?.renderLight === "stock" ? "stock light" : gameCandidate?.renderLight ? "own light" : null,
    },
    actions: actionCoverage(unit.category, (gameItem ?? currentItem)?.spec, (gameItem ?? currentItem)?.sprite, { spec: currentItem?.spec, sprite: currentItem?.sprite }),
    checks: candidateChecks(gameCandidate),
    decision: decisionState(entry.slots.model, gameCandidate),
  } : null;

  // Keep the address bar in step for deep links.
  useEffect(() => {
    if (!linkReady || !unitKey) return;
    const url = new URL(window.location.href);
    url.searchParams.set("faction", factionId);
    url.searchParams.set("unit", unitKey);
    url.searchParams.set("slot", slot);
    url.searchParams.set("mode", mode);
    url.searchParams.set("view", surface);
    url.searchParams.delete("models");
    if (step !== AUTO) url.searchParams.set("step", step); else url.searchParams.delete("step");
    if (focusKey !== AUTO && focusKey !== "current") url.searchParams.set("v", focusKey); else url.searchParams.delete("v");
    window.history.replaceState(null, "", url);
  }, [linkReady, unitKey, factionId, slot, focusKey, mode, surface, step]);

  // Comparing a candidate opens side by side with what ships now; the in-game and animation steps show one.
  const stepKey = `${unitKey}:${chainStep}:${gameCandidate?.id ?? ""}`;
  useEffect(() => {
    if (!unitKey || slot !== "model") return;
    const [, s] = stepKey.split(":");
    const pair = s === "game" || s === "checks" || s === "call";
    setLab(v => ({ compare: pair && gameCandidate ? (v.compare === "single" || v.compare === "lineup" ? "side" : v.compare) : "single" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the unit, step or candidate changes
  }, [stepKey]);

  // Aircraft fly at cruise altitude in the Animations step; the other steps compare them landed, at a readable size.
  useEffect(() => { setLab({ flying: chainStep === "anim" && !iconMode }); }, [chainStep, iconMode]);

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

  const selectUnit = useCallback((id: string) => { setSelected(id); setFocusKey(AUTO); setStep(AUTO); setLab({ zoom: null, spin: false, animation: "stand", turret: 0 }); }, []);
  // A faction switch repaints everything: let that paint present before the new unit's frames render.
  const changeFaction = useCallback((id: string) => { frames.hold(SWITCH_HOLD_MS); frames.clearQueue(); setFaction(id); setSelected(null); setFocusKey(AUTO); setStep(AUTO); setLab({ zoom: null, spin: false, animation: "stand", turret: 0 }); }, [frames]);
  const changeSlot = useCallback((s: SlotId) => { setIconMode(s === "icon"); if (s === "concept") setStep("design"); else if (s === "model" && step === "design") setStep(AUTO); setFocusKey(AUTO); setLab({ zoom: null }); }, [step]);
  const focusIndex = useCallback((i: number) => { const v = versions[i]; if (v) setFocusKey(v.key); }, [versions]);
  const openStep = useCallback((s: ChainStep) => {
    setIconMode(false);
    setStep(s);
    // The in-game step shows what ships; every other model step follows the chosen candidate (or the newest).
    if (s === "now") setFocusKey("current");
    else if (s === "design") setFocusKey(AUTO);
    else if (focusKey === "current" || focusKey.startsWith("ref:") || step === "design") setFocusKey(AUTO);
    if (s === "anim") setLab({ playing: true, view3d: "off" });
    else setLab({ view3d: "off" });
  }, [focusKey, step]);

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
      c === "current" ? "Keeping current" : slot === "concept" ? `${label(c)} is the reference` : `${label(c)} chosen for the game (applies at the next export)`),
    clear: () => void send({ type: "clear", actor: unit.id, slot }, "Decision undone"),
    reject: c => void send({ type: "reject", actor: unit.id, slot, candidate: c }, `${label(c)} rejected`),
    unreject: c => void send({ type: "unreject", actor: unit.id, slot, candidate: c }, "Reject undone"),
    comment: text => send({ type: "comment", actor: unit.id, slot, candidate: focused?.candidate?.id ?? null, view: view(), text }, "Note saved"),
  } : null;

  // Keyboard: one listener reading the latest render through a ref.
  // Original units and references are for comparison only: no Use, Keep or Reject. The 3D model step decides nothing.
  const referenceOnly = (unit?.origin === "original" && !focused?.candidate) || focused?.kind === "reference" || (!iconMode && chainStep === "glb");
  const keys = useRef({ visibleRows, unit, versions, focus, focused, decision, decide, slot, help, referenceOnly, chainOn: Boolean(chain) });
  useEffect(() => { keys.current = { visibleRows, unit, versions, focus, focused, decision, decide, slot, help, referenceOnly, chainOn: Boolean(chain) }; });
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
      else if (/^[1-7]$/.test(key)) { if (k.chainOn) openStep(chainSteps[Number(key) - 1].id); else if (Number(key) <= 3) changeSlot(slotIds[Number(key) - 1]); handled(); }
      else if (key === "i") { changeSlot(k.slot === "icon" ? "model" : "icon"); handled(); }
      else if (key === "0") { setLab({ zoom: 1 }); handled(); }
      else if (key === "p") { setLab(s => { const i = houseColors.findIndex(c => c.hex === s.color); return { color: houseColors[(i + 1) % houseColors.length].hex }; }); handled(); }
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
  }, [selectUnit, changeSlot, openStep, surface]);

  let stage: React.ReactNode = null;
  if (unit && slot === "model" && chain && chainStep === "glb") stage = <GlbStage key={unit.id} options={glb} name={unit.name} frames={frames} />;
  else if (unit && focused) {
    if (slot === "model") stage = <ModelStage key={mode} versions={versions} focus={focus} allowCompare frames={frames} tints={tints} unitId={unit.id} radius={radius} onFocus={focusIndex} />;
    else if (slot === "icon") stage = <IconStage versions={versions} focus={focus} unit={unit} units={paletteUnits} onFocus={focusIndex} />;
    else if (focused.key === "current") stage = <ModelStage key={mode} versions={conceptCurrent} focus={0} allowCompare={false} frames={frames} tints={tints} unitId={unit.id} radius={radius} onFocus={focusIndex} />;
    else stage = <ConceptStage version={focused} />;
  }
  // The game-model and in-game steps choose between versions; the other steps work on the chosen one.
  const showFilm = Boolean(unit && focused && surface === "art" && !lineupOnly && !(slot === "model" && chain && (versions.length <= 2 || !["now", "game"].includes(chainStep))));
  const showShelf = Boolean(unit && surface === "art" && slot === "model" && (!chain || chainStep === "anim"));
  const inspector = chain && !iconMode && chainStep === "checks" ? "checks" : "facts";
  const board = surface === "board" && mode === "ra2";

  return (
    <div className={`lab${surface === "arena" ? " is-encounter" : ""}${board ? " is-board" : ""}${authored ? " is-authored" : ""}`}>
      {sourcesOpen && <SourceLibrary mode={mode} roster={roster} onClose={() => setSourcesOpen(false)} />}
      <StudioBar onSources={() => setSourcesOpen(true)} mode={mode} onMode={m => { setMode(m); setState(null); setLibrary(null); setPreview(null); setRoster(null); setSelected(null); setFaction(null); setFilter(authored ? "new" : "all"); setStep(AUTO); setFocusKey(AUTO); frames.clearQueue(); setLab({ spin: false, zoom: null, animation: "stand" }); }} surface={surface} onSurface={s => { setSurface(s); setLab({ spin: false, playing: false }); if (s === "board") frames.hold(150); if (s !== "art") { setIconMode(false); setStep(AUTO); } }} />
      <TopBar slot={iconMode ? "icon" : "model"} counts={slotCounts} onSlot={changeSlot} decided={progress.decided} total={progress.total} tints={tints} help={help} onHelp={setHelp} name={unit?.name} encounter={surface === "arena"} heading={board ? "Review board" : null}
        tally={mode === "ra2" ? <RosterTally counts={counts} /> : null} />
      <div className={`lab-body${collapsed ? " is-collapsed" : ""}`}>
        {surface === "art" && <UnitRail rows={railRows} selected={unit?.id ?? null} faction={factionId} factions={factionSummaries} onFaction={changeFaction}
          filter={filter} onFilter={setFilter} onSelect={selectUnit} collapsed={collapsed} onCollapse={collapse} />}
        <main className={`lab-main${showShelf ? " has-actions" : ""}${chain && surface === "art" ? " has-chain" : ""}`} id="main-content">
          {chain && surface === "art" && state && <AssetChain data={chain} step={iconMode ? null : chainStep} onStep={openStep} frames={frames} tints={tints} zoom={chainZoom} radius={radius} />}
          {error ? <p className="lab-empty">{error}</p>
            : !state ? <p className="lab-empty">Loading the workspace…</p>
            : !unit ? <p className="lab-empty">No units.</p>
            : board ? <ReviewBoard factions={boardFactions} factionId={boardFaction} onFaction={changeFaction} unitsFor={boardUnitsFor} allUnits={boardUnits} workspace={workspace} review={state.review} preview={preview}
                frames={frames} tints={tints} decide={send} onOpen={id => { selectUnit(id); setSurface("art"); }} />
            : surface === "arena" ? <Arena key={mode} mode={mode} units={[...unitIndex.values()]} selected={unit} roster={roster} frames={frames} onSelect={selectUnit} /> : stage}
          {showFilm && focused && (
            <Filmstrip versions={versions} focus={focus} decision={decision} frames={frames} tints={tints} thumbZoom={thumbZoom} radius={radius}
              imageFit={slot === "icon" ? "pixel" : "cover"} onFocus={focusIndex} inPreview={slot === "model" && unit ? preview?.actors[unit.id]?.model ?? null : null} />
          )}
          {showShelf && unit && (chain ? <ActionRow unit={unit} version={focused} onEncounter={() => { setSurface("arena"); setLab({ spin: false, playing: false }); }} />
            : <ActionShelf unit={unit} version={focused} mode={mode} onEncounter={() => { setSurface("arena"); setLab({ spin: false, playing: false }); }} />)}
          {toast && <p className="lab-toast" role="status">{toast}</p>}
        </main>
        {surface === "art" && <aside className="studio-inspector" aria-label="Actor details">
        {unit && inspector === "checks" && chain && <ChecksPanel checks={chain.checks} actions={chain.actions} candidate={chain.game.candidate} label={chain.game.candidate ? label(chain.game.candidate.id) : null} />}
        {unit && inspector === "facts" && <BehaviorPanel unit={unit} facts={roster?.stock[unit.id]?.behavior ?? null} />}
        {unit && focused && decide && <details className="studio-review-notes" open={chain && !iconMode && chainStep === "call" ? true : undefined} key={`${unit.id}:${chainStep === "call"}`}><summary>Your call & notes{slotCounts[slot] ? ` · ${slotCounts[slot]} alternatives` : ""}</summary>
          <DecisionPanel key={unit.id} unit={unit} slot={slot} version={focused} decision={decision} comments={comments} labelFor={c => (c ? label(c) : "Current")}
            busy={busy} decide={decide} noteRef={noteRef} all={ws?.candidates ?? []} now={now} forgePick={forgePick} referenceOnly={referenceOnly} reference={reference} />
        </details>}
        </aside>}
      </div>
    </div>
  );
}
