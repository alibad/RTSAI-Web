"use client";

/* Candidate images come from the local dev route at their own sizes; next/image cannot serve them. */
/* eslint-disable @next/next/no-img-element */
import { Check, ExternalLink, Info, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { candidateCost, declaredTurretOffset, formatCost, parseCandidateRules, type Candidate, type ReviewComment, type SlotDecision, type SlotId } from "../../../../lib/art-lab/review";
import { appendChip, provenanceChain, quickChips, relativeTime } from "../../../../lib/art-lab/review-ui";
import type { ReviewUnit, Version } from "./versions";

export type Decide = {
  choose: (candidate: string) => void;
  clear: () => void;
  reject: (candidate: string) => void;
  unreject: (candidate: string) => void;
  comment: (text: string) => Promise<boolean>;
};

/**
 * The decision for the focused version: one primary action, Reject, an always-open note box with quick chips,
 * and the unit's notes. Everything technical sits behind Details.
 */
export function DecisionPanel({ unit, slot, version, decision, comments, labelFor, busy, decide, noteRef, all, now, forgePick, referenceOnly = false, reference = null }: {
  unit: ReviewUnit;
  slot: SlotId;
  version: Version;
  decision: SlotDecision;
  comments: ReviewComment[];
  labelFor: (candidate: string | null) => string;
  busy: boolean;
  decide: Decide;
  noteRef: RefObject<HTMLTextAreaElement | null>;
  all: Candidate[];
  now: number;
  forgePick: string | null;
  /** Original RA2 units and the Reference version: compare and take notes, never decide. */
  referenceOnly?: boolean;
  reference?: ReviewUnit | null;
}) {
  const [draft, setDraft] = useState("");
  const [details, setDetails] = useState(false);
  const closeDetails = useCallback(() => setDetails(false), []);
  const c = version.candidate;
  const chosen = decision.chosen === version.key;
  const rejected = Boolean(c && decision.rejected.includes(c.id));
  const concept = slot === "concept";
  const save = async () => {
    if (!draft.trim() || busy) return;
    if (await decide.comment(draft)) setDraft("");
  };

  let primary: React.ReactNode = null;
  if (referenceOnly) {
    primary = <div className="lab-refonly"><span className="lab-pill">Reference only</span><small>Original game art</small></div>;
  } else if (chosen) {
    primary = (
      <div className="lab-chosen">
        <span><Check size={18} strokeWidth={3} /> {concept ? "Reference" : c ? "In game" : "Keeping current"}</span>
        <button type="button" onClick={decide.clear} disabled={busy}><Undo2 size={14} /> Undo</button>
      </div>
    );
  } else if (c) {
    primary = (
      <button type="button" className="lab-primary" onClick={() => decide.choose(c.id)} disabled={busy}>
        {concept ? "Use as reference" : "Use this in game"} <kbd>U</kbd>
      </button>
    );
  } else if (!concept) {
    primary = <button type="button" className="lab-primary is-keep" onClick={() => decide.choose("current")} disabled={busy}>Keep current <kbd>N</kbd></button>;
  }

  return (
    <aside className="lab-panel" aria-label="Decision">
      <header className="lab-panel-head">
        <h1>{unit.name}</h1>
        <p>{unit.factionName} · {unit.role}<span className={`lab-origin-pill is-${unit.origin ?? "new"}`}>{unit.origin === "original" ? "Original" : unit.origin === "modified" ? "Modified" : "New"}</span></p>
      </header>

      <div className="lab-focus-row">
        <b>{version.label}</b>
        <span className="lab-mono">{version.tag}</span>
        {chosen && <span className="lab-pill is-good">{concept ? "Reference" : "Chosen"}</span>}
        {rejected && <span className="lab-pill is-bad">Rejected</span>}
        {forgePick && forgePick === version.key && !chosen && <span className="lab-pill">Forge pick</span>}
        <button type="button" className="lab-ghost" aria-expanded={details} onClick={() => setDetails(true)}><Info size={14} /> Details</button>
        {version.reference && <span className="lab-ref-name">{version.reference.name}</span>}
      </div>

      <div className="lab-actions">
        {primary}
        {c && !referenceOnly ? (rejected
          ? <button type="button" className="lab-secondary" onClick={() => decide.unreject(c.id)} disabled={busy}><Undo2 size={14} /> Undo reject</button>
          : <button type="button" className="lab-secondary is-reject" onClick={() => decide.reject(c.id)} disabled={busy}><X size={14} /> Reject <kbd>R</kbd></button>)
          : <span className="lab-secondary is-placeholder" aria-hidden="true" />}
        {concept && <p className="lab-foot">Concept art never ships.</p>}
      </div>

      <form className="lab-note" onSubmit={e => { e.preventDefault(); void save(); }}>
        <label htmlFor="lab-note" className="lab-label">Note for the Forge <kbd>C</kbd></label>
        <textarea id="lab-note" ref={noteRef} rows={3} maxLength={4000} value={draft}
          placeholder={referenceOnly ? `Note on ${version.reference?.name ?? unit.name}` : `What should change in ${version.label}?`}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void save(); }
            if (e.key === "Escape") { e.preventDefault(); e.currentTarget.blur(); }
          }} />
        <div className="lab-chips" role="group" aria-label="Quick notes">
          {quickChips.map(chip => (
            <button key={chip} type="button" className="lab-chip-btn" aria-pressed={draft.toLowerCase().includes(chip.toLowerCase())}
              onClick={() => { setDraft(d => appendChip(d, chip)); noteRef.current?.focus(); }}>{chip}</button>
          ))}
        </div>
        <div className="lab-note-foot">
          <span className="lab-hint">Enter saves · Shift+Enter new line</span>
          <button type="submit" className="lab-ghost" disabled={busy || !draft.trim()}>Save</button>
        </div>
      </form>

      <section className="lab-history" aria-label="Notes for this unit">
        <h2 className="lab-label">Notes</h2>
        {comments.length ? (
          <ol>
            {comments.map((n, i) => (
              <li key={`${n.at}-${i}`}>
                <div><span className="lab-mini-tag">{n.candidate ? labelFor(n.candidate) : n.slot === slot || !n.slot ? "Current" : "Unit"}</span><time dateTime={n.at}>{relativeTime(n.at, now)}</time></div>
                <p>{n.text}</p>
              </li>
            ))}
          </ol>
        ) : <p className="lab-hint">No notes yet.</p>}
      </section>

      <p className="lab-foot">Nothing ships until export.</p>

      {details && <Details unit={version.reference ?? unit} version={version} all={all} onClose={closeDetails} reference={reference} />}
    </aside>
  );
}

