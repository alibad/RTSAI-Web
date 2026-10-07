"use client";
import { useEffect, useMemo, useState } from "react";
import { Check, Download, Pause, Play, X } from "lucide-react";
import type { NativeVerdict, VoiceLine } from "../../../../lib/art-lab/voice-review";
import { soundEngine } from "./sound";
import { languageName } from "./SoundsPanel";

type ReviewLine = VoiceLine & { url: string; native: NativeVerdict | null };
const API = "/api/art-review";
const REVIEWER_KEY = "rtsai-voice-reviewer";

function Line({ line, reviewer, onSaved }: { line: ReviewLine; reviewer: string; onSaved: (file: string, v: NativeVerdict | null) => void }) {
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState(line.native?.note ?? "");
  const [wrong, setWrong] = useState(line.native?.verdict === "wrong");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const play = async () => { setPlaying(true); const s = await soundEngine.play(line.url); window.setTimeout(() => setPlaying(false), (s ?? 0) * 1000); };
  const save = async (verdict: "ok" | "wrong" | null) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`${API}/voice-review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clip: line.file, verdict, note: verdict === "wrong" ? note : "", reviewer }) });
      const body = await r.json() as { review?: NativeVerdict | null; error?: string };
      if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
      onSaved(line.file, body.review ?? null);
      if (verdict !== "wrong") setWrong(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Not saved"); } finally { setBusy(false); }
  };
  const machineFlag = line.verdict && !/^ok/i.test(line.verdict);
  return (
    <li className={`review-line${line.native ? ` is-${line.native.verdict}` : ""}`}>
      <button type="button" className="sound-play" onClick={play} aria-label={`Play ${line.file}`}>{playing ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}</button>
      <div className="review-text">
        <b dir="auto" lang={line.language}>{line.intended}</b>
        <small>Should mean: {line.english}</small>
        <small dir="auto">Heard (speech recognition): {line.transcript}{line.cer !== null ? ` · CER ${line.cer.toFixed(3)}` : ""}</small>
        {line.meaning && <small>Literally: {line.meaning}</small>}
        <small className={machineFlag ? "is-flag" : undefined}>Machine check: {line.verdict}{line.notes ? ` · ${line.notes}` : ""}</small>
        <code>{line.file} · {line.role}</code>
      </div>
      <div className="review-actions">
        <div role="group" aria-label={`Native-speaker verdict on ${line.file}`}>
          <button type="button" aria-pressed={line.native?.verdict === "ok"} disabled={busy} onClick={() => void save(line.native?.verdict === "ok" ? null : "ok")}><Check size={13} aria-hidden="true" />OK</button>
          <button type="button" aria-pressed={wrong} disabled={busy} onClick={() => setWrong(w => !w)}><X size={13} aria-hidden="true" />Wrong</button>
        </div>
        {wrong && <form onSubmit={e => { e.preventDefault(); void save("wrong"); }}>
          <input aria-label="What is wrong" placeholder="What is wrong? (wording, accent, pronunciation)" value={note} onChange={e => setNote(e.target.value)} maxLength={2000} />
          <button type="submit" disabled={busy || !note.trim()}>Save</button>
        </form>}
        {line.native && <small>{line.native.verdict === "ok" ? "OK" : `Wrong: ${line.native.note}`}{line.native.reviewer ? ` · ${line.native.reviewer}` : ""} · {line.native.at.slice(0, 10)}</small>}
        {error && <small className="sound-error">{error}</small>}
      </div>
    </li>
  );
}

/**
 * Native-speaker review of the non-English voice lines (docs/voice-review.csv): play each line, read what it should
 * say and what speech recognition heard, and mark it OK or Wrong with a note. Verdicts are written to the local
 * RTSAI-Art/voice-review.json (never the mod); Export fills the sheet's native_speaker column.
 */
export function VoiceReview() {
  const [lines, setLines] = useState<ReviewLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>("all");
  const [onlyOpen, setOnlyOpen] = useState(false);
  // Opened only by a click (never server-rendered), so the remembered name can be read on first render.
  const [reviewer, setReviewer] = useState(() => { try { return localStorage.getItem(REVIEWER_KEY) ?? ""; } catch { return ""; } });
  useEffect(() => {
    let live = true;
    fetch(`${API}/voice-review`, { cache: "no-store" }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { lines: ReviewLine[] }) => { if (live) setLines(d.lines); }, e => { if (live) setError(e instanceof Error ? e.message : "Unavailable"); });
    return () => { live = false; };
  }, []);
  const languages = useMemo(() => [...new Set((lines ?? []).map(l => l.language))].sort(), [lines]);
  const shown = (lines ?? []).filter(l => (language === "all" || l.language === language) && (!onlyOpen || !l.native));
  const done = (lines ?? []).filter(l => l.native).length;
  const saved = (file: string, v: NativeVerdict | null) => setLines(ls => ls?.map(l => (l.file === file ? { ...l, native: v } : l)) ?? null);
  if (error) return <p className="lab-hint">Could not read the voice sheet: {error}</p>;
  if (!lines) return <p className="lab-hint">Reading docs/voice-review.csv…</p>;
  return (
    <div className="voice-review">
      <div className="voice-review-bar">
        <div className="sounds-factions" role="group" aria-label="Language">
          <button type="button" aria-pressed={language === "all"} onClick={() => setLanguage("all")}>All · {lines.length}</button>
          {languages.map(l => <button key={l} type="button" aria-pressed={language === l} onClick={() => setLanguage(l)}>{languageName(l)} · {lines.filter(x => x.language === l).length}</button>)}
        </div>
        <label><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} /> Not yet reviewed</label>
        <label>Reviewer <input value={reviewer} placeholder="Your name" maxLength={80} onChange={e => { setReviewer(e.target.value); try { localStorage.setItem(REVIEWER_KEY, e.target.value); } catch { /* storage unavailable */ } }} /></label>
        <a className="lab-ghost" href={`${API}/voice-review/export`} download><Download size={14} aria-hidden="true" />Export sheet</a>
      </div>
      <p className="lab-hint">{done} of {lines.length} lines reviewed by a native speaker. Verdicts are saved to RTSAI-Art/voice-review.json on this machine; the export fills the sheet’s native_speaker column.</p>
      <ul className="review-lines">{shown.map(l => <Line key={l.file} line={l} reviewer={reviewer} onSaved={saved} />)}</ul>
    </div>
  );
}
