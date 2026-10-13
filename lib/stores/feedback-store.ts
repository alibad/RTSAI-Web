import { create } from "zustand";
import type { StoredFile } from "../../app/components/feedback/report-files";
import type { FeedbackCategory } from "../feedback";
export type ConsoleFilter = "error" | "warn" | "all";

type FeedbackSettings = {
  includeMetadata: boolean;
  includeConsole: boolean;
  consoleLevel: ConsoleFilter;
  consoleLimit: number;
  includeNetwork: boolean;
  networkLimit: number;
};

/** A file of this draft already stored in Firestore (kept so a retry never stores it twice). */
export type UploadedFile = StoredFile;

/** One selection: a page element, a screenshot (local JPEG until sent), or both. */
export type DraftCapture = {
  id: string;
  elementInfo?: string;
  position?: { x: number; y: number };
  shot?: { blob: Blob; previewUrl: string; uploaded?: UploadedFile };
};
export type DraftVoiceNote = { blob: Blob; contentType: string; seconds: number; previewUrl: string; uploaded?: UploadedFile };
export type DraftFile = { id: string; blob: Blob; name: string; contentType: string; previewUrl?: string; uploaded?: UploadedFile };

type FeedbackState = FeedbackSettings & {
  isOpen: boolean;
  isElementSelecting: boolean;
  hideTrigger: boolean;
  title: string;
  description: string;
  category: FeedbackCategory;
  rating: number | null;
  captures: DraftCapture[];
  voiceNote: DraftVoiceNote | null;
  files: DraftFile[];
  /** The report's id (feedbackReports/<id> in Firestore), fixed at the first send so retries reuse its files. */
  submissionId: string | null;
  /** When this browser created the report document; null until it has files to store. */
  reportCreatedAt: number | null;
  /** Increments when a page asks the panel to open (the panel still requires sign-in). */
  launchRequest: number;
  open: () => void;
  /** Pre-fills the title (and optionally the category), then asks the panel to open. */
  openWithPrefill: (prefill: { title: string; category?: FeedbackCategory }) => void;
  close: () => void;
  reset: () => void;
  setElementSelecting: (value: boolean) => void;
  setHideTrigger: (value: boolean) => void;
  setTitle: (value: string) => void;
  setDescription: (value: string) => void;
  setCategory: (value: FeedbackCategory) => void;
  setRating: (value: number | null) => void;
  addCapture: (capture: { elementInfo: string; position: { x: number; y: number } }) => void;
  addScreenshot: (blob: Blob) => void;
  replaceScreenshot: (id: string, blob: Blob) => void;
  removeCapture: (id: string) => void;
  setVoiceNote: (note: { blob: Blob; contentType: string; seconds: number } | null) => void;
  addFile: (file: { blob: Blob; name: string; contentType: string }) => void;
  removeFile: (id: string) => void;
  markUploaded: (target: { capture: string } | { file: string } | "voice", uploaded: UploadedFile) => void;
  /** A fresh report id: nothing of the draft counts as stored any more. */
  startReport: () => string;
  markReportCreated: () => void;
  setSetting: <Key extends keyof FeedbackSettings>(key: Key, value: FeedbackSettings[Key]) => void;
};

const settingsKey = "rtsai-feedback-settings";
const defaults: FeedbackSettings = {
  includeMetadata: true,
  includeConsole: false,
  consoleLevel: "error",
  consoleLimit: 30,
  includeNetwork: false,
  networkLimit: 20,
};

function loadSettings(): FeedbackSettings {
  if (typeof window === "undefined") return defaults;
  try {
    const parsed = JSON.parse(localStorage.getItem(settingsKey) || "{}") as Partial<FeedbackSettings>;
    return {
      includeMetadata: parsed.includeMetadata ?? defaults.includeMetadata,
      includeConsole: parsed.includeConsole ?? defaults.includeConsole,
      consoleLevel: ["error", "warn", "all"].includes(parsed.consoleLevel || "") ? parsed.consoleLevel as ConsoleFilter : defaults.consoleLevel,
      consoleLimit: Math.min(100, Math.max(5, Number(parsed.consoleLimit) || defaults.consoleLimit)),
      includeNetwork: parsed.includeNetwork ?? defaults.includeNetwork,
      networkLimit: Math.min(50, Math.max(5, Number(parsed.networkLimit) || defaults.networkLimit)),
    };
  } catch {
    return defaults;
  }
}

function persistSettings(settings: FeedbackSettings) {
  if (typeof window !== "undefined") localStorage.setItem(settingsKey, JSON.stringify(settings));
}

let localId = 0;
const nextId = (prefix: string) => `${prefix}_${++localId}_${Date.now()}`;
const revoke = (url?: string) => { if (url) URL.revokeObjectURL(url); };

