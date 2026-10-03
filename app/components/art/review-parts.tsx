"use client";

/* Candidate images come from the local dev route at their own sizes; next/image cannot serve them. */
/* eslint-disable @next/next/no-img-element */
import { Check, HelpCircle, MessageSquare, RotateCcw, X, ZoomIn } from "lucide-react";
import { useEffect, useState } from "react";
import { candidateCost, formatCost, slotLabels, type Candidate, type SlotDecision, type SlotId } from "../../../lib/art-lab/review";

export type Decide = {
  choose: (candidate: string) => void;
  clear: () => void;
  reject: (candidate: string) => void;
  unreject: (candidate: string) => void;
  comment: (candidate: string | null) => void;
};

const dismissKey = "rtsai-art-review-howto-dismissed";

/** The mental model, in plain words; dismissible and reopenable. */
export function HowReviewWorks({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <section className="review-howto" aria-label="How review works">
      <header><h2>How review works</h2><button type="button" onClick={onClose} aria-label="Dismiss how review works"><X size={16} /></button></header>
      <div className="review-howto-grid">
        <div>
          <h3>Each unit has three slots</h3>
          <ul>
            <li><b>Battlefield model</b>: what moves on the map, a voxel model or a pre-rendered sprite.</li>
            <li><b>Build icon</b>: the 60×48 cameo in the build palette.</li>
            <li><b>Concept art</b>: reference only. It never ships in the game.</li>
          </ul>
        </div>
        <div>
          <h3>Candidates replace one slot</h3>
          <p>A <b>candidate</b> is a proposed replacement for one slot. For each slot, pick:</p>
          <ul>
            <li><b>Use in game</b>: exactly one per slot; it replaces the current asset at the next export.</li>
            <li><b>Keep current</b>: leave the shipped asset as it is.</li>
            <li><b>Reject</b> on a candidate: “not this direction”.</li>
          </ul>
        </div>
        <div>
          <h3>Comments steer the next round</h3>
          <p>Comments are instructions to the Art Forge for its next round of candidates.</p>
          <p><b>Nothing changes in the game</b> until “Export chosen assets to the mod” runs, a separate later step.</p>
        </div>
      </div>
    </section>
  );
}

export function useHowtoDismissed() {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read a per-browser preference after hydration
    try { setDismissed(localStorage.getItem(dismissKey) === "1"); } catch { /* storage unavailable */ }
  }, []);
  const set = (value: boolean) => { setDismissed(value); try { localStorage.setItem(dismissKey, value ? "1" : "0"); } catch { /* ignore */ } };
  return [dismissed, set] as const;
}

export function ExportBanner() {
  return (
    <div className="review-export" role="note">
      <p><b>Nothing here changes the game yet.</b> Your choices are saved to <code>RTSAI-Art/review.json</code>. They reach the mod only when “Export chosen assets to the mod” runs.</p>
      <button type="button" disabled aria-describedby="review-export-why">Export chosen assets to the mod</button>
      <span id="review-export-why" className="art-hint">Not built yet: the export step comes later and will copy chosen assets into RTSAI-Mod with provenance records.</span>
    </div>
  );
}

export const shortcuts: [string, string][] = [
  ["J / K", "Next / previous unit"], ["H / L", "Previous / next column"], ["1 / 2 / 3", "Battlefield model / Build icon / Concept art"],
  ["U", "Use in game (concept: use as reference)"], ["N", "Keep current"], ["R", "Reject / undo reject"], ["C", "Comment for the Forge"],
  ["Space", "Auto-spin turntable"], ["← / →", "Turn (when a viewer has focus)"], ["?", "Show or hide this help"], ["Esc", "Close a dialog or the comment box"],
];

