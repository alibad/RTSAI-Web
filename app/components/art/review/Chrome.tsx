"use client";

/* Cameos are tiny local files drawn pixel-exact; next/image would resample them. */
/* eslint-disable @next/next/no-img-element */
import { Check, ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, CircleHelp, Settings2, X } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { sourceLabel } from "../../../../lib/art-lab/asset-source";
import { houseColors } from "../../../../lib/art-lab/remap";
import type { SlotId } from "../../../../lib/art-lab/review";
import { backdrops } from "../PixelCanvas";
import type { MapTint } from "../viewSettings";
import { flagSrc } from "./flags";
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

export function TopBar({ slot, counts, onSlot, decided, total, tints, help, onHelp, name, encounter = false }: {
  slot: SlotId;
  counts: Record<SlotId, number>;
  onSlot: (slot: SlotId) => void;
  decided: number;
  total: number;
  tints: MapTint[];
  help: boolean;
  onHelp: (open: boolean) => void;
  name?: string;
  encounter?: boolean;
}) {
  return (
    <header className="lab-top">
      <div className="lab-brand"><b>{encounter ? "Combat experiment" : name ?? "Choose an actor"}</b></div>
      {!encounter && <label className="studio-art-select">Artwork<select aria-label="Artwork" value={slot} onChange={e => onSlot(e.target.value as SlotId)}>{(["model", "icon", "concept"] as const).map(id => <option key={id} value={id}>{id === "model" ? "In-game model" : slotNames[id]}{counts[id] ? ` · ${counts[id]} alternatives` : ""}</option>)}</select></label>}
      <div className="lab-top-right">
        {total > 0 && !encounter && <span className="lab-progress" title="Units with candidates that have a decision">
          <i style={{ ["--done" as string]: total ? decided / total : 0 }} aria-hidden="true" />
          {decided} of {total} units decided
        </span>}
        <HelpPopover open={help} onOpenChange={onHelp} />
        <ViewPopover tints={tints} />
      </div>
    </header>
  );
}

export type Origin = "new" | "original" | "modified";
export type RailRow = { unit: ReviewUnit; origin: Origin; count: number; needs: boolean };
export type RailFilter = "all" | "original" | "new" | "candidates" | "needs";
export type FactionSummary = { id: string; name: string; units: number; withCandidates: number; decided: number };

export const railFilters: { id: RailFilter; label: string; test: (r: RailRow) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "original", label: "Original", test: r => r.origin !== "new" },
  { id: "new", label: "New", test: r => r.origin === "new" },
  { id: "candidates", label: "Has candidates", test: r => r.count > 0 },
  { id: "needs", label: "Needs decision", test: r => r.needs },
];

const groupNames: Record<string, string> = { infantry: "Infantry", vehicle: "Vehicles", aircraft: "Aircraft", ship: "Ships", defense: "Defenses", structure: "Base buildings" };
const groupOrder = ["infantry", "vehicle", "aircraft", "ship", "defense", "structure"];
const originTitle: Record<Origin, string> = { new: "New: our art in the game today", original: "Original: base game art", modified: "Modified: modified game art" };

function Flag({ id, size = "m" }: { id: string; size?: "s" | "m" | "l" }) {
  const src = flagSrc(id);
  return src ? <img className={`lab-flag is-${size}`} src={src} alt="" draggable={false} /> : <span className={`lab-flag is-${size} is-code`} aria-hidden="true">{({america:"US",england:"GB",france:"FR",germany:"DE",korea:"KR",russia:"RU",ukraine:"UA",cuba:"CU",libya:"LY",iraq:"IQ"} as Record<string,string>)[id] ?? id.slice(0,2).toUpperCase()}</span>;
}

function Progress({ done, total }: { done: number; total: number }) {
  if (!total) return null;
  return (
    <span className="lab-fprog" title={`${done} of ${total} units with candidates decided`}>
      <i style={{ ["--done" as string]: done / total }} aria-hidden="true" />{done}/{total}
    </span>
  );
}

