"use client";
/**
 * A voice note: the microphone recorded as audio (MediaRecorder, Opus) while the browser's own speech recognition
 * writes the words. The audio is what is kept as the truth; the transcript is a convenience, and a session can
 * transcribe the audio again locally when the browser gave none (tools/review.mjs transcript).
 */
import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  continuous: boolean; interimResults: boolean; maxAlternatives: number; lang: string;
  start: () => void; stop: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
function recognitionConstructor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceTake = { blob: Blob; seconds: number; text: string };

const PROBLEMS: Record<string, string> = {
  NotAllowedError: "The microphone is blocked for this page. Allow it in the address bar, or type instead (T).",
  NotFoundError: "No microphone was found. Type instead (T).",
  NotReadableError: "Another app is holding the microphone. Close it, or type instead (T).",
};

export function useVoiceNote() {
  const [recording, setRecording] = useState(false);
  const [words, setWords] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState("");
  /** The element whose --level (0..1) follows the microphone, without re-rendering the page. */
  const meter = useRef<HTMLElement | null>(null);

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const parts = useRef<Blob[]>([]);
  const recognition = useRef<Recognition | null>(null);
  const recognitionEnded = useRef<Promise<void>>(Promise.resolve());
  const text = useRef({ final: "", interim: "" });
  const startedAt = useRef(0);
  const audio = useRef<{ context: AudioContext; frame: number } | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const release = useCallback(() => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    if (audio.current) { cancelAnimationFrame(audio.current.frame); void audio.current.context.close().catch(() => {}); audio.current = null; }
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
    const r = recognition.current;
    recognition.current = null;
    if (r) { r.onresult = null; r.onerror = null; try { r.stop(); } catch { /* already stopped */ } }
    setRecording(false);
  }, []);
  // Never leave the microphone open behind a page that moved on.
  useEffect(() => release, [release]);

  const start = useCallback(async () => {
    setProblem("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setProblem("This browser cannot record. Type instead (T)."); return false; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setProblem(PROBLEMS[(e as DOMException).name] ?? "The microphone could not start. Type instead (T).");
      return false;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream.current, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
    parts.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.current.push(e.data); };
    rec.start(1000);
    recorder.current = rec;
    startedAt.current = performance.now();
    text.current = { final: "", interim: "" };
    setWords("");
    setSeconds(0);
    tick.current = setInterval(() => setSeconds((performance.now() - startedAt.current) / 1000), 250);

    // The level meter: how loud the microphone hears you, so a dead microphone shows at once.
    try {
      const context = new AudioContext(), analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream.current).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const draw = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        meter.current?.style.setProperty("--level", Math.min(1, peak * 2.2).toFixed(3));
        if (audio.current) audio.current.frame = requestAnimationFrame(draw);
      };
      audio.current = { context, frame: requestAnimationFrame(draw) };
    } catch { /* the meter is a nicety */ }

    // The words, live. Without the browser's speech service the note is still saved as audio.
    const Ctor = recognitionConstructor();
    if (Ctor) {
      const r = new Ctor();
      r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
      r.lang = navigator.language?.startsWith("en") ? navigator.language : "en-US";
      r.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i], said = result?.[0]?.transcript ?? "";
          if (result?.isFinal) text.current.final = `${text.current.final} ${said}`.trim(); else interim += said;
        }
        text.current.interim = interim.trim();
        setWords(`${text.current.final} ${text.current.interim}`.trim());
      };
      let ended: () => void = () => {};
      recognitionEnded.current = new Promise<void>((resolve) => { ended = resolve; });
      r.onerror = () => ended();
      r.onend = () => {
        // Chrome ends a session after a quiet stretch: keep listening while the note is still being recorded.
        if (recognition.current === r && recorder.current?.state === "recording") { try { r.start(); return; } catch { /* fall through */ } }
        ended();
      };
      try { r.start(); recognition.current = r; } catch { ended(); }
    } else recognitionEnded.current = Promise.resolve();

    setRecording(true);
    return true;
  }, []);

  /** Ends the note and hands back its audio and words (null when nothing was recorded). */
  const stop = useCallback(async (): Promise<VoiceTake | null> => {
    const rec = recorder.current;
    if (!rec) return null;
    const seconds = (performance.now() - startedAt.current) / 1000;
    const stopped = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
    recorder.current = null; // tells the recogniser's onend not to restart
    const r = recognition.current;
    if (r) { try { r.stop(); } catch { /* already stopped */ } }
    if (rec.state !== "inactive") rec.stop(); else (rec.onstop as (() => void) | null)?.();
    // The recogniser delivers its last words just after stop: wait for them, but never hold the owner up.
    await Promise.all([stopped, Promise.race([recognitionEnded.current, new Promise<void>((resolve) => setTimeout(resolve, 1500))])]);
    const blob = new Blob(parts.current, { type: rec.mimeType || "audio/webm" });
    const said = `${text.current.final} ${text.current.interim}`.trim();
    release();
    return blob.size ? { blob, seconds, text: said } : null;
  }, [release]);

  const cancel = useCallback(() => { const rec = recorder.current; recorder.current = null; try { rec?.stop(); } catch { /* not started */ } release(); setWords(""); }, [release]);

  const meterRef = useCallback((el: HTMLElement | null) => { meter.current = el; }, []);
  return { recording, words, seconds, problem, meterRef, start, stop, cancel };
}