function generatorPreviews(c: Candidate) {
  const engineChain = /ingame_view|engine-chain/i.test(c.previewNote ?? "");
  if (c.kind === "voxel" && !engineChain) return "Forge previews (half size, not true scale)";
  return engineChain ? "Forge previews (engine-chain renders)" : "Forge previews";
}

/** Everything technical about the focused version: provenance, score, cost, rules, previews, prompt. */
function Details({ unit, version, all, onClose, reference }: { unit: ReviewUnit; version: Version; all: Candidate[]; onClose: () => void; reference: ReviewUnit | null }) {
  const c = version.candidate;
  const unitPage = `/art/${unit.factionId}/${unit.id}`;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <section className="lab-details" aria-label={`${version.label} details`}>
      <header>
        <b>{version.label}</b>
        <span className="lab-mono">{c ? c.id : unit.id}</span>
        <button ref={closeRef} type="button" className="lab-icon-btn" onClick={onClose} aria-label="Close details"><X size={16} /></button>
      </header>
      {c ? <CandidateDetails c={c} all={all} /> : unit.origin === "original" ? (
        <>
          <dl className="lab-dl">
            <dt>Art</dt><dd>Untouched Westwood RA2 {unit.spec.voxel ? "voxel model" : "sprite"}, read from your local RA2 data.</dd>
            <dt>Unit</dt><dd>{unit.name} <span className="lab-mono">{unit.id}</span></dd>
            {version.kind === "reference" && <><dt>Why this one</dt><dd>{version.referenceWhy ?? "Same domain"}.</dd></>}
            <dt>Files</dt><dd className="lab-mono lab-files">{(unit.files ?? []).join(" ")}</dd>
            {!!unit.fromModBits?.length && <><dt>Mod override</dt><dd className="lab-mono">{unit.fromModBits.join(" ")}</dd></>}
          </dl>
          <p className="lab-hint">EA copyright. Extracted with the mod&apos;s engine into a local cache, served only by the dev server, never published.</p>
        </>
      ) : (
        <dl className="lab-dl">
          <dt>What ships now</dt><dd>{unit.spec.voxel ? "Voxel model" : unit.spec.sprite ? "Pre-rendered sprite" : "Cameo"} from the mod.</dd>
          <dt>Unit</dt><dd>{unit.name} <span className="lab-mono">{unit.id}</span></dd>
          {unit.catalog && <><dt>Catalog</dt><dd>{unit.catalog.name} · {unit.catalog.role}</dd></>}
          {reference && <><dt>Reference</dt><dd>{reference.name} <span className="lab-mono">{reference.id}</span> (original RA2)</dd></>}
        </dl>
      )}
      <Link className="lab-ghost lab-details-link" href={unitPage} target="_blank"><ExternalLink size={14} /> Unit page</Link>
    </section>
  );
}

