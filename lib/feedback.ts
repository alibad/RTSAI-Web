export const feedbackCategories = [
  "Bug",
  "Feature Request",
  "UI/UX",
  "Gameplay",
  "Mission Generator",
  "AI Companion",
  "General",
] as const;

export type FeedbackCategory = (typeof feedbackCategories)[number];

/** Where the report was written: the website, or the browser game at /play (same origin, same account). */
export const feedbackSources = ["web", "game"] as const;
export type FeedbackSource = (typeof feedbackSources)[number];

/**
 * A file the reporter's browser stored in Firestore before sending (feedbackReports/<clientSubmissionId>, see
 * app/components/feedback/report-files.ts and firestore.rules). The request only names it; the issue links the
 * team-only viewer at /feedback/<clientSubmissionId>.
 */
export type FeedbackFileRef = {
  id: string;
  name: string;
  contentType: string;
  size: number;
};

/** One selection: a page element, a screenshot of what the reporter saw, or both (the feedback skill's captures). */
export type FeedbackCapture = {
  id: string;
  elementInfo?: string;
  position?: { x: number; y: number };
  screenshot?: FeedbackFileRef;
};

export type FeedbackAttachment = FeedbackFileRef & {
  kind: "voice" | "file";
  durationSeconds?: number;
};

export type FeedbackContextEntry = { label: string; value: string };

export type FeedbackConsoleEntry = {
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: string;
};

export type FeedbackNetworkEntry = {
  method: string;
  url: string;
  status: number;
  durationMs: number;
  timestamp: string;
};

export type FeedbackBrowserMetadata = {
  viewport?: { width: number; height: number };
  screen?: { width: number; height: number };
  devicePixelRatio?: number;
  language?: string;
  platform?: string;
  cookiesEnabled?: boolean;
  onLine?: boolean;
  connection?: { effectiveType?: string; downlink?: number; rtt?: number };
};

export type FeedbackSubmission = {
  title: string;
  description: string;
  category: FeedbackCategory;
  rating: number | null;
  pagePath: string | null;
  source: FeedbackSource;
  /** Short labelled facts from the surface, e.g. the game's mode, match and tick. */
  context: FeedbackContextEntry[];
  captures: FeedbackCapture[];
  attachments: FeedbackAttachment[];
  diagnostics: {
    metadata?: FeedbackBrowserMetadata;
    console?: FeedbackConsoleEntry[];
    network?: FeedbackNetworkEntry[];
  };
  clientSubmissionId: string;
};

type ValidationResult =
  | { ok: true; value: FeedbackSubmission }
  | { ok: false; error: string };

// ---------------------------------------------------------------- files (also enforced by firestore.rules)

/** The feedback skill's limit for every file. */
export const feedbackFileMaxBytes = 10 * 1024 * 1024;

/**
 * Images, video, audio and plain text only, each with the file extensions it may carry: nothing a browser would run
 * or render as a page. The same list is in firestore.rules and app/components/feedback/media.ts.
 */
export const feedbackFileTypes: Readonly<Record<string, readonly string[]>> = {
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
  "video/webm": ["webm"],
  "video/mp4": ["mp4", "m4v"],
  "video/quicktime": ["mov"],
  "audio/webm": ["webm", "weba"],
  "audio/ogg": ["ogg", "oga", "opus"],
  "audio/mpeg": ["mp3"],
  "audio/mp4": ["m4a", "mp4"],
  "audio/x-m4a": ["m4a"],
  "audio/aac": ["aac"],
  "audio/wav": ["wav"],
  "audio/x-wav": ["wav"],
  "text/plain": ["txt", "log"],
  "text/markdown": ["md"],
  "text/csv": ["csv"],
  "application/json": ["json"],
};

const uuidPattern = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const fileIdPattern = /^[a-z0-9]{16}$/;

/** The team-only page that shows a report's files (app/feedback/[reportId]). */
export function feedbackViewerUrl(baseUrl: string, reportId: string) {
  return `${baseUrl.replace(/\/$/, "")}/feedback/${reportId}`;
}

/** Feedback requests come from rtsai.net (the site and the game at /play) or a local preview. */
export function isAllowedFeedbackOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const configured = process.env.FEEDBACK_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  const defaults = ["https://rtsai.net", "https://www.rtsai.net", "https://openra-ai.albertine.chatgpt.site"];
  return [...defaults, ...configured].includes(origin) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

