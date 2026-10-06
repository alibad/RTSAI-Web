"use client";
/* The faction review board: every new unit as a tile (in game now beside the new game model, 1x; 2x on hover or
   focus), its measured checks and animation state, and a keyboard-first way to decide: J/K or arrows move, U uses
   the tile's candidate, R rejects it, C writes a note, Z undoes, Enter opens the unit in the asset chain. A
   decision is written to review.json only when the owner presses a key or clicks; then the next open tile is
   focused. */
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Clipboard, Download, Gamepad2, Minus, X } from "lucide-react";
import { actionCoverage, candidateChecks, checksSummary, fromModel, type PreviewStatus } from "../../../../lib/art-lab/chain";
import { boardCounts, boardTile, isOpen, missingAnimations, nextOpen, type BoardTile } from "../../../../lib/art-lab/board";
import type { ReviewAction, ReviewFile, UnitWorkspace } from "../../../../lib/art-lab/review";
import { kindTags, versionLabels } from "../../../../lib/art-lab/review-ui";
import type { MapTint } from "../viewSettings";
import type { FrameStore } from "./frames";
import { ModelThumb } from "./Filmstrip";
import { Flag } from "./Chrome";
import { composePoster } from "./poster";
import { stageItem, type ReviewUnit } from "./versions";

type Decide = (action: ReviewAction, message: string) => Promise<boolean>;
const groupOrder = ["infantry", "vehicle", "aircraft", "ship", "defense", "structure"];
const PIC_W = 116, PIC_H = 84;

type TileView = BoardTile & { unit: ReviewUnit; label: string; checks: ReturnType<typeof checksSummary>; actions: ReturnType<typeof actionCoverage>; currentItem: ReturnType<typeof stageItem>; nextItem: ReturnType<typeof stageItem> };

const Tile = memo(function Tile({ tile, focused, index, frames, tints, onFocus, onOpen, note, onNote, onCancelNote }: {
  tile: TileView; focused: boolean; index: number; frames: FrameStore; tints: MapTint[];
  onFocus: (i: number) => void; onOpen: (id: string) => void; note: boolean; onNote: (text: string) => void; onCancelNote: () => void;
}) {
  const [hover, setHover] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (focused && document.activeElement !== ref.current && !note) ref.current?.focus({ preventScroll: false }); }, [focused, note]);
  const zoom = hover || focused ? 2 : 1;
  const d = tile.decision.kind;
  const c = tile.checks;
  const present = tile.actions.filter(a => a.present).length;
  return (
    <li className={`board-tile${focused ? " is-focused" : ""}${tile.candidate ? "" : " is-empty"} is-${d}`}>
      <button ref={ref} type="button" tabIndex={focused ? 0 : -1} onClick={() => onOpen(tile.actor)}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => onFocus(index)}
        aria-label={`${tile.unit.name}: ${tile.decision.label}`}>
        <span className="board-pics">
          <span className="board-pic"><span className="board-pic-head"><small>In game now</small></span>
            <span className="board-art">{tile.currentItem ? <ModelThumb item={tile.currentItem} frames={frames} tints={tints} zoom={zoom} width={PIC_W} height={PIC_H} radius={22} /> : <i />}</span></span>
          <span className="board-pic is-new"><span className="board-pic-head"><small>{tile.candidate ? `New · ${tile.label}` : "New"}</small>
            {d === "use" && <span className="board-verdict is-use" title="Use in game"><Check size={11} strokeWidth={3.5} /></span>}
            {d === "rejected" && <span className="board-verdict is-rejected" title="Rejected"><X size={11} strokeWidth={3.5} /></span>}
            {d === "keep" && <span className="board-verdict is-keep" title="Keep current"><Minus size={11} strokeWidth={3.5} /></span>}</span>
            <span className="board-art">{tile.nextItem ? <ModelThumb item={tile.nextItem} frames={frames} tints={tints} zoom={zoom} width={PIC_W} height={PIC_H} radius={22} /> : <i className="board-none">No new model yet</i>}</span></span>
        </span>
        <span className="board-name"><b>{tile.unit.name}</b>{tile.notes > 0 && <small className="board-notes">{tile.notes} note{tile.notes === 1 ? "" : "s"}</small>}</span>
        <span className="board-chips">
          {tile.candidate && <span className={`board-chip is-${c.advisory ? "advisory" : c.state}`} title="Measured by the art tools; not your approval">
            {c.state === "none" ? "Not measured" : c.state === "partial" ? "No stock check" : c.state === "fail" ? `${c.failing} failing` : `${c.passed}/${c.total} pass`}{c.advisory ? " · advisory" : ""}</span>}
          {tile.candidate && tile.actions.length > 0 && <span className={`board-chip ${present === tile.actions.length ? "is-pass" : "is-open"}`} title={tile.actions.map(a => `${a.label}${a.present ? "" : " (missing)"}`).join(", ")}>
            {present === tile.actions.length ? `${present} action${present === 1 ? "" : "s"}` : `No ${tile.actions.filter(a => !a.present).map(a => a.label.toLowerCase()).join(", ")}`}</span>}
          {tile.inPreview && (tile.released ? <span className="board-chip is-pass" title="Promoted: the release plays this model">In game</span>
            : <span className="board-chip is-preview" title="Installed in the local preview copy of the game">In preview</span>)}
          {tile.previewOther && <span className="board-chip" title="The preview copy holds other art for this unit">Preview: other art</span>}
        </span>
      </button>
      {note && <NoteBox name={tile.unit.name} onSave={onNote} onCancel={onCancelNote} />}
    </li>
  );
});

