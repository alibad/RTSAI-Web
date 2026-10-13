"use client";

import type { User } from "firebase/auth";
import {
  Camera,
  Check,
  CheckCircle2,
  Crosshair,
  ImagePlus,
  MessageSquareText,
  Mic,
  MonitorCog,
  Paperclip,
  Send,
  Settings2,
  ShieldCheck,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Toaster, toast } from "sonner";
import { feedbackCategories, type FeedbackCategory } from "../../lib/feedback";
import {
  getBrowserMetadata,
  getConsoleLogs,
  getNetworkLogs,
  initDiagnostics,
} from "../../lib/feedback/diagnostics";
import { getFirebaseFirestore } from "../../lib/firebase-client";
import { useFeedbackStore } from "../../lib/stores/feedback-store";
import { DropZone, FileChips, RecordingBar, ShotStrip, usePastedFiles, VoicePlayer } from "./feedback/FeedbackMedia";
import {
  ATTACH_ACCEPT,
  canCaptureTab,
  canRecordVoice,
  captureTab,
  checkAttachment,
  FEEDBACK_ROOT_ID,
  isCoarsePointer,
  MAX_FILES,
  MAX_SCREENSHOTS,
  toJpeg,
  useVoiceRecorder,
  withWidgetHidden,
} from "./feedback/media";
import { createFeedbackReport, FEEDBACK_REPORT_REUSE_MS, storeFeedbackFile, type FeedbackFileKind } from "./feedback/report-files";
import { ScreenshotAnnotator } from "./feedback/ScreenshotAnnotator";
import { DictationButton, useFeedbackDictation } from "./useFeedbackDictation";
import { OptionSelect, type Option } from "./ui/fields";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { kitPopupOpen } from "./ui/layers";

const consoleLevels: Option<"error" | "warn" | "all">[] = [{ value: "error", label: "Errors only" }, { value: "warn", label: "Warnings + errors" }, { value: "all", label: "All messages" }];
const consoleLimits: Option<number>[] = [10, 30, 50].map(n => ({ value: n, label: `Last ${n}` }));
const networkLimits: Option<number>[] = [10, 20, 50].map(n => ({ value: n, label: `Last ${n} requests` }));
const categoryOptions: Option<FeedbackCategory>[] = feedbackCategories.map(category => ({ value: category, label: category }));
// Screenshots (marked up or pasted) are re-encoded as JPEG; GIFs and other files go as they are.
const screenshotTypes = ["image/png", "image/jpeg", "image/webp"];

function describeElement(element: Element) {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : "";
  const classes = [...element.classList].slice(0, 4).map((name) => `.${name}`).join("");
  const label = element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent?.replace(/\s+/g, " ").trim();
  return `${tag}${id}${classes}${label ? ` — “${label.slice(0, 120)}”` : ""}`.slice(0, 500);
}

function selectableAt(x: number, y: number) {
  const element = document.elementFromPoint(x, y);
  if (!element || element === document.documentElement || element === document.body || element.closest(`#${FEEDBACK_ROOT_ID}`)) return null;
  return element;
}

function ElementSelector({ onSelect, onCancel }: { onSelect: (capture: { elementInfo: string; position: { x: number; y: number } }) => void; onCancel: () => void }) {
  const [target, setTarget] = useState<{ rect: DOMRect; label: string } | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const element = selectableAt(event.clientX, event.clientY);
      setTarget(element ? { rect: element.getBoundingClientRect(), label: describeElement(element) } : null);
    };
    const choose = (event: MouseEvent) => {
      const element = selectableAt(event.clientX, event.clientY);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      onSelect({ elementInfo: describeElement(element), position: { x: Math.round(event.clientX), y: Math.round(event.clientY) } });
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("click", choose, true);
    window.addEventListener("keydown", keydown, true);
    return () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("click", choose, true);
      window.removeEventListener("keydown", keydown, true);
    };
  }, [onCancel, onSelect]);

  return (
    <div className="feedback-selector" aria-live="polite">
      <div className="feedback-selector-instruction"><Crosshair size={15} /> Select an element <kbd>Esc</kbd> cancels</div>
      {target && <>
        <div className="feedback-selector-highlight" style={{ left: target.rect.left, top: target.rect.top, width: target.rect.width, height: target.rect.height }} />
        <div className="feedback-selector-tooltip" style={{ left: Math.max(8, Math.min(target.rect.left, window.innerWidth - 330)), top: Math.max(60, target.rect.top - 38) }}>{target.label}</div>
      </>}
    </div>
  );
}