// ---------------------------------------------------------------- validation

/**
 * A one-line summary taken from the report, for when the reporter left the
 * title blank. First sentence or first line, whichever ends sooner, cut on a
 * word boundary so the issue list never fills with half-words.
 */
function deriveTitle(description: string) {
  const firstLine = description.split(/\n/, 1)[0] ?? "";
  const sentence = firstLine.split(/(?<=[.!?])\s/, 1)[0] ?? firstLine;
  const summary = (sentence || firstLine).replace(/\s+/g, " ").trim();
  if (!summary) return "Feedback";
  if (summary.length <= 120) return summary;
  const cut = summary.slice(0, 120);
  const space = cut.lastIndexOf(" ");
  return `${(space > 60 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").trim().slice(0, maxLength + 1);
}

/** One line of plain text that cannot break the issue's markdown (links, code spans, headings). */
function cleanLine(value: unknown, maxLength: number) {
  return cleanText(value, maxLength).replace(/[\n`[\]<>|*_#]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function finiteNumber(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : null;
}

function validTimestamp(value: unknown) {
  const text = cleanText(value, 40);
  return Number.isNaN(Date.parse(text)) ? new Date(0).toISOString() : text;
}

/** A stored file's id, name, type and size; nothing else of it ever reaches the server. */
function validateFileRef(value: unknown): FeedbackFileRef | null {
  if (!value || typeof value !== "object") return null;
  const file = value as Record<string, unknown>;
  const id = typeof file.id === "string" ? file.id : "";
  if (!fileIdPattern.test(id)) return null;
  const contentType = cleanText(file.contentType, 60).toLowerCase();
  if (!feedbackFileTypes[contentType]) return null;
  const size = Number(file.size);
  if (!Number.isInteger(size) || size < 1 || size > feedbackFileMaxBytes) return null;
  return { id, name: cleanLine(file.name, 120) || "file", contentType, size };
}

function validateCaptures(value: unknown): FeedbackCapture[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const capture = item as Record<string, unknown>;
    const position = capture.position && typeof capture.position === "object"
      ? capture.position as Record<string, unknown>
      : null;
    const elementInfo = cleanText(capture.elementInfo, 500);
    const x = position ? finiteNumber(position.x, 0, 20_000) : null;
    const y = position ? finiteNumber(position.y, 0, 20_000) : null;
    const screenshot = validateFileRef(capture.screenshot);
    const hasElement = Boolean(elementInfo && x !== null && y !== null);
    if (screenshot && !screenshot.contentType.startsWith("image/")) return [];
    if (!hasElement && !screenshot) return [];
    return [{
      id: cleanText(capture.id, 100) || `capture-${index + 1}`,
      ...(hasElement ? { elementInfo, position: { x: Math.round(x!), y: Math.round(y!) } } : {}),
      ...(screenshot ? { screenshot } : {}),
    }];
  });
}

function validateAttachments(value: unknown): FeedbackAttachment[] {
  if (!Array.isArray(value)) return [];
  let voiceNotes = 0;
  return value.slice(0, 8).flatMap((item): FeedbackAttachment[] => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const kind = record.kind === "voice" ? "voice" : record.kind === "file" ? "file" : null;
    const file = validateFileRef(record);
    if (!kind || !file) return [];
    if (kind === "voice") {
      if (!file.contentType.startsWith("audio/") || voiceNotes++ > 0) return [];
      const durationSeconds = finiteNumber(record.durationSeconds, 0, 600);
      return [{ ...file, kind, ...(durationSeconds !== null ? { durationSeconds: Math.round(durationSeconds) } : {}) }];
    }
    return [{ ...file, kind }];
  });
}

function validateContext(value: unknown): FeedbackContextEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const label = cleanLine(entry.label, 40);
    const text = cleanLine(entry.value, 200);
    return label && text ? [{ label, value: text }] : [];
  });
}

