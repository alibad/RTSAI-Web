"use client";

/* Cameos are tiny local files drawn pixel-exact; next/image would resample them. */
/* eslint-disable @next/next/no-img-element */
import { Check, ChevronRight, ChevronsLeft, ChevronsRight, CircleHelp, Settings2, X, Volume2 } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { sourceLabel } from "../../../../lib/art-lab/asset-source";
import { OptionSelect, SearchSelect } from "../../ui/fields";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import { houseColors } from "../../../../lib/art-lab/remap";
import type { SlotId } from "../../../../lib/art-lab/review";
import { backdrops } from "../PixelCanvas";
import type { MapTint } from "../viewSettings";
import { flagImage, prewarmFlags, useFlagBitmaps } from "./flag-bitmaps";
import { setLab, useLab } from "./lab-store";
import { stageItem, type ReviewUnit } from "./versions";
import type { FrameStore } from "./frames";
import { ModelThumb } from "./Filmstrip";

export const slotNames: Record<SlotId, string> = { model: "Model", icon: "Icon", concept: "Concept" };

export const shortcuts: [string, string][] = [
  ["J / K", "Next / previous unit"], ["1 – 8", "Asset chain step"], ["← / →", "Previous / next version"], ["I", "Build icon"],
  ["U", "Use this in game"], ["N", "Keep current"], ["R", "Reject"], ["C", "Write a note"],
  ["Space", "Spin"], ["Drag", "Turn the unit"], ["Shift+drag", "Turn the turret"], ["Wheel", "Zoom"], ["0", "True size (1×)"], ["P", "Next player colour"], ["?", "This help"],
];

/** View settings (ground, map light, house colour, shadow) in the UI kit's popover. */
function ViewPopover({ tints }: { tints: MapTint[] }) {
  const ground = useLab(s => s.ground);
  const tintMap = useLab(s => s.tintMap);
  const color = useLab(s => s.color);
  const shadow = useLab(s => s.shadow);
  return (
    <Popover modal={false}>
      <PopoverTrigger className="lab-ghost"><Settings2 size={15} /> View</PopoverTrigger>
      <PopoverContent align="end" className="lab-tokens lab-pop" aria-label="View settings">
        <div className="lab-field">
          <span className="lab-label">Ground</span>
          <div className="lab-seg">
            {backdrops.map(b => <button key={b.id} type="button" aria-pressed={ground === b.id} onClick={() => setLab({ ground: b.id })}>{b.label}</button>)}
          </div>
        </div>
        <div className="lab-field">
          <span className="lab-label">Map light</span>
          <OptionSelect aria-label="Map light" size="sm" contentClassName="w-auto max-w-80" value={tintMap} onValueChange={tintMap => setLab({ tintMap })} options={[{ value: "", label: "Neutral" }, ...tints.map(t => ({ value: t.map, label: t.title }))]} />
        </div>
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
      </PopoverContent>
    </Popover>
  );
}

