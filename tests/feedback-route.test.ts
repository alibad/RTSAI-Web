import assert from "node:assert/strict";
import test from "node:test";
import { createFeedbackHandler } from "../app/api/feedback/route";
import { GitHubRequestError } from "../lib/github";

const input = { category: "Bug", title: "", description: "The crossing remains blocked after a reload.", clientSubmissionId: "7a82cb1e-7d34-4e5a-9b9d-8106391e1cd0" };
const request = (origin = "http://127.0.0.1:61690") => new Request("http://127.0.0.1:61690/api/feedback", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input) });
function fixture(options: { issue?: boolean; mail?: boolean; auth?: boolean; labelsFail?: boolean } = {}) {
  const calls: string[] = [];
  const handle = createFeedbackHandler({
    verifyIdentity: async () => options.auth === false ? null : { uid: "mock-user", email: "mock@example.test", name: "Mock" },
    issueConfigured: () => true,
    createIssue: async value => { calls.push(value.labels ? "issue-labels" : "issue"); if (options.labelsFail && value.labels) throw new GitHubRequestError(422, "Mock label rejection"); if (options.issue === false) throw new Error("Mock issue failure"); return { number: 42, htmlUrl: "https://example.test/private/42" }; },
    recipients: () => ["admin@example.test"],
    sendEmail: async () => { calls.push("queue"); if (options.mail === false) throw new Error("Mock queue failure"); return "mock-queue"; },
    reportError: () => undefined,
  });
  return { calls, handle };
}

test("feedback issue success survives mail failure without claiming delivery or retry", async () => {
  const { handle, calls } = fixture({ mail: false });
  const response = await handle(request()), payload = await response.json();
  assert.equal(response.status, 200); assert.equal(payload.receipt, "RTS-#42"); assert.equal(payload.notificationQueued, false);
  assert.equal(payload.issueUrl, "https://example.test/private/42"); assert.equal(payload.deliveryConfirmed, undefined);
  assert.deepEqual(calls, ["issue-labels", "queue"]);
});

test("feedback queue fallback returns a receipt with no invented private issue", async () => {
  const { handle } = fixture({ issue: false });
  const response = await handle(request()), payload = await response.json();
  assert.equal(response.status, 200); assert.equal(payload.receipt, "RTS-7A82CB1E"); assert.equal(payload.notificationQueued, true); assert.equal(payload.issueUrl, undefined);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("both delivery paths failing preserve a retryable failure; missing labels retry once", async () => {
  const failed = fixture({ issue: false, mail: false });
  const response = await failed.handle(request());
  assert.equal(response.status, 503); assert.match((await response.json()).error, /Your message is still here/);
  const retry = fixture({ labelsFail: true });
  assert.equal((await retry.handle(request())).status, 200);
  assert.deepEqual(retry.calls, ["issue-labels", "issue", "queue"]);
});

test("foreign origin and unauthenticated feedback never reach storage or notification mocks", async () => {
  const foreign = fixture(); assert.equal((await foreign.handle(request("https://foreign.example"))).status, 403); assert.deepEqual(foreign.calls, []);
  const unauthenticated = fixture({ auth: false }); assert.equal((await unauthenticated.handle(request())).status, 401); assert.deepEqual(unauthenticated.calls, []);
});