export function HelpPopover({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="review-help">
      <button type="button" className="art-check" aria-expanded={open} onClick={onToggle} title="Keyboard shortcuts (?)"><HelpCircle size={15} /> Shortcuts</button>
      {open && (
        <div className="review-help-pop" role="dialog" aria-label="Keyboard shortcuts">
          <table><tbody>{shortcuts.map(([k, v]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{v}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

const pretty = (id: string) => id.replace(/^(cameo|voxel|sprite|concept)-v/, "$1 v");

function generatorName(c: Candidate) {
  const weights = c.imageTo3d?.license?.weights ?? "";
  if (/TRELLIS\.2/i.test(weights)) return "TRELLIS.2";
  if (c.imageTo3d?.model) return c.imageTo3d.model;
  return c.model ?? null;
}

export function candidateLabel(c: Candidate) {
  return ["Candidate", pretty(c.id), c.fromConcept ? `made from ${c.fromConcept}` : null, c.variantOf ? `variant of ${c.variantOf}` : null, generatorName(c)].filter(Boolean).join(" · ");
}

/** "made from" thumbnails: the concept sheet and the image the 3D model was built from. */
export function MadeFrom({ candidate, all }: { candidate: Candidate; all: Candidate[] }) {
  const concept = candidate.fromConcept ? all.find(c => c.id === candidate.fromConcept) : undefined;
  const conceptImage = concept?.files.concept ? concept.urls[concept.files.concept] : null;
  const ref = candidate.kind !== "concept" && candidate.files.concept ? candidate.urls[candidate.files.concept] : null;
  if (!conceptImage && !ref) return null;
  return (
    <div className="review-madefrom">
      {conceptImage && <a href={conceptImage} target="_blank" rel="noreferrer" title={`Concept ${concept!.id}`}><img src={conceptImage} alt={`made from ${concept!.id}`} loading="lazy" /><small>made from {concept!.id}</small></a>}
      {ref && <a href={ref} target="_blank" rel="noreferrer" title={candidate.kind === "voxel" ? "Image the 3D model was built from" : "Source image"}><img src={ref} alt="source" loading="lazy" /><small>{candidate.kind === "voxel" ? "3D source image" : "master"}</small></a>}
    </div>
  );
}

export function Scores({ candidate }: { candidate: Candidate }) {
  const s = candidate.scores ?? {};
  const total = typeof s.total === "number" ? s.total : null;
  const bar = typeof s.bar === "number" ? s.bar : null;
  const parts = Object.entries(s).filter(([k, v]) => typeof v === "number" && k !== "total" && k !== "bar");
  if (total === null && !candidate.critique) return null;
  return (
    <details className="review-critique">
      <summary>{total !== null ? <>Forge score <b>{total}</b>{bar !== null ? ` / bar ${bar}` : ""}{s.passes === false ? " · below the bar" : ""}</> : "Forge critique"}</summary>
      {parts.length > 0 && <p className="review-score-parts">{parts.map(([k, v]) => `${k} ${v}`).join(" · ")}</p>}
      {candidate.critique && <p>{candidate.critique}</p>}
      {Array.isArray(s.technicalNotes) && <ul>{(s.technicalNotes as string[]).map(n => <li key={n}>{n}</li>)}</ul>}
    </details>
  );
}

export function Cost({ candidate, all }: { candidate: Candidate; all: Candidate[] }) {
  const cost = candidateCost(candidate, all);
  return <span className="review-cost" title={cost.parts.length ? cost.parts.join(" + ") : "No recorded spend"}>Cost {formatCost(cost)}{cost.parts.length > 1 ? ` (${cost.parts.join(" + ")})` : ""}</span>;
}

/** Decision buttons for one column. */
export function DecisionButtons({ slot, candidate, decision, decide, busy }: {
  slot: SlotId; candidate: string | "current"; decision: SlotDecision; decide: Decide; busy: boolean;
}) {
  const chosen = decision.chosen === candidate;
  const rejected = candidate !== "current" && decision.rejected.includes(candidate);
  const useLabel = slot === "concept" ? "Use as reference for the next round" : candidate === "current" ? "Keep current" : "Use in game";
  return (
    <div className="review-decide">
      {chosen ? (
        <span className="review-chosen-badge"><Check size={14} /> {slot === "concept" ? "Reference for next round" : candidate === "current" ? "Keeping current" : "Chosen for game"} <button type="button" onClick={decide.clear} disabled={busy}><RotateCcw size={12} /> Undo</button></span>
      ) : (
        <button type="button" className="review-use" disabled={busy || rejected} onClick={() => decide.choose(candidate)}><Check size={14} /> {useLabel} <kbd>{candidate === "current" ? "N" : "U"}</kbd></button>
      )}
      {candidate !== "current" && (rejected
        ? <button type="button" className="review-reject is-on" disabled={busy} onClick={() => decide.unreject(candidate)}><RotateCcw size={13} /> Rejected · undo</button>
        : <button type="button" className="review-reject" disabled={busy} onClick={() => decide.reject(candidate)}><X size={13} /> Reject <kbd>R</kbd></button>)}
      <button type="button" className="review-comment" disabled={busy} onClick={() => decide.comment(candidate === "current" ? null : candidate)}><MessageSquare size={13} /> Comment <kbd>C</kbd></button>
    </div>
  );
}

/** A concept sheet at column width; click for a zoomable full view. */
export function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState<"fit" | 1 | 2>("fit");
  const [natural, setNatural] = useState(0);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" className="review-sheet" onClick={() => setOpen(true)} title="Open full size"><img src={src} alt={alt} loading="lazy" /><span><ZoomIn size={14} /> Zoom</span></button>
      {open && (
        <div className="review-lightbox" role="dialog" aria-modal="true" aria-label={alt}>
          <div className="review-lightbox-bar">
            {(["fit", 1, 2] as const).map(z => <button key={String(z)} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>{z === "fit" ? "Fit" : `${z * 100}%`}</button>)}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
          </div>
          <div className={`review-lightbox-body is-${zoom === "fit" ? "fit" : "zoom"}`}>
            <img src={src} alt={alt} onLoad={e => setNatural(e.currentTarget.naturalWidth)} style={zoom === "fit" || !natural ? undefined : { width: natural * zoom, maxWidth: "none" }} />
          </div>
        </div>
      )}
    </>
  );
}

export { slotLabels };
