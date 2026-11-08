import assert from "node:assert/strict";
import test from "node:test";
import { createFeedbackEmail, createFeedbackIssueBody, feedbackLabels, feedbackViewerUrl, validateFeedbackPayload } from "../lib/feedback";

const valid = {
  category: "Mission Generator",
  rating: 4,
  title: "Preserve the main crossing",
  description: "The generated road network should preserve this crossing.",
  pagePath: "/?mission=riyadh",
  captures: [{ id: "capture-1", elementInfo: "button.generate — Generate mission", position: { x: 100, y: 200 } }],
  diagnostics: { metadata: { viewport: { width: 1440, height: 900 } } },
  clientSubmissionId: "7a82cb1e-7d34-4e5a-9b9d-8106391e1cd0",
  company: "",
};

test("validates and normalizes signed-in feedback payloads", () => {
  const result = validateFeedbackPayload(valid);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.category, "Mission Generator");
    assert.equal(result.value.rating, 4);
    assert.equal(result.value.pagePath, "/");
    assert.equal(result.value.captures.length, 1);
  }
});

test("rejects spam, short descriptions, and unknown categories", () => {
  assert.equal(validateFeedbackPayload({ ...valid, company: "robots inc" }).ok, false);
  assert.equal(validateFeedbackPayload({ ...valid, description: "short" }).ok, false);
  assert.equal(validateFeedbackPayload({ ...valid, category: "billing" }).ok, false);
});

test("escapes feedback before rendering the Firebase mail alert", () => {
  const result = validateFeedbackPayload({ ...valid, description: "Please preserve <script>alert('x')</script> roads." });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const email = createFeedbackEmail({
    receipt: "RTS-ABC12345",
    issueNumber: 42,
    issueUrl: "https://github.com/alibad/RTSAI-Web/issues/42",
    receivedAt: "2026-08-10T10:00:00.000Z",
    submission: result.value,
    identity: { uid: "firebase-user", email: "player@example.com", name: "Player <One>" },
  });
  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.match(email.html, /Player &lt;One&gt;/);
});

test("creates a complete Firebase mail fallback without a GitHub issue", () => {
  const result = validateFeedbackPayload(valid);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const email = createFeedbackEmail({
    receipt: "RTS-ABC12345",
    receivedAt: "2026-08-10T10:00:00.000Z",
    submission: result.value,
    identity: { uid: "firebase-user", email: "player@example.com", name: "Player" },
  });
  assert.match(email.html, /Queued through Firebase mail/);
  assert.match(email.text, /Private issue: pending synchronization/);
  assert.match(email.text, /button\.generate/);
  assert.match(email.text, /Firebase UID: firebase-user/);
});

