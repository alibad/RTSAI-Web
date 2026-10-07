/**
 * Voice lines and their native-speaker review.
 *
 * The machine-assisted sheet (RTSAI-Mod docs/voice-review.csv: intended text, English line, speech-recognition
 * transcript, literal meaning, verdict) and the per-file records (modern-factions/audio/PROVENANCE.json: engine,
 * licence, speaker) describe each shipped clip. A native speaker's verdicts are kept apart, in a local file in the
 * art workspace (RTSAI-Art/voice-review.json), never in the mod; an export fills the sheet's native_speaker column.
 */

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF, an optional BOM) into rows of strings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function toCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export type VoiceLine = {
  file: string; faction: string; language: string; engine: string; role: string;
  intended: string; english: string; transcript: string; cer: number | null; meaning: string;
  verdict: string; action: string; notes: string; nativeSpeaker: string;
};

/** The sheet's rows by column name. */
export function parseVoiceSheet(text: string): VoiceLine[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const at = (name: string) => head.indexOf(name);
  const get = (r: string[], name: string) => (at(name) >= 0 ? r[at(name)] ?? "" : "");
  return rows.filter(r => get(r, "file")).map(r => ({
    file: get(r, "file"), faction: get(r, "faction"), language: get(r, "language"), engine: get(r, "engine"), role: get(r, "role"),
    intended: get(r, "intended_text"), english: get(r, "english_line"), transcript: get(r, "asr_transcript"),
    cer: get(r, "cer") ? Number(get(r, "cer")) : null, meaning: get(r, "literal_meaning"),
    verdict: get(r, "verdict"), action: get(r, "action"), notes: get(r, "notes"), nativeSpeaker: get(r, "native_speaker"),
  }));
}

export type NativeVerdict = { verdict: "ok" | "wrong"; note: string; reviewer: string | null; at: string };
export type NativeReviewFile = { schemaVersion: 1; note: string; reviews: Record<string, NativeVerdict> };
export const emptyNativeReview = (): NativeReviewFile => ({
  schemaVersion: 1,
  note: "Native-speaker verdicts on the modern factions' voice lines, recorded in the Faction Studio. Export fills docs/voice-review.csv's native_speaker column.",
  reviews: {},
});

/** Applies one verdict (or clears it with verdict null). Returns a new file. */
export function applyNativeVerdict(file: NativeReviewFile, clip: string, verdict: "ok" | "wrong" | null, note: string, reviewer: string | null, at: string): NativeReviewFile {
  const reviews = { ...file.reviews };
  if (!/^[\w./-]+\.wav$/i.test(clip) || clip.includes("..")) throw new Error("Bad clip name");
  if (verdict === null) delete reviews[clip];
  else {
    if (verdict === "wrong" && !note.trim()) throw new Error("Say what is wrong");
    reviews[clip] = { verdict, note: note.trim().slice(0, 2000), reviewer: reviewer?.trim().slice(0, 80) || null, at };
  }
  return { ...file, reviews };
}

/** The sheet with native_speaker filled from the local verdicts ("OK" or "Wrong: <note>", reviewer and date). */
export function exportVoiceSheet(text: string, review: NativeReviewFile): string {
  const [head, ...rows] = parseCsv(text);
  if (!head) return text;
  let col = head.indexOf("native_speaker");
  if (col < 0) { head.push("native_speaker"); col = head.length - 1; }
  const file = head.indexOf("file");
  for (const r of rows) {
    const v = review.reviews[r[file]];
    while (r.length < head.length) r.push("");
    if (v) r[col] = `${v.verdict === "ok" ? "OK" : `Wrong: ${v.note}`}${v.reviewer ? ` (${v.reviewer} ` : " ("}${v.at.slice(0, 10)})`;
  }
  return toCsv([head, ...rows]);
}

/** Per-clip records from PROVENANCE.json (voice lines, announcers, effects), keyed by path under audio/. */
export type ClipRecord = { file: string; language: string | null; text: string | null; translation: string | null; role: string | null; engine: string | null; model: string | null; license: string | null; speaker: string | null; source: string | null; generatedAt: string | null; transcript: string | null };
export function clipRecords(provenance: unknown): Map<string, ClipRecord> {
  const out = new Map<string, ClipRecord>();
  const p = (provenance && typeof provenance === "object" ? provenance : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  // A { files: { name: record } } record (mods/rtsai/audio/sfx/PROVENANCE.json): the project's own effects.
  if (p.files && typeof p.files === "object" && !Array.isArray(p.files)) {
    for (const [file, raw] of Object.entries(p.files as Record<string, Record<string, unknown>>)) {
      out.set(file, { file, language: null, text: null, translation: null, role: str(raw.role), engine: str(raw.method), model: null, license: str(raw.license), speaker: null, source: str(raw.generator), generatedAt: str(raw.generated), transcript: null });
    }
  }
  for (const key of ["voice_lines", "announcers", "sound_effects"]) {
    const list = Array.isArray(p[key]) ? p[key] as Record<string, unknown>[] : [];
    for (const r of list) {
      const file = str(r.filename);
      if (!file) continue;
      const voice = (r.voice && typeof r.voice === "object" ? r.voice : {}) as Record<string, unknown>;
      const qa = (r.qa && typeof r.qa === "object" ? r.qa : {}) as Record<string, unknown>;
      out.set(file, { file, language: str(r.language), text: str(r.text), translation: str(r.translation), role: str(r.role), engine: str(r.engine), model: str(r.model), license: str(r.license),
        speaker: str(voice.speaker), source: str(r.source) ?? str(r.generator), generatedAt: str(r.generated_at), transcript: str(qa.asr_transcript) });
    }
  }
  return out;
}