/** Keyboard shortcuts, in the UI kit's popover; "?" toggles it. */
export function HelpPopover({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <PopoverTrigger className="lab-icon-btn" aria-label="Keyboard shortcuts" title="Shortcuts (?)"><CircleHelp size={16} /></PopoverTrigger>
      <PopoverContent align="end" className="lab-tokens lab-pop is-help" aria-label="Keyboard shortcuts">
        <table><tbody>{shortcuts.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
      </PopoverContent>
    </Popover>
  );
}

export function TopBar({ slot, counts, onSlot, decided, total, tints, help, onHelp, name, encounter = false, tally = null, heading = null }: {
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
  /** Roster progress for the asset chain; replaces the decided-units bar when given. */
  tally?: React.ReactNode;
  /** A workspace title in place of the actor name and its artwork switch (the review board). */
  heading?: string | null;
}) {
  return (
    <header className="lab-top">
      <div className="lab-brand"><b>{heading ?? (encounter ? "Combat experiment" : name ?? "Choose an actor")}</b></div>
      {!encounter && !heading && <div className="lab-seg studio-art-switch" role="radiogroup" aria-label="Artwork">{(["model", "icon"] as const).map(id => <button key={id} type="button" role="radio" aria-checked={slot === id} onClick={() => onSlot(id)} title={id === "icon" ? "Build icon (I)" : "Unit and its asset chain"}>{id === "model" ? "Unit" : "Build icon"}{id === "icon" && counts.icon ? <small>{counts.icon}</small> : null}</button>)}</div>}
      <div className="lab-top-right">
        {!encounter && tally}
        {total > 0 && !encounter && !tally && <span className="lab-progress" title="Units with candidates that have a decision">
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
/** variants: other units with the same name and pictures, folded into this row (a mod's "All units"). */
export type RailRow = { unit: ReviewUnit; origin: Origin; count: number; needs: boolean; variants?: number };
export type RailFilter = "all" | "original" | "new" | "candidates" | "needs";
/** added: how many of its actors are the project's own (new) units; 0 for an original country. */
export type FactionSummary = { id: string; name: string; units: number; added: number; withCandidates: number; decided: number; /** A mod's own flag (a data URL). */ flag?: string | null };

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

export function Flag({ id, size = "m", image }: { id: string; size?: "s" | "m" | "l"; /** Another project's own flag for the faction. */ image?: string | null }) {
  useFlagBitmaps();
  const src = image ?? flagImage(id);
  return src ? <img className={`lab-flag is-${size}`} src={src} alt="" draggable={false} /> : <span className={`lab-flag is-${size} is-code`} aria-hidden="true">{({america:"US",england:"GB",france:"FR",germany:"DE",korea:"KR",russia:"RU",ukraine:"UA",cuba:"CU",libya:"LY",iraq:"IQ"} as Record<string,string>)[id] ?? id.slice(0,2).toUpperCase()}</span>;
}

/**
 * The faction switch: flag, name, roster size and decided progress, as the UI kit's searchable list (type a name,
 * arrows, Enter, Esc). Collapsed, the rail shows the flag alone.
 */
function FactionPicker({ factions, faction, onFaction, compact }: { factions: FactionSummary[]; faction: string; onFaction: (id: string) => void; compact: boolean }) {
  // Rasterise every faction flag once in idle time, so the picker's first opening has nothing heavy to paint.
  const ids = factions.map(f => f.id).join(",");
  useEffect(() => { if (ids) prewarmFlags(ids.split(",")); }, [ids]);
  // The project's factions first, then the original countries, so the list opens on the ones being reviewed.
  const options = useMemo(() => {
    const mixed = factions.some(f => f.added) && factions.some(f => !f.added);
    return [...factions].sort((a, b) => Number(!a.added) - Number(!b.added)).map(f => ({
      value: f.id, label: f.name, leading: <Flag id={f.id} size="m" image={f.flag} />,
      description: `${f.units} actors${f.withCandidates ? ` · ${f.decided}/${f.withCandidates} decided` : ""}`,
      group: mixed ? (f.added ? "RTS AI factions" : "Original countries") : undefined,
    }));
  }, [factions]);
  // After a choice the kit hands focus back to the field, whose typeahead would take the next J/K ("K" is Korea).
  // Let it go instead, so the Studio's unit shortcuts work straight away, as they did with the old picker.
  const chose = useRef(0);
  const release = (e: React.FocusEvent) => {
    const el = e.target as HTMLElement;
    if (performance.now() - chose.current < 1500 && el.matches("[data-slot=combobox-trigger]")) { chose.current = 0; el.blur(); }
  };
  if (!factions.length) return null;
  return (
    <div className={`lab-picker${compact ? " is-compact" : ""}`} onFocus={release}>
      <SearchSelect aria-label="Faction" value={faction} onValueChange={id => { chose.current = performance.now(); onFaction(id); }} options={options} placeholder="Find a faction…" contentClassName="lab-picker-pop" />
    </div>
  );
}

/**
 * The unit itself as its list picture, for a unit whose build icon cannot be painted (Shattered Paradise's icons need
 * Tiberian Sun's palette, which is not on this machine). Drawn while the row is near the screen.
 */
function RailModel({ unit, frames, tints }: { unit: ReviewUnit; frames: FrameStore; tints: MapTint[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  // Only the rows near the screen hold a picture: each one redraws when the stage turns.
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(e => setNear(e[e.length - 1].isIntersecting), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const item = useMemo(() => (near ? stageItem(unit, null) : null), [near, unit]);
  return <span ref={ref} className="lab-noicon lab-railmodel">{item && <ModelThumb item={item} frames={frames} tints={tints} zoom={1} width={60} height={48} radius={null} />}</span>;
}

const RailItem = memo(function RailItem({ row, current, collapsed, onSelect, frames, tints }: { row: RailRow; current: boolean; collapsed: boolean; onSelect: (id: string) => void; frames?: FrameStore; tints?: MapTint[] }) {
  const { unit, origin, count, needs, variants = 0 } = row;
  const status = count ? (needs ? "Needs decision" : "Decided") : null;
  return (
    <li>
      <button type="button" aria-current={current ? "true" : undefined} onClick={() => onSelect(unit.id)}
        title={`${unit.name} · ${originTitle[origin]}${count ? ` · ${count} candidate${count === 1 ? "" : "s"}, ${status!.toLowerCase()}` : ""}`}>
        <span className="lab-cameo">
          {(unit.identity ?? unit.spec.cameo) ? <img src={(unit.identity ?? unit.spec.cameo)!} width={60} height={48} alt="" loading="lazy" decoding="async" draggable={false} />
            : frames && tints ? <RailModel unit={unit} frames={frames} tints={tints} /> : <span className="lab-noicon" />}
        </span>
        {!collapsed && <span className="lab-rail-text"><b>{unit.name}</b><small>{sourceLabel(unit)}{variants ? ` · ${variants + 1} versions` : ""}</small></span>}
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
export const UnitRail = memo(function UnitRail({ rows, selected, faction, factions, onFaction, filter, onFilter, onSelect, collapsed, onCollapse, onSounds, frames, tints }: {
  /** With these, a unit with no build icon shows itself in the list. */
  frames?: FrameStore;
  tints?: MapTint[];
  /** Opens the faction's sounds (announcer, voices, music); absent where there are none (Classic). */
  onSounds?: () => void;
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
          {onSounds && !collapsed && <button type="button" className="lab-icon-btn" onClick={onSounds} aria-label="Faction sounds" title="The faction’s announcer, voices and music"><Volume2 size={16} /></button>}
          <button type="button" className="lab-icon-btn" onClick={() => onCollapse(!collapsed)} aria-label={collapsed ? "Expand the unit list" : "Collapse the unit list"} title={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </div>
        {!collapsed && <div className="studio-rail-tools"><input aria-label="Find an actor" placeholder="Find an actor…" value={search} onChange={e => setSearch(e.target.value)} /><OptionSelect aria-label="Actor category" size="sm" value={domain} onValueChange={setDomain} options={[{ value: "all", label: "Everything" }, { value: "buildings", label: "Buildings & defenses" }, ...groupOrder.filter(c => c !== "structure" && c !== "defense").map(c => ({ value: c, label: groupNames[c] }))]} /></div>}
        {!collapsed && (
          <OptionSelect<RailFilter> className="studio-roster-filter" size="sm" aria-label="Roster filter" value={filter} onValueChange={onFilter} options={railFilters.map(f => ({ value: f.id, label: `${f.id === "all" ? "All artwork" : f.label} · ${counts[f.id]}`, disabled: !counts[f.id] && f.id !== "all" }))} />
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
            {!folded && <ol>{g.rows.map(r => <RailItem key={r.unit.id} row={r} current={selected === r.unit.id} collapsed={collapsed} onSelect={onSelect} frames={frames} tints={tints} />)}</ol>}
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