function NoteBox({ name, onSave, onCancel }: { name: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="board-note" role="dialog" aria-label={`Note on ${name}`}>
      <textarea ref={ref} value={text} placeholder="Note for the art route…" aria-label="Note" onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
          else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); if (text.trim()) onSave(text.trim()); }
        }} />
      <small>Enter saves · Esc cancels</small>
    </div>
  );
}

function PlayCard({ preview, onClose }: { preview: PreviewStatus | null; onClose: () => void }) {
  const launch = preview?.launch;
  const [copied, setCopied] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="board-play" role="dialog" aria-label="Play the new look">
      <header><b><Gamepad2 size={16} /> Play the new look</b><button className="lab-icon-btn" aria-label="Close" onClick={onClose}><X size={14} /></button></header>
      <p>A <b>local preview</b> copy of the game with the new models installed. The real mod changes only after your decisions here.</p>
      {launch ? <>
        <ol>
          <li>Open <b>Command Prompt</b>.</li>
          <li>Paste and run:</li>
        </ol>
        <div className="board-command"><code>{launch.command.split(/(?<=\\)/).map((part, i) => <Fragment key={i}>{part}<wbr /></Fragment>)}</code><button className="lab-ghost" onClick={() => { void navigator.clipboard?.writeText(launch.command).then(() => setCopied(true)); }}><Clipboard size={14} />{copied ? "Copied" : "Copy"}</button></div>
        <ol start={3}><li>Choose <b>Skirmish</b> and one of the modern factions.</li></ol>
        <ul className="board-facts">
          <li className={launch.engineBuilt ? "is-ok" : "is-bad"}>{launch.engineBuilt ? "Engine built in the preview copy" : "Engine not built: run make.cmd all in the preview copy first"}</li>
          <li className={launch.ra2Content ? "is-ok" : "is-bad"}>{launch.ra2Content ? "Your Red Alert 2 files found in the support folder" : "Red Alert 2 files not found in the support folder"}</li>
          <li>AI co-commander off in this preview (no companion files; OPENRA_AI_HOST=0)</li>
          <li>Preview branch {preview?.branch ?? "?"} at {preview?.head ?? "?"}</li>
        </ul>
      </> : <p className="lab-hint">The local preview copy was not found.</p>}
    </div>
  );
}

