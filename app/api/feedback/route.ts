import {
  createFeedbackEmail,
  createFeedbackIssueBody,
  feedbackLabels,
  feedbackViewerUrl,
  isAllowedFeedbackOrigin,
  validateFeedbackPayload,
} from "../../../lib/feedback";
import { recordDailyEvent } from "../../../lib/event-rollup";
import { mailGroup, sendFirebaseEmail } from "../../../lib/firebase-mail";
import { bearerToken, verifyFirebaseIdentity } from "../../../lib/firebase-token";
import { createGitHubIssue, GitHubRequestError, isGitHubConfigured } from "../../../lib/github";

// Files never pass through here: the reporter's browser stores them in Firestore first (feedbackReports/<id>, see
// app/components/feedback/report-files.ts) and the request only names them; the issue links the team-only viewer.
const maxBodyBytes = 64_000;

export function createFeedbackHandler(dependencies: {
  verifyIdentity: typeof verifyFirebaseIdentity;
  createIssue: typeof createGitHubIssue;
  issueConfigured: typeof isGitHubConfigured;
  sendEmail: typeof sendFirebaseEmail;
  recipients: typeof mailGroup;
  reportError: typeof console.error;
  /** Every delivered report counts as feedback_sent in its day's rollup (from the site and the game alike). */
  rollup?: typeof recordDailyEvent;
}) {
return async function handleFeedback(request: Request) {
  if (!isAllowedFeedbackOrigin(request)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBodyBytes) return Response.json({ error: "Feedback is too large" }, { status: 413 });

  const identity = await dependencies.verifyIdentity(request);
  if (!identity) return Response.json({ error: "Sign in required" }, { status: 401 });

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = validateFeedbackPayload(input);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  const receivedAt = new Date().toISOString();
  const receipt = `RTS-${parsed.value.clientSubmissionId.slice(0, 8).toUpperCase()}`;
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://rtsai.net").replace(/\/$/, "");
  const pageUrl = `${baseUrl}${parsed.value.pagePath || "/"}`;
  const viewerUrl = feedbackViewerUrl(baseUrl, parsed.value.clientSubmissionId);
  const issueTitle = `[${parsed.value.category}] ${parsed.value.title} — ${parsed.value.pagePath || "/"}`.slice(0, 240);
  const issueBody = createFeedbackIssueBody({ receipt, receivedAt, pageUrl, viewerUrl, submission: parsed.value, identity });
  const labels = feedbackLabels(parsed.value.category, parsed.value.source);
  // A label GitHub doesn't know (422) is retried without it: first without a newer source label, then with none.
  const labelAttempts = [labels, ...(parsed.value.source === "web" ? [] : [feedbackLabels(parsed.value.category)]), undefined];

  let issue: { number: number; html_url: string } | null = null;
  if (dependencies.issueConfigured()) {
    try {
      for (const [index, attempt] of labelAttempts.entries()) {
        try {
          const response = await dependencies.createIssue({ title: issueTitle, body: issueBody, ...(attempt ? { labels: attempt } : {}) });
          issue = { number: response.number, html_url: response.htmlUrl };
          break;
        } catch (cause) {
          const status = cause instanceof GitHubRequestError ? cause.status : 0;
          if (status !== 422 || index === labelAttempts.length - 1) throw cause;
        }
      }
    } catch (cause) {
      const status = cause instanceof GitHubRequestError ? cause.status : 0;
      dependencies.reportError("Private feedback issue creation failed", {
        status,
        name: cause instanceof Error ? cause.name : "UnknownError",
        message: cause instanceof Error ? cause.message.slice(0, 300) : "Unknown failure",
      });
    }
  }

  let notificationQueued = false;
  // Team alerts go to the team group (MAIL_GROUP), the archive of every event; the rules accept no other recipient.
  const administrator = dependencies.recipients()[0];
  if (administrator) {
    const email = createFeedbackEmail({
      receipt,
      issueNumber: issue?.number,
      issueUrl: issue?.html_url,
      receivedAt,
      viewerUrl,
      submission: parsed.value,
      identity,
    });
    try {
      await dependencies.sendEmail({
        to: administrator,
        subject: `[RTS AI] ${parsed.value.category}: ${parsed.value.title}`,
        html: email.html,
        text: email.text,
        idToken: bearerToken(request),
      });
      notificationQueued = true;
    } catch (cause) {
      dependencies.reportError("Firebase feedback notification failed", { issueNumber: issue?.number, cause: cause instanceof Error ? cause.message : "unknown" });
    }
  }

  if (!issue && !notificationQueued) {
    return Response.json(
      { error: "Feedback could not be saved. Your message is still here—please try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (dependencies.rollup) {
    await dependencies.rollup({ idToken: bearerToken(request), name: "feedback_sent", props: { category: parsed.value.category, source: parsed.value.source } })
      .catch((cause: unknown) => dependencies.reportError("Daily rollup failed", { event: "feedback_sent", message: cause instanceof Error ? cause.message.slice(0, 300) : "unknown" }));
  }

  return Response.json(
    {
      success: true,
      issueNumber: issue?.number,
      issueUrl: issue?.html_url,
      receipt: issue ? `RTS-#${issue.number}` : receipt,
      notificationQueued,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
}

export const POST = createFeedbackHandler({
  verifyIdentity: verifyFirebaseIdentity,
  createIssue: createGitHubIssue,
  issueConfigured: isGitHubConfigured,
  sendEmail: sendFirebaseEmail,
  recipients: mailGroup,
  reportError: console.error,
  rollup: recordDailyEvent,
});
