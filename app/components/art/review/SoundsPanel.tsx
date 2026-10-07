"use client";
import { memo, useState } from "react";
import { AlertTriangle, Check, Pause, Play } from "lucide-react";
import type { SoundClip, SoundGroupPayload } from "../../../../lib/art-lab/sounds-server";
import { soundEngine } from "./sound";

export type ActorSoundsData = { actor: string; faction: string | null; voiceSet: string | null; groups: SoundGroupPayload[] };

const LANGUAGES: Record<string, string> = { zh: "Mandarin", fa: "Persian", tr: "Turkish", ar: "Arabic", "ar-LB": "Lebanese Arabic", "ar-SA": "Arabic (Saudi Arabia)", "ar-YE": "Arabic (Yemen)", he: "Hebrew", en: "English" };
export const languageName = (code: string | null | undefined) => (code ? LANGUAGES[code] ?? LANGUAGES[code.split("-")[0]] ?? code : null);

/** Lines, languages and the clips the machine check flagged, for the chain step's caption. */
export function soundSummary(data: ActorSoundsData | null) {
  if (!data) return null;
  const clips = data.groups.filter(g => g.played).flatMap(g => g.files);
  const lines = clips.filter(c => c.line?.text);
  const languages = [...new Set(lines.map(c => c.line?.language?.split("-")[0]).filter(Boolean))] as string[];
  const flagged = lines.filter(c => c.line?.verdict && !/^ok/i.test(c.line.verdict)).length;
  const missing = clips.filter(c => !c.present).length;
  return { clips: clips.length, lines: lines.length, languages, flagged, missing, originals: clips.filter(c => c.origin === "original").length };
}

/** One clip: play it, and what it says (text, English, what speech recognition heard, the check's verdict). */
export const ClipRow = memo(function ClipRow({ clip }: { clip: SoundClip }) {
  const [state, setState] = useState<"idle" | "playing" | "failed">("idle");
  const play = async () => {
    setState("playing");
    const seconds = await soundEngine.play(clip.url);
    if (seconds === null) { setState(soundEngine.prefs.muted ? "idle" : "failed"); return; }
    window.setTimeout(() => setState("idle"), seconds * 1000);
  };
  const line = clip.line;
  const name = clip.file.split("/").pop();
  const flagged = line?.verdict && !/^ok/i.test(line.verdict);
  return (
    <li className={`sound-clip${clip.origin === "original" ? " is-original" : ""}${clip.present ? "" : " is-missing"}`}>
      <button type="button" className="sound-play" onClick={play} disabled={!clip.present} aria-label={`Play ${name}`} title={soundEngine.prefs.muted ? "Sound is muted (Studio bar)" : `Play ${name}`}>
        {state === "playing" ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
      </button>
      <span className="sound-clip-body">
        {line?.text ? <>
          <b dir="auto">{line.text}</b>
          {line.english && line.english !== line.text && <small>{line.english}</small>}
          {line.transcript && line.transcript.replace(/[\s.,!?。，！？]/g, "") !== line.text.replace(/[\s.,!?。，！？]/g, "") && <small className="sound-heard" dir="auto">Heard: {line.transcript}</small>}
          {line.meaning && line.meaning !== line.english && <small>Literally: {line.meaning}</small>}
        </> : <b className="sound-file">{name}</b>}
        {state === "failed" && <small className="sound-error">Could not play this clip</small>}
      </span>
      <span className="sound-tags">
        {line?.language && <span className="sound-tag">{languageName(line.language)}</span>}
        {line?.verdict && <span className={`sound-tag ${flagged ? "is-flag" : "is-ok"}`} title={line.notes ?? undefined}>{flagged ? <AlertTriangle size={11} aria-hidden="true" /> : <Check size={11} aria-hidden="true" />}{line.verdict}</span>}
        {line?.nativeSpeaker && <span className="sound-tag is-ok">Native: {line.nativeSpeaker}</span>}
        <span className={`sound-tag ${clip.origin === "original" ? "is-original" : ""}`} title={clip.credit ? [clip.credit.engine, clip.credit.model, clip.credit.speaker && `voice ${clip.credit.speaker}`, clip.credit.source, clip.credit.generatedAt].filter(Boolean).join(" · ") : undefined}>
          {clip.origin === "original" ? "Original RA2 · local only" : clip.present ? `Project · ${clip.credit?.license ?? "licence in audio-provenance.md"}` : "Missing from the mod"}
        </span>
      </span>
    </li>
  );
});

/** The Sounds step: every sound the actor plays, grouped by when the game plays it. */
export function SoundsPanel({ data, name, error }: { data: ActorSoundsData | null; name: string; error: string | null }) {
  if (error) return <section className="sounds-panel"><p className="lab-hint">{error}</p></section>;
  if (!data) return <section className="sounds-panel"><p className="lab-hint">Reading {name}’s sounds from the game rules…</p></section>;
  const played = data.groups.filter(g => g.played), unused = data.groups.filter(g => !g.played);
  return (
    <section className="sounds-panel" aria-label={`${name} sounds`}>
      <header><b>Sounds</b><small>{data.voiceSet ? `Voice set ${data.voiceSet}` : "No voice set"} · from the game rules · Fire, Die and selecting the unit play them on the stage</small></header>
      {!played.length && <p className="lab-hint">The rules give {name} no sounds.</p>}
      <div className="sounds-groups">
        {played.map(g => (
          <section key={g.id} className={`sounds-group is-${g.kind}`}>
            <h4>{g.label}<small title={g.trait}>{g.trait}</small></h4>
            <ul>{g.files.map(f => <ClipRow key={f.file} clip={f} />)}</ul>
          </section>
        ))}
      </div>
      {unused.length > 0 && <details className="sounds-unused"><summary>In the voice set, never played by {name}’s rules · {unused.length}</summary>
        {unused.map(g => <section key={g.id} className="sounds-group"><h4>{g.label}<small>{g.trait}</small></h4><ul>{g.files.map(f => <ClipRow key={f.file} clip={f} />)}</ul></section>)}
      </details>}
    </section>
  );
}