function validateMetadata(value: unknown): FeedbackBrowserMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const metadata = value as Record<string, unknown>;
  const dimensions = (input: unknown) => {
    if (!input || typeof input !== "object") return undefined;
    const item = input as Record<string, unknown>;
    const width = finiteNumber(item.width, 0, 20_000);
    const height = finiteNumber(item.height, 0, 20_000);
    return width === null || height === null ? undefined : { width: Math.round(width), height: Math.round(height) };
  };
  const connectionInput = metadata.connection && typeof metadata.connection === "object"
    ? metadata.connection as Record<string, unknown>
    : null;
  const connection = connectionInput ? {
    effectiveType: cleanText(connectionInput.effectiveType, 30) || undefined,
    downlink: finiteNumber(connectionInput.downlink, 0, 10_000) ?? undefined,
    rtt: finiteNumber(connectionInput.rtt, 0, 100_000) ?? undefined,
  } : undefined;
  return {
    viewport: dimensions(metadata.viewport),
    screen: dimensions(metadata.screen),
    devicePixelRatio: finiteNumber(metadata.devicePixelRatio, 0.1, 20) ?? undefined,
    language: cleanText(metadata.language, 40) || undefined,
    platform: cleanText(metadata.platform, 100) || undefined,
    cookiesEnabled: typeof metadata.cookiesEnabled === "boolean" ? metadata.cookiesEnabled : undefined,
    onLine: typeof metadata.onLine === "boolean" ? metadata.onLine : undefined,
    connection,
  };
}

function validateConsole(value: unknown): FeedbackConsoleEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.slice(-100).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const level = cleanText(entry.level, 10);
    const message = cleanText(entry.message, 2_000);
    if (!(["log", "warn", "error", "info"] as string[]).includes(level) || !message) return [];
    return [{ level: level as FeedbackConsoleEntry["level"], message, timestamp: validTimestamp(entry.timestamp) }];
  });
  return entries.length ? entries : undefined;
}

function validateNetwork(value: unknown): FeedbackNetworkEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.slice(-50).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const url = cleanText(entry.url, 500);
    const method = cleanText(entry.method, 12).toUpperCase();
    const status = finiteNumber(entry.status, 0, 999);
    const durationMs = finiteNumber(entry.durationMs, 0, 600_000);
    if (!url || !method || status === null || durationMs === null) return [];
    return [{ method, url, status: Math.round(status), durationMs: Math.round(durationMs), timestamp: validTimestamp(entry.timestamp) }];
  });
  return entries.length ? entries : undefined;
}

