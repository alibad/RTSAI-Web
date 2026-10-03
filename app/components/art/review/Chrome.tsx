"use client";

/* Cameos are tiny local files drawn pixel-exact; next/image would resample them. */
/* eslint-disable @next/next/no-img-element */
import { ChevronsLeft, ChevronsRight, CircleHelp, Settings2, X } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { houseColors } from "../../../../lib/art-lab/remap";
import type { SlotId } from "../../../../lib/art-lab/review";
import { backdrops } from "../PixelCanvas";
import type { MapTint } from "../viewSettings";
import { setLab, useLab } from "./lab-store";
import type { ReviewUnit } from "./versions";

export const slotNames: Record<SlotId, string> = { model: "Model", icon: "Icon", concept: "Concept" };

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);
  return { open, setOpen, ref };
}

export const shortcuts: [string, string][] = [
  ["J / K", "Next / previous unit"], ["← / →", "Previous / next version"], ["1 2 3", "Model · Icon · Concept"],
  ["U", "Use this in game"], ["N", "Keep current"], ["R", "Reject"], ["C", "Write a note"],
  ["Space", "Spin"], ["Drag", "Turn the unit"], ["Shift+drag", "Turn the turret"], ["Wheel", "Zoom"], ["?", "This help"],
];

function ViewPopover({ tints }: { tints: MapTint[] }) {
  const { open, setOpen, ref } = usePopover();
  const ground = useLab(s => s.ground);
  const tintMap = useLab(s => s.tintMap);
  const color = useLab(s => s.color);
  const shadow = useLab(s => s.shadow);
  return (
    <div className="lab-pop-wrap" ref={ref}>
      <button type="button" className="lab-ghost" aria-expanded={open} onClick={() => setOpen(o => !o)}><Settings2 size={15} /> View</button>
      {open && (
        <div className="lab-pop" role="dialog" aria-label="View settings">
          <div className="lab-field">
            <span className="lab-label">Ground</span>
            <div className="lab-seg">
              {backdrops.map(b => <button key={b.id} type="button" aria-pressed={ground === b.id} onClick={() => setLab({ ground: b.id })}>{b.label}</button>)}
            </div>
          </div>
          <label className="lab-field">
            <span className="lab-label">Map light</span>
            <select value={tintMap} onChange={e => setLab({ tintMap: e.target.value })}>
              <option value="">Neutral</option>
              {tints.map(t => <option key={t.map} value={t.map}>{t.title}</option>)}
            </select>
          </label>
          <div className="lab-field">
            <span className="lab-label">House colour</span>
            <div className="lab-swatches">
              {houseColors.map(c => <button key={c.id} type="button" className="lab-swatch" style={{ background: `#${c.hex}` }} aria-pressed={color === c.hex} aria-label={c.name} title={c.name} onClick={() => setLab({ color: c.hex })} />)}
              <button type="button" className="lab-swatch is-raw" aria-pressed={color === null} aria-label="As shipped (no remap)" title="As shipped" onClick={() => setLab({ color: null })}>∅</button>
            </div>
          </div>
          <label className="lab-field is-row">
            <span className="lab-label">Shadow</span>
            <input type="checkbox" checked={shadow} onChange={e => setLab({ shadow: e.target.checked })} />
          </label>
        </div>
      )}
    </div>
  );
}