function CandidateDetails({ c, all }: { c: Candidate; all: Candidate[] }) {
  const s = c.scores ?? {};
  const total = typeof s.total === "number" ? s.total : null;
  const parts = Object.entries(s).filter(([k, v]) => typeof v === "number" && k !== "total" && k !== "bar");
  const cost = candidateCost(c, all);
  const offset = declaredTurretOffset(c);
  const rules = c.rulesText ? parseCandidateRules(c.rulesText, c.actor) : null;
  const rulesUrl = c.files.rules ? c.urls[c.files.rules] : null;
  const concept = c.fromConcept ? all.find(x => x.id === c.fromConcept) : undefined;
  const conceptImage = concept?.files.concept ? concept.urls[concept.files.concept] : null;
  const source = c.kind !== "concept" && c.files.concept ? c.urls[c.files.concept] : null;
  const previews = (c.files.previews ?? []).filter(p => c.urls[p]);
  return (
    <>
      <section>
        <h3 className="lab-label">Made from</h3>
        <p className="lab-chain">{provenanceChain(c).map((step, i) => <span key={i}>{i > 0 && <i aria-hidden="true">→</i>}<b>{step}</b></span>)}</p>
        {(conceptImage || source) && (
          <div className="lab-madefrom">
            {conceptImage && <a href={conceptImage} target="_blank" rel="noreferrer"><img src={conceptImage} alt={`Concept ${concept!.id}`} loading="lazy" /><small>{concept!.id}</small></a>}
            {source && <a href={source} target="_blank" rel="noreferrer"><img src={source} alt={c.kind === "voxel" ? "3D source" : "Master"} loading="lazy" /><small>{c.kind === "voxel" ? "3D source" : "Master"}</small></a>}
          </div>
        )}
      </section>
      <section>
        <h3 className="lab-label">Forge score</h3>
        {total !== null ? <p className="lab-score"><b>{total}</b> / bar {String(s.bar ?? "—")}{s.passes === false ? " · below the bar" : ""}</p> : <p className="lab-hint">Not scored.</p>}
        {parts.length > 0 && <div className="lab-scoreparts">{parts.map(([k, v]) => <span key={k}><small>{k}</small><b>{String(v)}</b></span>)}</div>}
        {c.critique && <p className="lab-prose">{c.critique}</p>}
        {Array.isArray(s.technicalNotes) && <ul className="lab-list">{(s.technicalNotes as string[]).map(n => <li key={n}>{n}</li>)}</ul>}
      </section>
      <section>
        <h3 className="lab-label">Cost</h3>
        <p><b>{formatCost(cost)}</b>{cost.parts.length ? <span className="lab-hint"> · {cost.parts.join(" + ")}</span> : null}</p>
        <p className="lab-hint">Created {c.createdAt ? new Date(c.createdAt).toLocaleString() : "—"}{c.fixture ? " · fixture" : ""}</p>
      </section>
      {(c.kind === "voxel" || c.kind === "sprite") && (
        <section>
          <h3 className="lab-label">Rules</h3>
          <ul className="lab-list">
            <li>Turret pivot: {offset ? <code>Turreted.Offset {offset.join(",")}</code> : "the current Turreted.Offset"}{c.voxelize?.turretPlacement ? ` (${c.voxelize.turretPlacement})` : ""}.</li>
            {c.kind === "sprite" && <li>Frame layout from <code>{rules && Object.keys(rules.sequences).length ? c.files.rules : "meta.sprite"}</code>.</li>}
            {(rules?.removed.length || rules?.traits.length) ? <li>Needs rules changes: {rules.removed.map(t => `-${t}`).concat(rules.traits).join(", ")}.</li> : null}
          </ul>
          {rulesUrl && <a className="lab-ghost" href={rulesUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {c.files.rules}</a>}
        </section>
      )}
      {previews.length > 0 && (
        <section>
          <h3 className="lab-label">{generatorPreviews(c)}</h3>
          <div className="lab-previews">
            {previews.map(p => <a key={p} href={c.urls[p]} target="_blank" rel="noreferrer" title={p}><img src={c.urls[p]} alt={p} loading="lazy" /></a>)}
          </div>
        </section>
      )}
      {(c.prompt || c.promptChars) && <PromptDetails candidate={c} />}
    </>
  );
}

/** The generation prompt, fetched when opened (the workspace state leaves long prompts out). */
function PromptDetails({ candidate }: { candidate: Candidate }) {
  const [text, setText] = useState<string | null>(candidate.prompt ?? null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    if (text !== null || failed) return;
    fetch(`/api/art-review/prompt?actor=${encodeURIComponent(candidate.actor)}&id=${encodeURIComponent(candidate.id)}`)
      .then(r => (r.ok ? r.json() as Promise<{ prompt: string | null }> : Promise.reject(new Error(String(r.status)))))
      .then(r => setText(r.prompt ?? ""))
      .catch(() => setFailed(true));
  };
  return (
    <details className="lab-prompt" onToggle={e => { if ((e.currentTarget as HTMLDetailsElement).open) load(); }}>
      <summary className="lab-label">Prompt</summary>
      <p className="lab-prose">{failed ? "The prompt could not be read." : text ?? "Loading…"}</p>
    </details>
  );
}