/** Object URLs of the draft's previews, released when a draft item is removed or the draft is reset. */
function releaseDraft(state: Pick<FeedbackState, "captures" | "voiceNote" | "files">) {
  state.captures.forEach((capture) => revoke(capture.shot?.previewUrl));
  revoke(state.voiceNote?.previewUrl);
  state.files.forEach((file) => revoke(file.previewUrl));
}

export const useFeedbackStore = create<FeedbackState>((set, get) => ({
  ...loadSettings(),
  isOpen: false,
  isElementSelecting: false,
  hideTrigger: false,
  title: "",
  description: "",
  category: "General",
  rating: null,
  captures: [],
  voiceNote: null,
  files: [],
  submissionId: null,
  reportCreatedAt: null,
  launchRequest: 0,
  open: () => set({ isOpen: true }),
  openWithPrefill: ({ title, category }) => set((state) => ({
    title: title.slice(0, 120),
    ...(category ? { category } : {}),
    launchRequest: state.launchRequest + 1,
  })),
  // Closing keeps the draft (and its previews) for the next open; reset() clears and releases it.
  close: () => set({ isOpen: false, isElementSelecting: false }),
  reset: () => {
    releaseDraft(get());
    set({ isOpen: false, isElementSelecting: false, title: "", description: "", category: "General", rating: null, captures: [], voiceNote: null, files: [], submissionId: null, reportCreatedAt: null });
  },
  setElementSelecting: (value) => set({ isElementSelecting: value, isOpen: !value }),
  setHideTrigger: (value) => set({ hideTrigger: value }),
  setTitle: (value) => set({ title: value }),
  setDescription: (value) => set({ description: value }),
  setCategory: (value) => set({ category: value }),
  setRating: (value) => set({ rating: value }),
  addCapture: (capture) => set((state) => ({ captures: [...state.captures, { ...capture, id: nextId("cap") }].slice(-10) })),
  addScreenshot: (blob) => set((state) => ({ captures: [...state.captures, { id: nextId("shot"), shot: { blob, previewUrl: URL.createObjectURL(blob) } }].slice(-10) })),
  replaceScreenshot: (id, blob) => set((state) => ({
    captures: state.captures.map((capture) => {
      if (capture.id !== id || !capture.shot) return capture;
      revoke(capture.shot.previewUrl);
      return { ...capture, shot: { blob, previewUrl: URL.createObjectURL(blob) } };
    }),
  })),
  removeCapture: (id) => set((state) => {
    revoke(state.captures.find((capture) => capture.id === id)?.shot?.previewUrl);
    return { captures: state.captures.filter((capture) => capture.id !== id) };
  }),
  setVoiceNote: (note) => set((state) => {
    revoke(state.voiceNote?.previewUrl);
    return { voiceNote: note ? { ...note, previewUrl: URL.createObjectURL(note.blob) } : null };
  }),
  addFile: ({ blob, name, contentType }) => set((state) => ({
    files: [...state.files, { id: nextId("file"), blob, name, contentType, previewUrl: contentType.startsWith("image/") ? URL.createObjectURL(blob) : undefined }],
  })),
  removeFile: (id) => set((state) => {
    revoke(state.files.find((file) => file.id === id)?.previewUrl);
    return { files: state.files.filter((file) => file.id !== id) };
  }),
  markUploaded: (target, uploaded) => set((state) => {
    if (target === "voice") return state.voiceNote ? { voiceNote: { ...state.voiceNote, uploaded } } : {};
    if ("capture" in target) return { captures: state.captures.map((capture) => capture.id === target.capture && capture.shot ? { ...capture, shot: { ...capture.shot, uploaded } } : capture) };
    return { files: state.files.map((file) => file.id === target.file ? { ...file, uploaded } : file) };
  }),
  startReport: () => {
    const id = crypto.randomUUID();
    set((state) => ({
      submissionId: id,
      reportCreatedAt: null,
      captures: state.captures.map((capture) => (capture.shot ? { ...capture, shot: { ...capture.shot, uploaded: undefined } } : capture)),
      voiceNote: state.voiceNote ? { ...state.voiceNote, uploaded: undefined } : null,
      files: state.files.map((file) => ({ ...file, uploaded: undefined })),
    }));
    return id;
  },
  markReportCreated: () => set({ reportCreatedAt: Date.now() }),
  setSetting: (key, value) => {
    set({ [key]: value } as Pick<FeedbackState, typeof key>);
    const state = get();
    persistSettings({
      includeMetadata: state.includeMetadata,
      includeConsole: state.includeConsole,
      consoleLevel: state.consoleLevel,
      consoleLimit: state.consoleLimit,
      includeNetwork: state.includeNetwork,
      networkLimit: state.networkLimit,
    });
  },
}));