function FeedbackSettings({ onClose }: { onClose: () => void }) {
  const store = useFeedbackStore();
  return (
    <>
      <div className="feedback-settings-head"><div><b>Diagnostic context</b><span>Choose exactly what accompanies your note.</span></div><button type="button" onClick={onClose} aria-label="Close diagnostic settings"><X size={16} /></button></div>
      <div className="feedback-settings-toggle"><span><label htmlFor="feedback-metadata">Browser metadata</label><small>Viewport, platform, language, and connection state</small></span><input id="feedback-metadata" type="checkbox" checked={store.includeMetadata} onChange={(event) => store.setSetting("includeMetadata", event.target.checked)} /></div>
      <div className="feedback-settings-toggle"><span><label htmlFor="feedback-console">Console messages</label><small>Recent messages only; disabled by default</small></span><input id="feedback-console" type="checkbox" checked={store.includeConsole} onChange={(event) => store.setSetting("includeConsole", event.target.checked)} /></div>
      {store.includeConsole && <div className="feedback-settings-row"><OptionSelect aria-label="Console level" value={store.consoleLevel} onValueChange={(value) => store.setSetting("consoleLevel", value)} options={consoleLevels} contentClassName="ui-paper" /><OptionSelect aria-label="Console message limit" value={store.consoleLimit} onValueChange={(value) => store.setSetting("consoleLimit", value)} options={consoleLimits} contentClassName="ui-paper" /></div>}
      <div className="feedback-settings-toggle"><span><label htmlFor="feedback-network">Network summary</label><small>Method, path, status, and timing—never bodies or headers</small></span><input id="feedback-network" type="checkbox" checked={store.includeNetwork} onChange={(event) => store.setSetting("includeNetwork", event.target.checked)} /></div>
      {store.includeNetwork && <div className="feedback-settings-row"><OptionSelect aria-label="Network request limit" value={store.networkLimit} onValueChange={(value) => store.setSetting("networkLimit", value)} options={networkLimits} contentClassName="ui-paper" /></div>}
      <p><ShieldCheck size={13} /> Screenshots, voice notes and files go only when you add them. No page HTML, input value, request body, header, or URL query is collected.</p>
    </>
  );
}