test("creates a private issue body with bounded context and labels", () => {
  const result = validateFeedbackPayload(valid);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const body = createFeedbackIssueBody({
    receipt: "RTS-ABC12345",
    receivedAt: "2026-08-10T10:00:00.000Z",
    pageUrl: "https://rtsai.net/",
    viewerUrl: "https://rtsai.net/feedback/7a82cb1e-7d34-4e5a-9b9d-8106391e1cd0",
    submission: result.value,
    identity: { uid: "firebase-user", email: "player@example.com", name: "Player" },
  });
  assert.match(body, /## Selections & Screenshots/);
  assert.doesNotMatch(body, /## Files/, "no files, no viewer link");
  assert.match(body, /\*\*Element:\*\* `button\.generate/);
  assert.match(body, /- Source: Website/);
  assert.deepEqual(feedbackLabels("Bug"), ["feedback", "app:rtsai", "source:web", "bug"]);
  assert.deepEqual(feedbackLabels("Gameplay", "game"), ["feedback", "app:rtsai", "source:game", "gameplay"]);
});

const id = valid.clientSubmissionId;
const viewerUrl = feedbackViewerUrl("https://rtsai.net/", id);
const withMedia = {
  ...valid,
  source: "game",
  pagePath: "/play/",
  context: [{ label: "Mode", value: "Isometric" }, { label: "Match", value: "skirmish on twin-fords, tick 1840" }],
  captures: [{ id: "shot-1", screenshot: { id: "k3v9q2m8x1b7n4c6", name: "screenshot-1.jpg", contentType: "image/jpeg", size: 184_320 } }],
  attachments: [
    { kind: "voice", id: "a1b2c3d4e5f6g7h8", name: "voice-note.webm", contentType: "audio/webm", size: 96_000, durationSeconds: 42 },
    { kind: "file", id: "z9y8x7w6v5u4t3s2", name: "match.log", contentType: "text/plain", size: 2_048 },
  ],
};

test("the issue names the stored files and links the team-only viewer, never the bytes", () => {
  assert.equal(viewerUrl, `https://rtsai.net/feedback/${id}`);
  const result = validateFeedbackPayload(withMedia);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.source, "game");
  assert.deepEqual(result.value.captures[0].screenshot, { id: "k3v9q2m8x1b7n4c6", name: "screenshot-1.jpg", contentType: "image/jpeg", size: 184_320 });
  assert.equal(result.value.attachments.length, 2);
  const body = createFeedbackIssueBody({
    receipt: "RTS-ABC12345",
    receivedAt: "2026-10-13T10:00:00.000Z",
    pageUrl: "https://rtsai.net/play/",
    viewerUrl,
    submission: result.value,
    identity: { uid: "firebase-user", email: "player@example.com", name: "Player" },
  });
  assert.ok(body.includes(`## Files\n\n**[Open the screenshots, voice note and files](${viewerUrl})** (RTS AI team sign-in)`));
  assert.ok(body.includes("- Screenshot 1 · `screenshot-1.jpg` · image/jpeg, 180 KB"));
  assert.ok(body.includes("- Voice note (0:42) · `voice-note.webm` · audio/webm, 94 KB"));
  assert.ok(body.includes("- match.log · `match.log` · text/plain, 2 KB"));
  assert.ok(body.includes("### Screenshot 1\n**Screenshot:** `screenshot-1.jpg` (in the report's files)"));
  assert.match(body, /- Source: Browser game\n- Mode: Isometric\n- Match: skirmish on twin-fords, tick 1840/);
  assert.doesNotMatch(body, /None selected|data:|base64|blob\.vercel|https:\/\/(?!rtsai\.net)/);
  const email = createFeedbackEmail({ receipt: "RTS-ABC12345", receivedAt: "2026-10-13T10:00:00.000Z", viewerUrl, submission: result.value, identity: { uid: "firebase-user", email: "player@example.com", name: "Player" } });
  assert.ok(email.text.includes(`Screenshot 1: screenshot-1.jpg (180 KB)\nVoice note (0:42): voice-note.webm (94 KB)\nmatch.log: match.log (2 KB)\nOpen them: ${viewerUrl}`));
  assert.ok(email.html.includes(`href="${viewerUrl}"`));
  assert.match(email.html, /Open the 3 attached files/);
});

test("file references are bounded: id shape, allowed types, 10 MB, images for screenshots, one voice note", () => {
  const only = (file: Record<string, unknown>) => validateFeedbackPayload({ ...withMedia, captures: [], attachments: [{ kind: "file", ...file }] });
  const good = { id: "z9y8x7w6v5u4t3s2", name: "x.log", contentType: "text/plain", size: 10 };
  assert.equal((only(good) as { ok: true; value: { attachments: unknown[] } }).value.attachments.length, 1);
  for (const bad of [
    { ...good, id: "../../admins/x" }, { ...good, id: "Z9Y8X7W6V5U4T3S2" }, { ...good, id: "short" },
    { ...good, contentType: "text/html" }, { ...good, contentType: "image/svg+xml" }, { ...good, contentType: "application/pdf" },
    { ...good, size: 11 * 1024 * 1024 }, { ...good, size: 0 }, { ...good, size: 1.5 },
    { ...good, url: "https://evil.example/x.log", id: undefined },
  ]) {
    const result = only(bad);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.attachments.length, 0, JSON.stringify(bad));
  }
  const notImage = validateFeedbackPayload({ ...withMedia, captures: [{ screenshot: { ...withMedia.captures[0].screenshot, contentType: "text/plain" } }] });
  assert.equal(notImage.ok && notImage.value.captures.length, 0);
  const twoVoices = validateFeedbackPayload({ ...withMedia, attachments: [withMedia.attachments[0], withMedia.attachments[0]] });
  assert.equal(twoVoices.ok && twoVoices.value.attachments.length, 1);
  // Extra fields (a URL, bytes) never survive validation.
  const extra = validateFeedbackPayload({ ...withMedia, attachments: [{ ...withMedia.attachments[1], url: "https://evil.example", data: "AAAA" }] });
  assert.equal(extra.ok && JSON.stringify(extra.value.attachments[0]), JSON.stringify({ id: "z9y8x7w6v5u4t3s2", name: "match.log", contentType: "text/plain", size: 2048, kind: "file" }));
});

test("file names and context cannot break the issue's markdown", () => {
  const result = validateFeedbackPayload({
    ...withMedia,
    context: [{ label: "Map](javascript:x)", value: "`tick` <b>1</b>\n## heading" }],
    attachments: [{ ...withMedia.attachments[1], name: "[click](https://evil.example).log`" }],
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.doesNotMatch(result.value.attachments[0].name, /[[\]`]/);
  assert.doesNotMatch(result.value.context[0].label + result.value.context[0].value, /[`<>[\]\n#]/);
});