export function validateFeedbackPayload(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid feedback" };
  const record = input as Record<string, unknown>;
  if (cleanText(record.company, 100)) return { ok: false, error: "Unable to send feedback" };

  const category = cleanText(record.category, 40);
  if (!feedbackCategories.includes(category as FeedbackCategory))
    return { ok: false, error: "Choose a feedback category" };

  const description = cleanText(record.description, 4_000);
  if (description.length < 10) return { ok: false, error: "Add at least 10 characters of detail" };
  if (description.length > 4_000) return { ok: false, error: "Keep feedback under 4,000 characters" };

  // Only one text box is ever required, and it is the note: a title can be
  // derived from a report, a report cannot be derived from a title. Demanding
  // both asked the reporter to say the same thing twice.
  const givenTitle = cleanText(record.title, 120);
  if (givenTitle.length > 120) return { ok: false, error: "Keep the title under 120 characters" };
  const title = givenTitle.length >= 4 ? givenTitle : deriveTitle(description);

  const rating = record.rating === null || record.rating === undefined || record.rating === ""
    ? null
    : Number(record.rating);
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5))
    return { ok: false, error: "Rating must be between 1 and 5" };

  const clientSubmissionId = cleanText(record.clientSubmissionId, 80);
  if (!new RegExp(`^${uuidPattern}$`, "i").test(clientSubmissionId))
    return { ok: false, error: "Invalid feedback receipt" };

  const rawPath = cleanText(record.pagePath, 300).split(/[?#]/, 1)[0];
  const pagePath = rawPath && rawPath.startsWith("/") && !rawPath.startsWith("//") ? rawPath : null;
  const diagnosticsInput = record.diagnostics && typeof record.diagnostics === "object"
    ? record.diagnostics as Record<string, unknown>
    : {};

  return {
    ok: true,
    value: {
      title,
      description,
      category: category as FeedbackCategory,
      rating,
      pagePath,
      source: record.source === "game" ? "game" : "web",
      context: validateContext(record.context),
      captures: validateCaptures(record.captures),
      attachments: validateAttachments(record.attachments),
      diagnostics: {
        metadata: validateMetadata(diagnosticsInput.metadata),
        console: validateConsole(diagnosticsInput.console),
        network: validateNetwork(diagnosticsInput.network),
      },
      clientSubmissionId,
    },
  };
}

// ---------------------------------------------------------------- rendering

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function jsonBlock(value: unknown) {
  return `\n\n\`\`\`json\n${JSON.stringify(value, null, 2).slice(0, 12_000)}\n\`\`\``;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function voiceLabel(attachment: FeedbackAttachment) {
  return attachment.durationSeconds !== undefined ? `Voice note (${formatDuration(attachment.durationSeconds)})` : "Voice note";
}

/** Every stored file of a report, in issue order, for the issue body and the mail alert. */
function filesOf(submission: FeedbackSubmission) {
  const screenshots = submission.captures.flatMap((capture, index) => capture.screenshot ? [{ label: `Screenshot ${index + 1}`, file: capture.screenshot }] : []);
  const voice = submission.attachments.filter((item) => item.kind === "voice").map((item) => ({ label: voiceLabel(item), file: item as FeedbackFileRef }));
  const files = submission.attachments.filter((item) => item.kind === "file").map((item) => ({ label: item.name, file: item as FeedbackFileRef }));
  return [...screenshots, ...voice, ...files];
}

/** Which app a report in the shared private feedback inbox came from (see lib/github.ts). */
export const FEEDBACK_APP_LABEL = "app:rtsai";

export function feedbackLabels(category: FeedbackCategory, source: FeedbackSource = "web") {
  const categoryLabel: Partial<Record<FeedbackCategory, string>> = {
    "Bug": "bug",
    "Feature Request": "enhancement",
    "UI/UX": "ui/ux",
    "Gameplay": "gameplay",
    "Mission Generator": "mission-generator",
    "AI Companion": "ai-companion",
  };
  return ["feedback", FEEDBACK_APP_LABEL, `source:${source}`, ...(categoryLabel[category] ? [categoryLabel[category]!] : [])];
}

export function createFeedbackIssueBody(input: {
  receipt: string;
  receivedAt: string;
  pageUrl: string;
  /** The team-only viewer of this report's files (feedbackViewerUrl). */
  viewerUrl: string;
  submission: FeedbackSubmission;
  identity: { uid: string; email: string | null; name: string | null };
}) {
  const { receipt, receivedAt, pageUrl, viewerUrl, submission, identity } = input;
  let body = `**Page:** ${submission.pagePath ?? "/"}\n**URL:** ${pageUrl}\n\n## Feedback\n\n${submission.description}`;
  const files = filesOf(submission);
  if (files.length) body += `\n\n## Files\n\n**[Open the screenshots, voice note and files](${viewerUrl})** (RTS AI team sign-in)\n\n${files.map((item) => `- ${item.label} · \`${item.file.name}\` · ${item.file.contentType}, ${formatBytes(item.file.size)}`).join("\n")}`;

  if (submission.captures.length) {
    body += "\n\n## Selections & Screenshots";
    submission.captures.forEach((capture, index) => {
      body += `\n\n### ${capture.screenshot && !capture.elementInfo ? "Screenshot" : "Selection"} ${index + 1}`;
      if (capture.elementInfo) body += `\n**Element:** \`${capture.elementInfo.replace(/`/g, "'")}\``;
      if (capture.position) body += `\n**Position:** (${capture.position.x}, ${capture.position.y})`;
      if (capture.screenshot) body += `\n**Screenshot:** \`${capture.screenshot.name}\` (in the report's files)`;
    });
  } else if (submission.source === "web") {
    body += "\n\n## Selections & Screenshots\n\nNone selected.";
  }

  const context = submission.context.map((entry) => `\n- ${entry.label}: ${entry.value}`).join("");
  body += `\n\n## Context\n\n- Source: ${submission.source === "game" ? "Browser game" : "Website"}${context}\n- Category: ${submission.category}\n- Rating: ${submission.rating ? `${submission.rating}/5` : "Not provided"}\n- Submitted: ${receivedAt}\n- User: ${identity.name || "Not provided"}\n- Email: ${identity.email || "Not provided"}\n- Firebase UID: \`${identity.uid}\``;
  if (submission.diagnostics.metadata) body += `\n\n## Browser metadata${jsonBlock(submission.diagnostics.metadata)}`;
  if (submission.diagnostics.console) body += `\n\n## Console diagnostics${jsonBlock(submission.diagnostics.console)}`;
  if (submission.diagnostics.network) body += `\n\n## Network diagnostics${jsonBlock(submission.diagnostics.network)}`;
  body += `\n\n<!-- ${receipt}; client:${submission.clientSubmissionId} -->`;
  return body.slice(0, 60_000);
}