export function ReviewBoard({ factions, factionId, onFaction, unitsFor, allUnits, workspace, review, preview, frames, tints, decide, onOpen }: {
  factions: { id: string; name: string }[];
  factionId: string;
  onFaction: (id: string) => void;
  /** The faction's new units, in build-palette order. */
  unitsFor: (factionId: string) => ReviewUnit[];
  allUnits: ReviewUnit[];
  workspace: Map<string, UnitWorkspace>;
  review: ReviewFile | undefined;
  preview: PreviewStatus | null;
  frames: FrameStore;
  tints: MapTint[];
  decide: Decide;
  onOpen: (unitId: string) => void;
}) {
  const [focus, setFocus] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [play, setPlay] = useState(false);
  const [poster, setPoster] = useState<"idle" | "busy">("idle");
  const [toast, setToast] = useState("");
  const last = useRef<{ actor: string; type: "choose" | "reject"; candidate: string; name: string } | null>(null);
  const gridRef = useRef<HTMLOListElement>(null);
  const units = useMemo(() => unitsFor(factionId).slice().sort((a, b) => (groupOrder.indexOf(a.category) - groupOrder.indexOf(b.category)) || (a.order - b.order)), [unitsFor, factionId]);
  const tiles: TileView[] = useMemo(() => units.map(unit => {
    const ws = workspace.get(unit.id);
    const tile = boardTile(unit.id, ws, review?.[unit.id], preview);
    const nextItem = tile.candidate ? stageItem(unit, tile.candidate, preview?.actors[unit.id]?.animations ?? null) : null;
    const labels = versionLabels(ws?.candidates ?? []);
    return {
      ...tile, unit,
      label: tile.candidate ? `${labels.get(tile.candidate.id) ?? tile.candidate.id}${fromModel(tile.candidate, ws?.candidates) ? "" : " · older route"} · ${kindTags[tile.candidate.kind] ?? tile.candidate.kind}` : "",
      checks: checksSummary(candidateChecks(tile.candidate)),
      actions: nextItem ? actionCoverage(unit.category, nextItem.spec, nextItem.sprite, { spec: unit.spec, sprite: unit.sprite }) : [],
      currentItem: stageItem(unit, null), nextItem,
    };
  }), [units, workspace, review, preview]);
  const counts = boardCounts(tiles);
  const totals = useMemo(() => boardCounts(allUnits.map(u => boardTile(u.id, workspace.get(u.id), review?.[u.id], preview))), [allUnits, workspace, review, preview]);
  const perFaction = useMemo(() => new Map(factions.map(f => [f.id, boardCounts(unitsFor(f.id).map(u => boardTile(u.id, workspace.get(u.id), review?.[u.id], preview)))])), [factions, unitsFor, workspace, review, preview]);
  const missing = missingAnimations(tiles.filter(t => t.candidate).map(t => ({ name: t.unit.name, actions: t.actions })));
  const at = Math.min(focus, Math.max(0, tiles.length - 1));

  useEffect(() => { const id = setTimeout(() => { setFocus(Math.max(0, tiles.findIndex(isOpen))); setNote(null); }, 0); return () => clearTimeout(id); }, [factionId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset per faction only
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 3200); return () => clearTimeout(id); }, [toast]);

  const advance = useCallback((from: number) => {
    const next = nextOpen(tiles.map((t, i) => (i === from ? { ...t, decision: { kind: "use" as const, label: "" } } : t)), from);
    if (next >= 0) setFocus(next); else setToast("Every unit in this faction has a decision.");
  }, [tiles]);
  const act = useCallback(async (kind: "use" | "reject") => {
    const t = tiles[at];
    if (!t?.candidate) { setToast("No new model to decide on this tile."); return; }
    const c = t.candidate;
    const ok = kind === "use"
      ? await decide({ type: "choose", actor: t.actor, slot: "model", candidate: c.id, view: "Review board · 1×" }, `${t.unit.name}: ${t.label.split(" · ")[0]} will be used (applies at the next export) · Z undoes`)
      : await decide({ type: "reject", actor: t.actor, slot: "model", candidate: c.id }, `${t.unit.name}: ${t.label.split(" · ")[0]} rejected · Z undoes`);
    if (!ok) return;
    last.current = { actor: t.actor, type: kind === "use" ? "choose" : "reject", candidate: c.id, name: t.unit.name };
    advance(at);
  }, [tiles, at, decide, advance]);
  const undo = useCallback(async () => {
    const l = last.current;
    if (!l) { setToast("Nothing to undo."); return; }
    const ok = l.type === "choose"
      ? await decide({ type: "clear", actor: l.actor, slot: "model" }, `${l.name}: decision undone`)
      : await decide({ type: "unreject", actor: l.actor, slot: "model", candidate: l.candidate }, `${l.name}: reject undone`);
    if (ok) { last.current = null; const i = tiles.findIndex(t => t.actor === l.actor); if (i >= 0) setFocus(i); }
  }, [decide, tiles]);
  const saveNote = useCallback(async (text: string) => {
    // The note belongs to the tile it was opened on, even if a queued decision has moved the focus since.
    const t = tiles.find(x => x.actor === note);
    if (!t) return;
    const ok = await decide({ type: "comment", actor: t.actor, slot: "model", candidate: t.candidate?.id ?? null, view: "Review board · 1×", text }, `Note saved on ${t.unit.name}`);
    if (ok) setNote(null);
  }, [tiles, note, decide]);
  const exportPoster = useCallback(async () => {
    if (poster === "busy") return;
    setPoster("busy");
    try {
      const name = factions.find(f => f.id === factionId)?.name ?? factionId;
      const blob = await composePoster(`${name} · before / after`, `In game now (left) and the new game model (right) of every new unit, at 1x in-game size · candidates, not approved · ${new Date().toISOString().slice(0, 10)}`,
        tiles.map(t => ({ name: t.unit.name, category: t.unit.category, current: t.currentItem, next: t.nextItem, note: t.candidate ? `${t.label}${t.inPreview ? " · in preview" : ""}` : "no new model yet" })), frames);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `rtsai-${factionId}-before-after.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { setToast(`Poster failed: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setPoster("idle"); }
  }, [poster, factions, factionId, tiles, frames]);

  // Keyboard-first deciding; typing in the note box never triggers it. Decisions run one after another, each on
  // the tile focused when its turn comes (after the previous one has been saved and drawn), so a quick U U R
  // never lands on the wrong unit or twice on the same one.
  const keys = useRef({ act, undo, at, tiles, note, play });
  useEffect(() => { keys.current = { act, undo, at, tiles, note, play }; });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((run: () => Promise<void>) => {
    queue.current = queue.current.then(run).catch(() => undefined).then(() => new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0))));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = keys.current;
      if (k.note || k.play) return;
      // Only the board's own keys, and only while the board (a tile) has the keyboard.
      if (target && target !== document.body && !target.closest(".board-grid")) return;
      const cols = Math.max(1, Math.round((gridRef.current?.clientWidth ?? 1) / ((gridRef.current?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 1)));
      const move = (to: number) => { e.preventDefault(); setFocus(Math.max(0, Math.min(k.tiles.length - 1, to))); };
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === "j" || key === "ArrowRight") move(k.at + 1);
      else if (key === "k" || key === "ArrowLeft") move(k.at - 1);
      else if (key === "ArrowDown") move(k.at + cols);
      else if (key === "ArrowUp") move(k.at - cols);
      else if (key === "Home") move(0);
      else if (key === "End") move(k.tiles.length - 1);
      else if (key === "u") { e.preventDefault(); enqueue(() => keys.current.act("use")); }
      else if (key === "r") { e.preventDefault(); enqueue(() => keys.current.act("reject")); }
      else if (key === "c") { e.preventDefault(); if (k.tiles[k.at]) setNote(k.tiles[k.at].actor); }
      else if (key === "z") { e.preventDefault(); enqueue(() => keys.current.undo()); }
      else if (key === "Enter" || key === "o") { e.preventDefault(); if (k.tiles[k.at]) onOpen(k.tiles[k.at].actor); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen, enqueue]);

  const name = factions.find(f => f.id === factionId)?.name ?? factionId;
  return (
    <div className="board">
      <header className="board-head">
        <nav className="board-factions" aria-label="Faction">
          {factions.map(f => { const c = perFaction.get(f.id); return (
            <button key={f.id} type="button" aria-pressed={f.id === factionId} onClick={() => onFaction(f.id)} title={`${f.name}: ${c?.decided ?? 0} of ${c?.withModel ?? 0} decided`}>
              <Flag id={f.id} size="s" /><span>{f.name}</span><small>{c?.decided ?? 0}/{c?.withModel ?? 0}</small>
            </button>
          ); })}
        </nav>
        <div className="board-actions">
          <button className="lab-ghost" onClick={() => setPlay(p => !p)} aria-expanded={play}><Gamepad2 size={15} />Play the new look</button>
          <button className="lab-ghost" onClick={() => void exportPoster()} disabled={poster === "busy"}><Download size={15} />{poster === "busy" ? "Drawing…" : "Poster PNG"}</button>
        </div>
        {play && <PlayCard preview={preview} onClose={() => setPlay(false)} />}
      </header>
      <div className="board-summary">
        <h2>{name}</h2>
        <span className="board-count"><b>{counts.decided}</b> of {counts.withModel} decided</span>
        <span className="board-count"><b>{counts.inPreview}</b> of {counts.withModel} in the preview game</span>
        {counts.withoutModel > 0 && <span className="board-count is-muted">{counts.withoutModel} without a new model yet</span>}
        <span className="board-count is-muted">All factions: {totals.decided} of {totals.withModel} decided · {totals.inPreview} in preview</span>
        <span className="board-keys"><kbd>J</kbd><kbd>K</kbd> move · <kbd>U</kbd> use · <kbd>R</kbd> reject · <kbd>C</kbd> note · <kbd>Z</kbd> undo · <kbd>Enter</kbd> open</span>
      </div>
      <ol className="board-grid" ref={gridRef}>
        {tiles.map((t, i) => <Tile key={t.actor} tile={t} index={i} focused={i === at} frames={frames} tints={tints} onFocus={setFocus} onOpen={onOpen}
          note={note === t.actor} onNote={text => void saveNote(text)} onCancelNote={() => setNote(null)} />)}
      </ol>
      {missing.length > 0 && <details className="board-missing"><summary>Missing animations · {missing.length} units</summary>
        <ul>{missing.map(m => <li key={m.name}><b>{m.name}</b> no {m.missing.map(x => x.toLowerCase()).join(", ")}</li>)}</ul></details>}
      {toast && <p className="lab-toast" role="status">{toast}</p>}
    </div>
  );
}