export function HelpPopover({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onOpenChange(false); };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, onOpenChange]);
  return (
    <div className="lab-pop-wrap" ref={ref}>
      <button type="button" className="lab-icon-btn" aria-expanded={open} aria-label="Keyboard shortcuts" title="Shortcuts (?)" onClick={() => onOpenChange(!open)}><CircleHelp size={16} /></button>
      {open && (
        <div className="lab-pop is-help" role="dialog" aria-label="Keyboard shortcuts">
          <table><tbody>{shortcuts.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

export function TopBar({ slot, counts, onSlot, decided, total, tints, help, onHelp }: {
  slot: SlotId;
  counts: Record<SlotId, number>;
  onSlot: (slot: SlotId) => void;
  decided: number;
  total: number;
  tints: MapTint[];
  help: boolean;
  onHelp: (open: boolean) => void;
}) {
  return (
    <header className="lab-top">
      <div className="lab-brand"><b>Art Lab</b><span>Review</span></div>
      <div className="lab-seg lab-slots" role="tablist" aria-label="Slot">
        {(["model", "icon", "concept"] as const).map((id, i) => (
          <button key={id} type="button" role="tab" aria-selected={slot === id} onClick={() => onSlot(id)} title={`${slotNames[id]} (${i + 1})`}>
            {slotNames[id]}<small>{counts[id]}</small>
          </button>
        ))}
      </div>
      <div className="lab-top-right">
        <span className="lab-progress" title="Units with candidates that have a decision">
          <i style={{ ["--done" as string]: total ? decided / total : 0 }} aria-hidden="true" />
          {decided} of {total} units decided
        </span>
        <HelpPopover open={help} onOpenChange={onHelp} />
        <ViewPopover tints={tints} />
      </div>
    </header>
  );
}

export type RailRow = { unit: ReviewUnit; needs: boolean };

export const UnitRail = memo(function UnitRail({ rows, selected, faction, factions, onFaction, onSelect, collapsed, onCollapse }: {
  rows: RailRow[];
  selected: string | null;
  faction: string;
  factions: [string, string][];
  onFaction: (id: string) => void;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}) {
  return (
    <nav className={`lab-rail${collapsed ? " is-collapsed" : ""}`} aria-label="Units">
      <div className="lab-rail-head">
        {!collapsed && (
          <select aria-label="Faction" value={faction} onChange={e => onFaction(e.target.value)}>
            <option value="all">All factions</option>
            {factions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
        <button type="button" className="lab-icon-btn" onClick={() => onCollapse(!collapsed)} aria-label={collapsed ? "Expand the unit list" : "Collapse the unit list"} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>
      <ol>
        {rows.map(r => (
          <li key={r.unit.id}>
            <button type="button" aria-current={selected === r.unit.id ? "true" : undefined} onClick={() => onSelect(r.unit.id)} title={r.unit.name}>
              {r.unit.spec.cameo ? <img src={r.unit.spec.cameo} width={60} height={48} alt="" /> : <span className="lab-noicon" />}
              {collapsed ? <i className={`lab-dot${r.needs ? " is-needs" : " is-done"}`} aria-label={r.needs ? "Needs decision" : "Decided"} /> : (
                <span className="lab-rail-text">
                  <b>{r.unit.name}</b>
                  <span className={`lab-pill${r.needs ? " is-needs" : " is-good"}`}>{r.needs ? "Needs decision" : "Decided"}</span>
                </span>
              )}
            </button>
          </li>
        ))}
        {!rows.length && <li className="lab-hint lab-rail-empty">No candidates yet.</li>}
      </ol>
    </nav>
  );
});

const coachKey = "rtsai-art-review-coach-v3";
/** One-time explanation of the three actions; dismissed for good with "Got it". */
export function CoachMark() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let seen = true;
    try { seen = localStorage.getItem(coachKey) === "1"; } catch { /* storage unavailable */ }
    if (seen) return;
    const id = setTimeout(() => setShow(true), 400);
    return () => clearTimeout(id);
  }, []);
  if (!show) return null;
  const dismiss = () => { setShow(false); try { localStorage.setItem(coachKey, "1"); } catch { /* ignore */ } };
  return (
    <div className="lab-coach" role="dialog" aria-label="How deciding works">
      <button type="button" className="lab-icon-btn" onClick={dismiss} aria-label="Dismiss"><X size={14} /></button>
      <p><b>Use this in game</b> puts the version into the mod at the next export.</p>
      <p><b>Keep current</b> keeps what ships today.</p>
      <p><b>Reject</b> tells the Forge to drop that direction.</p>
      <button type="button" className="lab-primary is-small" onClick={dismiss}>Got it</button>
    </div>
  );
}