export function FeedbackPanel({ user, openAuth }: { user: User | null; openAuth: (reason?: string) => void }) {
  const store = useFeedbackStore();

  // Speaking instead of typing, per field. Fills the box; attaches nothing.
  const dictation = useFeedbackDictation({
    getText: (field) =>
      field === "title"
        ? useFeedbackStore.getState().title
        : useFeedbackStore.getState().description,
    setText: (field, value) =>
      field === "title"
        ? useFeedbackStore.getState().setTitle(value)
        : useFeedbackStore.getState().setDescription(value),
    onNotice: (message) => toast(message),
    limits: { title: 120, description: 4000 },
  });
  const voice = useVoiceRecorder(
    (note) => useFeedbackStore.getState().setVoiceNote(note),
    (message) => toast.error(message),
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ receipt: string; issueUrl?: string; notificationQueued: boolean } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [company, setCompany] = useState("");
  // The screenshot being marked up: a new capture (not yet in the draft) or an existing one.
  const [annotating, setAnnotating] = useState<{ src: string; captureId?: string; owned: boolean } | null>(null);
  const [capturing, setCapturing] = useState(false);
  // Media capability is a browser fact, read after mount so server and first client render agree.
  const [media, setMedia] = useState({ tab: false, voice: false, touch: false });
  const awaitingAuth = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => initDiagnostics(), []);
  useEffect(() => {
    const id = setTimeout(() => setMedia({ tab: canCaptureTab(), voice: canRecordVoice(), touch: isCoarsePointer() }), 0);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (!store.isOpen || annotating) return;
    // Escape closes an open picker or the settings first; only the next one closes the dialog.
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy && !settingsOpen && !kitPopupOpen()) store.close(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [store.isOpen, busy, settingsOpen, store, annotating]);
  // Focus the title when the dialog opens (not when the settings popover closes: focus returns to its button).
  useEffect(() => { if (store.isOpen) titleRef.current?.focus(); }, [store.isOpen]);
  useEffect(() => {
    if (!user || !awaitingAuth.current) return;
    awaitingAuth.current = false;
    store.open();
  }, [user, store]);
  // Closing the dialog ends a recording in progress (the take is kept).
  useEffect(() => { if (!store.isOpen && voice.recording) voice.stop(); }, [store.isOpen, voice]);
  usePastedFiles(store.isOpen && !annotating && !success, (files) => addFiles(files));

  // A page asked for the panel (e.g. "Give feedback on this unit"): same sign-in gate as the launcher.
  const launchRequest = store.launchRequest;
  const handledLaunch = useRef(launchRequest);
  useEffect(() => {
    if (launchRequest === handledLaunch.current) return;
    handledLaunch.current = launchRequest;
    launch();
  });

  function launch() {
    if (!user) {
      awaitingAuth.current = true;
      openAuth("Sign in to send private feedback");
      return;
    }
    setError("");
    setSuccess(null);
    store.open();
  }

  function beginSelection() {
    setSettingsOpen(false);
    store.setElementSelecting(true);
    toast("Click the part of the page you want to reference. Press Esc to cancel.");
  }

  function selected(capture: { elementInfo: string; position: { x: number; y: number } }) {
    store.addCapture(capture);
    store.setElementSelecting(false);
    toast.success("Page element attached");
  }

  const screenshotCount = store.captures.filter((capture) => capture.shot).length;

  async function takeScreenshot() {
    if (capturing || screenshotCount >= MAX_SCREENSHOTS) return;
    setSettingsOpen(false);
    setCapturing(true);
    try {
      const frame = await withWidgetHidden(captureTab);
      const png = await new Promise<Blob | null>((resolve) => frame.toBlob(resolve, "image/png"));
      if (!png) throw new Error("empty");
      setAnnotating({ src: URL.createObjectURL(png), owned: true });
    } catch {
      toast.error("Screenshot cancelled or not available in this browser");
    } finally {
      setCapturing(false);
    }
  }

  function finishMarkup(blob: Blob | null) {
    if (!annotating) return;
    if (blob) {
      if (annotating.captureId) store.replaceScreenshot(annotating.captureId, blob);
      else store.addScreenshot(blob);
    }
    if (annotating.owned) URL.revokeObjectURL(annotating.src);
    setAnnotating(null);
  }

  async function addFiles(files: File[]) {
    const state = useFeedbackStore.getState();
    let shots = state.captures.filter((capture) => capture.shot).length, others = state.files.length;
    let openMarkup = files.length === 1 && !media.touch;
    for (const file of files) {
      const check = checkAttachment(file);
      if (!check.ok) { toast.error(check.error); continue; }
      if (screenshotTypes.includes(check.contentType) && shots < MAX_SCREENSHOTS) {
        shots++;
        // One image on a desktop opens straight in the markup editor; several, or on a phone, attach directly.
        if (openMarkup) { setAnnotating({ src: URL.createObjectURL(file), owned: true }); openMarkup = false; continue; }
        try { state.addScreenshot((await toJpeg(await createImageBitmap(file))).blob); } catch { toast.error(`“${file.name}” could not be read.`); }
        continue;
      }
      if (others >= MAX_FILES) { toast.error(`Up to ${MAX_FILES} files per report.`); break; }
      others++;
      state.addFile({ blob: file, name: file.name, contentType: check.contentType });
    }
  }

  /**
   * Stores whatever this draft hasn't stored yet in Firestore (feedbackReports/<id>, readable only by the team) and
   * returns the report id plus the payload parts that name the files. A draft without files writes nothing there.
   */
  async function storeDraft(uid: string) {
    let state = useFeedbackStore.getState();
    const hasFiles = state.captures.some((capture) => capture.shot) || Boolean(state.voiceNote) || state.files.length > 0;
    // The rules take a report's files for 30 minutes; an older draft starts over with a new report.
    const stale = state.reportCreatedAt !== null && Date.now() - state.reportCreatedAt > FEEDBACK_REPORT_REUSE_MS;
    const reportId = !state.submissionId || stale ? state.startReport() : state.submissionId;
    if (hasFiles) {
      const db = await getFirebaseFirestore();
      if (!db) throw new Error("Files can't be sent right now. Remove them to send your note.");
      if (useFeedbackStore.getState().reportCreatedAt === null) {
        setProgress("Preparing…");
        try {
          await createFeedbackReport(db, { reportId, owner: uid, source: "web" });
          state.markReportCreated();
        } catch {
          state.startReport();
          throw new Error("Your files couldn't be sent. Check your connection and try again.");
        }
      }
      const store = (blob: Blob, name: string, contentType: string, kind: FeedbackFileKind, durationSeconds?: number) =>
        storeFeedbackFile(db, { reportId, blob, name, contentType, kind, durationSeconds });
      state = useFeedbackStore.getState();
      const pending = [
        ...state.captures.filter((capture) => capture.shot && !capture.shot.uploaded).map((capture, index) => ({ label: "screenshot", run: async () => state.markUploaded({ capture: capture.id }, await store(capture.shot!.blob, `screenshot-${index + 1}.jpg`, "image/jpeg", "screenshot")) })),
        ...(state.voiceNote && !state.voiceNote.uploaded ? [{ label: "voice note", run: async () => { const note = useFeedbackStore.getState().voiceNote!; state.markUploaded("voice", await store(note.blob, `voice-note.${note.contentType === "audio/mp4" ? "m4a" : note.contentType === "audio/ogg" ? "ogg" : "webm"}`, note.contentType, "voice", note.seconds)); } }] : []),
        ...state.files.filter((file) => !file.uploaded).map((file) => ({ label: `“${file.name}”`, run: async () => state.markUploaded({ file: file.id }, await store(file.blob, file.name, file.contentType, "file")) })),
      ];
      for (const [index, item] of pending.entries()) {
        setProgress(`Sending file ${index + 1} of ${pending.length}…`);
        try {
          await item.run();
        } catch {
          throw new Error(`Couldn't send the ${item.label}. Check your connection and try again, or remove it.`);
        }
      }
    }
    const done = useFeedbackStore.getState();
    return {
      reportId,
      captures: done.captures.map((capture) => ({ id: capture.id, elementInfo: capture.elementInfo, position: capture.position, screenshot: capture.shot?.uploaded })),
      attachments: [
        ...(done.voiceNote?.uploaded ? [{ ...done.voiceNote.uploaded, kind: "voice" }] : []),
        ...done.files.flatMap((file) => file.uploaded ? [{ ...file.uploaded, kind: "file" }] : []),
      ],
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user || busy || voice.recording || store.description.trim().length < 10) return;
    setBusy(true);
    setError("");
    try {
      const consoleLogs = getConsoleLogs();
      const filteredConsole = store.consoleLevel === "all"
        ? consoleLogs
        : consoleLogs.filter((entry) => store.consoleLevel === "error" ? entry.level === "error" : entry.level === "warn" || entry.level === "error");
      const token = await user.getIdToken();
      const { reportId, ...files } = await storeDraft(user.uid);
      setProgress("Saving…");
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: store.title,
          description: store.description,
          category: store.category,
          rating: store.rating,
          pagePath: window.location.pathname,
          source: "web",
          ...files,
          diagnostics: {
            ...(store.includeMetadata ? { metadata: getBrowserMetadata() } : {}),
            ...(store.includeConsole ? { console: filteredConsole.slice(-store.consoleLimit) } : {}),
            ...(store.includeNetwork ? { network: getNetworkLogs().slice(-store.networkLimit) } : {}),
          },
          clientSubmissionId: reportId,
          company,
        }),
      });
      const payload = await response.json() as { success?: boolean; receipt?: string; issueUrl?: string; notificationQueued?: boolean; error?: string };
      if (!response.ok || !payload.success || !payload.receipt) throw new Error(payload.error || "Could not save feedback");
      setSuccess({ receipt: payload.receipt, issueUrl: payload.issueUrl, notificationQueued: Boolean(payload.notificationQueued) });
      toast.success("Feedback saved privately");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save feedback. Your message is still here—please try again.";
      setError(message);
      toast.error("Feedback could not be saved");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  function close() {
    if (busy) return;
    setSettingsOpen(false);
    setError("");
    if (success) {
      setSuccess(null);
      store.reset();
    } else store.close();
  }

  const shots = store.captures.flatMap((capture) => capture.shot ? [{ id: capture.id, url: capture.shot.previewUrl }] : []);
  const elements = store.captures.filter((capture) => capture.elementInfo);
  const files = store.files.map((file) => ({ id: file.id, name: file.name, size: file.blob.size, contentType: file.contentType, previewUrl: file.previewUrl }));
  const markUp = media.touch ? undefined : (id: string) => {
    const capture = store.captures.find((item) => item.id === id);
    if (capture?.shot) setAnnotating({ src: capture.shot.previewUrl, captureId: id, owned: false });
  };

  return (
    <div id={FEEDBACK_ROOT_ID}>
      <Toaster position="bottom-right" richColors closeButton />
      {!store.hideTrigger && <button type="button" className="feedback-launcher" onClick={launch} aria-haspopup="dialog"><MessageSquareText size={17} /> <span>Feedback</span></button>}
      {store.isElementSelecting && <ElementSelector onSelect={selected} onCancel={() => store.setElementSelecting(false)} />}
      {store.isOpen && !annotating && (
        <div className="feedback-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
            <div className="feedback-dialog-actions">
              {!success && <Popover open={settingsOpen} onOpenChange={setSettingsOpen} modal={false}>
                <PopoverTrigger aria-label="Feedback diagnostic settings"><Settings2 size={18} /></PopoverTrigger>
                <PopoverContent align="end" sideOffset={8} aria-label="Diagnostic sharing settings" className="feedback-settings feedback-settings-popup ui-paper"><FeedbackSettings onClose={() => setSettingsOpen(false)} /></PopoverContent>
              </Popover>}
              <button type="button" onClick={close} aria-label="Close feedback"><X size={18} /></button>
            </div>
            {success ? (
              <div className="feedback-success" role="status">
                <span><CheckCircle2 size={28} /></span>
                <p className="eyebrow">Saved privately</p>
                <h2 id="feedback-title">Your feedback was saved privately.</h2>
                <p>Receipt <strong>{success.receipt}</strong>. {success.notificationQueued ? "A Firebase mail alert was queued." : "The private issue is saved; no mail alert was confirmed."}</p>
                <div>{success.issueUrl && <a href={success.issueUrl} target="_blank" rel="noreferrer">Open private issue</a>}<button type="button" onClick={close}>Done</button></div>
              </div>
            ) : (
              <form onSubmit={submit}>
                <div className="feedback-heading">
                  <p className="eyebrow">Private feedback</p>
                  <h2 id="feedback-title">Show us what could be better.</h2>
                  <p>Type or speak it. Add a marked-up screenshot, a voice note or files when they help.</p>
                </div>
                <div className="feedback-form-grid">
                  <label className="feedback-field"><span>Category</span><OptionSelect value={store.category} onValueChange={store.setCategory} options={categoryOptions} contentClassName="ui-paper" /></label>
                  <label className="feedback-field"><span>Short title <small>optional</small></span><span style={{ position: "relative", display: "block" }}><input ref={titleRef} value={store.title} onChange={(event) => store.setTitle(event.target.value)} maxLength={120} placeholder="Optional — we'll take one from your note" style={dictation.supported ? { paddingRight: 44 } : undefined} />{dictation.supported ? <DictationButton field="title" listening={dictation.listening} onToggle={dictation.toggle} /> : null}</span></label>
                </div>
                <label className="feedback-field"><span>What happened—or what should we build?</span><span style={{ position: "relative", display: "block" }}><textarea value={store.description} onChange={(event) => store.setDescription(event.target.value)} minLength={10} maxLength={4000} placeholder="Include what you expected, what you saw, and why it matters." required style={dictation.supported ? { paddingRight: 44 } : undefined} />{dictation.supported ? <DictationButton field="description" listening={dictation.listening} onToggle={dictation.toggle} /> : null}</span><small>{store.description.length} / 4,000</small></label>
                <div className="feedback-context-bar">
                  <div className="feedback-context-actions">
                    {media.tab && <button type="button" onClick={() => void takeScreenshot()} disabled={capturing || screenshotCount >= MAX_SCREENSHOTS}><Camera size={16} /> Screenshot</button>}
                    {media.touch && <button type="button" onClick={() => photoInput.current?.click()} disabled={screenshotCount >= MAX_SCREENSHOTS}><ImagePlus size={16} /> Add screenshot or photo</button>}
                    {media.voice && <button type="button" onClick={() => void voice.start()} disabled={voice.recording || Boolean(store.voiceNote)}><Mic size={16} /> Voice note</button>}
                    {media.touch && <button type="button" onClick={() => fileInput.current?.click()}><Paperclip size={16} /> Attach file</button>}
                    <button type="button" className="is-quiet" onClick={beginSelection}><Crosshair size={16} /> Select page element</button>
                  </div>
                  <span><MonitorCog size={14} /> Page path + {store.includeMetadata ? "browser metadata" : "no browser metadata"}</span>
                </div>
                {voice.recording && <RecordingBar remaining={voice.remaining} onStop={voice.stop} />}
                {(shots.length > 0 || store.voiceNote || files.length > 0) && (
                  <div className="feedback-media">
                    <ShotStrip shots={shots} onMarkUp={markUp} onRemove={store.removeCapture} />
                    {store.voiceNote && <VoicePlayer url={store.voiceNote.previewUrl} seconds={store.voiceNote.seconds} onRemove={() => store.setVoiceNote(null)} />}
                    <FileChips files={files} onRemove={store.removeFile} />
                  </div>
                )}
                {!media.touch && <DropZone onFiles={(list) => void addFiles(list)} />}
                <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(event) => { const list = [...(event.target.files ?? [])]; event.target.value = ""; void addFiles(list); }} />
                <input ref={fileInput} type="file" accept={ATTACH_ACCEPT} multiple hidden onChange={(event) => { const list = [...(event.target.files ?? [])]; event.target.value = ""; void addFiles(list); }} />
                {elements.length > 0 && <div className="feedback-captures" aria-label="Selected page elements">{elements.map((capture, index) => <div key={capture.id}><span><Check size={14} /><b>Element {index + 1}</b><small>{capture.elementInfo}</small></span><button type="button" onClick={() => store.removeCapture(capture.id)} aria-label={`Remove element ${index + 1}`}><Trash2 size={15} /></button></div>)}</div>}
                <fieldset className="feedback-rating"><legend>How useful is RTS AI so far? <small>Optional</small></legend><div>{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" className={store.rating === value ? "is-active" : ""} aria-pressed={store.rating === value} onClick={() => store.setRating(store.rating === value ? null : value)}><Star size={13} fill={store.rating === value ? "currentColor" : "none"} /><b>{value}</b></button>)}</div></fieldset>
                <label className="feedback-honeypot" aria-hidden="true">Company<input tabIndex={-1} autoComplete="off" value={company} onChange={(event) => setCompany(event.target.value)} /></label>
                {error && <p className="feedback-error" role="alert">{error}</p>}
                <div className="feedback-footer"><p><ShieldCheck size={14} /> Signed in as {user?.email || user?.displayName || "a verified user"}. Written feedback and diagnostics are never sent to Google Analytics.</p><button type="submit" disabled={busy || voice.recording || store.description.trim().length < 10}>{busy ? (progress || "Saving…") : <><Send size={15} /> Save privately</>}</button></div>
              </form>
            )}
          </section>
        </div>
      )}
      {annotating && <ScreenshotAnnotator src={annotating.src} onSave={({ blob }) => finishMarkup(blob)} onCancel={() => finishMarkup(null)} />}
    </div>
  );
}