/** The faction switch: flag, name, roster size and decided progress. A keyboard listbox (arrows, Enter, Esc). */
function FactionPicker({ factions, faction, onFaction, compact }: { factions: FactionSummary[]; faction: string; onFaction: (id: string) => void; compact: boolean }) {
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const current = factions.find(f => f.id === faction) ?? factions[0];
  useEffect(() => {
    if (!open) return;
    const at = Math.max(0, factions.findIndex(f => f.id === faction));
    options.current[at]?.focus();
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(null); };
    const reposition = () => {
      const r = button.current?.getBoundingClientRect();
      if (r) setOpen({ top: Math.min(r.bottom + 8, Math.max(8, window.innerHeight - 170)), left: Math.max(8, Math.min(r.left, window.innerWidth - 368)) });
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", reposition);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("resize", reposition); };
  }, [open, factions, faction]);
  // Fixed to the viewport so the rail's scroll box never clips it.
  const show = () => { const r = button.current?.getBoundingClientRect(); if (r) setOpen({ top: r.bottom + 8, left: r.left }); };
  const toggle = () => (open ? setOpen(null) : show());
  const choose = (id: string) => { onFaction(id); setOpen(null); button.current?.focus(); };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const move = (to: number) => { e.preventDefault(); options.current[(to + factions.length) % factions.length]?.focus(); };
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(factions.length - 1);
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(null); button.current?.focus(); }
    else if (e.key === "Tab") setOpen(null);
  };
  if (!current) return null;
  return (
    <div className="lab-picker" ref={wrap}>
      <button ref={button} type="button" className="lab-picker-btn" aria-haspopup="listbox" aria-expanded={Boolean(open)} title={`${current.name}: change faction`}
        onClick={toggle} onKeyDown={e => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); show(); } }}>
        <Flag id={current.id} size="m" />
        {!compact && <><b>{current.name}</b><ChevronDown size={16} aria-hidden="true" /></>}
      </button>
      {open && (
        <div className="lab-picker-pop" role="listbox" aria-label="Faction" style={{ top: open.top, left: open.left }}>
          {factions.map((f, i) => (
            <button key={f.id} id={`faction-${f.id}`} ref={el => { options.current[i] = el; }} type="button" role="option" aria-selected={f.id === faction}
              className="lab-picker-opt" onClick={() => choose(f.id)} onKeyDown={e => onKey(e, i)}>
              <Flag id={f.id} size="l" />
              <span className="lab-picker-name"><b>{f.name}</b><small>{f.units} actors</small></span>
              <Progress done={f.decided} total={f.withCandidates} />
              {f.id === faction && <Check size={16} className="lab-picker-check" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const RailItem = memo(function RailItem({ row, current, collapsed, onSelect }: { row: RailRow; current: boolean; collapsed: boolean; onSelect: (id: string) => void }) {
  const { unit, origin, count, needs } = row;
  const status = count ? (needs ? "Needs decision" : "Decided") : null;
  return (
    <li>
      <button type="button" aria-current={current ? "true" : undefined} onClick={() => onSelect(unit.id)}
        title={`${unit.name} · ${originTitle[origin]}${count ? ` · ${count} candidate${count === 1 ? "" : "s"}, ${status!.toLowerCase()}` : ""}`}>
        <span className="lab-cameo">
          {unit.spec.cameo ? <img src={unit.spec.cameo} width={60} height={48} alt="" loading="lazy" decoding="async" draggable={false} /> : <span className="lab-noicon" />}
        </span>
        {!collapsed && <span className="lab-rail-text"><b>{unit.name}</b><small>{sourceLabel(unit)}</small></span>}
        {count > 0 && (
          <span className={`lab-count${needs ? " is-needs" : " is-done"}`} aria-label={`${count} candidates, ${status}`}>
            {!needs && <Check size={12} strokeWidth={3} aria-hidden="true" />}{count}
          </span>
        )}
      </button>
    </li>
  );
});

/**
 * The faction's whole build roster, grouped like the build palette (base buildings last, folded): every unit
 * shows its static cameo (lazy-loaded), whether its art is New or Original RA2, and how many candidates wait.
 */
export const UnitRail = memo(function UnitRail({ rows, selected, faction, factions, onFaction, filter, onFilter, onSelect, collapsed, onCollapse }: {
  rows: RailRow[];
  selected: string | null;
  faction: string;
  factions: FactionSummary[];
  onFaction: (id: string) => void;
  filter: RailFilter;
  onFilter: (f: RailFilter) => void;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
}) {
  const [buildingsOpen, setBuildingsOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("all");
  const test = railFilters.find(f => f.id === filter)?.test ?? (() => true);
  const groups = groupOrder.map(cat => ({ cat, rows: rows.filter(r => r.unit.category === cat && test(r) && (domain === "all" || (domain === "buildings" ? ["structure", "defense"].includes(cat) : cat === domain)) && r.unit.name.toLowerCase().includes(search.toLowerCase())) })).filter(g => g.rows.length);
  const counts = Object.fromEntries(railFilters.map(f => [f.id, rows.filter(f.test).length]));
  return (
    <nav className={`lab-rail${collapsed ? " is-collapsed" : ""}`} aria-label="Units">
      <div className="lab-rail-head">
        <div className="lab-rail-top">
          <FactionPicker factions={factions} faction={faction} onFaction={onFaction} compact={collapsed} />
          <button type="button" className="lab-icon-btn" onClick={() => onCollapse(!collapsed)} aria-label={collapsed ? "Expand the unit list" : "Collapse the unit list"} title={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </div>
        {!collapsed && <div className="studio-rail-tools"><input aria-label="Find an actor" placeholder="Find an actor…" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Actor category" value={domain} onChange={e => setDomain(e.target.value)}><option value="all">Everything</option><option value="buildings">Buildings & defenses</option>{groupOrder.filter(c => c !== "structure" && c !== "defense").map(c => <option key={c} value={c}>{groupNames[c]}</option>)}</select></div>}
        {!collapsed && (
          <select className="studio-roster-filter" aria-label="Roster filter" value={filter} onChange={e => onFilter(e.target.value as RailFilter)}>{railFilters.map(f => <option key={f.id} value={f.id} disabled={!counts[f.id] && f.id !== "all"}>{f.id === "all" ? "All artwork" : f.label} · {counts[f.id]}</option>)}</select>
        )}
      </div>
      {groups.map(g => {
        const folded = g.cat === "structure" && !buildingsOpen && !g.rows.some(r => r.unit.id === selected);
        return (
          <section key={g.cat} className="lab-group" aria-label={groupNames[g.cat]}>
            {!collapsed && (g.cat === "structure"
              ? <button type="button" className="lab-group-head is-toggle" aria-expanded={!folded} onClick={() => setBuildingsOpen(o => !o)}>
                  <ChevronRight size={14} aria-hidden="true" /><span>{groupNames[g.cat]}</span><small>{g.rows.length}</small>
                </button>
              : <h2 className="lab-group-head"><span>{groupNames[g.cat]}</span><small>{g.rows.length}</small></h2>)}
            {!folded && <ol>{g.rows.map(r => <RailItem key={r.unit.id} row={r} current={selected === r.unit.id} collapsed={collapsed} onSelect={onSelect} />)}</ol>}
          </section>
        );
      })}
      {!groups.length && <p className="lab-hint lab-rail-empty">Nothing matches.</p>}
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