export function createFeedbackEmail(input: {
  receipt: string;
  issueNumber?: number;
  issueUrl?: string;
  receivedAt: string;
  /** The team-only viewer of this report's files (feedbackViewerUrl). */
  viewerUrl?: string;
  submission: FeedbackSubmission;
  identity: { uid: string; email: string | null; name: string | null };
}) {
  const { receipt, issueNumber, issueUrl, receivedAt, viewerUrl, submission, identity } = input;
  const safeDescription = escapeHtml(submission.description).replace(/\n/g, "<br />");
  const safeTitle = escapeHtml(submission.title);
  const sender = escapeHtml(identity.name || identity.email || "Signed-in player");
  const elements = submission.captures.filter((capture) => capture.elementInfo && capture.position);
  const captures = elements.length
    ? elements.map((capture) => `${capture.elementInfo} @ ${capture.position!.x},${capture.position!.y}`).join("\n")
    : "None";
  const stored = filesOf(submission);
  const files = stored.length ? `${stored.map((item) => `${item.label}: ${item.file.name} (${formatBytes(item.file.size)})`).join("\n")}${viewerUrl ? `\nOpen them: ${viewerUrl}` : ""}` : "None";
  const diagnostics = Object.keys(submission.diagnostics).length
    ? JSON.stringify(submission.diagnostics, null, 2)
    : "Not included";
  const context = submission.context.map((entry) => `\n${entry.label}: ${entry.value}`).join("");
  const details = `Source: ${submission.source === "game" ? "Browser game" : "Website"}${context}\nCategory: ${submission.category}\nRating: ${submission.rating ?? "Not provided"}\nPage: ${submission.pagePath || "/"}\nUser: ${identity.name || identity.email || "Signed-in player"}\nFirebase UID: ${identity.uid}\nReceipt: ${receipt}\n\nSelected elements:\n${captures}\n\nFiles:\n${files}\n\nDiagnostics:\n${diagnostics}`;
  const fileLinks = stored.length && viewerUrl
    ? `<p style="margin:24px 0 0;font-size:14px;line-height:1.8"><a href="${escapeHtml(viewerUrl)}" style="color:#ef5b3f;font-weight:700">Open ${stored.length === 1 ? "the attached file" : `the ${stored.length} attached files`}</a> <span style="color:#b5b5aa">(${stored.map((item) => escapeHtml(item.label)).join(" · ")})</span></p>`
    : "";
  const issueAction = issueNumber && issueUrl
    ? `<p style="margin:28px 0 0"><a href="${escapeHtml(issueUrl)}" style="display:inline-block;padding:13px 18px;background:#ef5b3f;color:#fff;text-decoration:none;font-weight:700">Open private issue #${issueNumber}</a></p>`
    : `<p style="margin:28px 0 0;color:#b5b5aa;font-size:13px">Queued through Firebase mail. Delivery and GitHub issue synchronization are not confirmed.</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#111411;color:#f0eee6;font-family:Arial,sans-serif"><div style="max-width:680px;margin:0 auto;padding:40px 24px"><p style="margin:0 0 8px;color:#ef5b3f;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">RTS AI feedback · ${escapeHtml(submission.category)}</p><h1 style="margin:0 0 10px;font-size:30px;line-height:1.15">${safeTitle}</h1><p style="margin:0 0 26px;color:#b5b5aa;font-size:13px">${sender} · ${escapeHtml(receivedAt)} · ${escapeHtml(receipt)}</p><div style="padding:22px;background:#f0eee6;color:#111411;border-left:4px solid #ef5b3f;font-size:16px;line-height:1.6">${safeDescription}</div>${fileLinks}<pre style="margin:24px 0 0;padding:18px;overflow:auto;background:#090b09;color:#d5d7cf;border:1px solid #343a34;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap">${escapeHtml(details)}</pre>${issueAction}</div></body></html>`;
  const issueLine = issueUrl ? `\nPrivate issue: ${issueUrl}` : "\nPrivate issue: pending synchronization";
  const text = `RTS AI feedback: ${submission.title}\n\n${submission.description}\n\n${details}${issueLine}`;
  return { html, text };
}
