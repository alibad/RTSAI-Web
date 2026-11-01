import assert from "node:assert/strict";
import test from "node:test";
import { createAccountHandler } from "../app/api/account/route";

const identity = { uid: "u1", email: "ali@example.com", name: "Ali" };

function harness(answer: (init: RequestInit) => Response | Promise<Response>, url: string | null = "https://fn.test/account") {
  const calls: { url: string; init: RequestInit }[] = [], errors: unknown[] = [];
  const handle = createAccountHandler({
    verifyIdentity: async request => request.headers.get("authorization") ? identity : null,
    functionUrl: () => url,
    fetch: (async (target: string, init: RequestInit) => { calls.push({ url: target, init }); return answer(init); }) as typeof fetch,
    reportError: (...args: unknown[]) => { errors.push(args); },
  });
  const call = (method: string, headers: Record<string, string> = {}) => handle(new Request("https://rtsai.net/api/account", { method, headers: { Authorization: "Bearer player-token", ...headers } }));
  return { call, calls, errors };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

test("signed-out callers and other sites never reach the function", async () => {
  const h = harness(() => json({}));
  assert.equal((await h.call("GET", { Authorization: "" })).status, 401);
  assert.equal((await h.call("DELETE", { origin: "https://evil.example" })).status, 403);
  assert.equal(h.calls.length, 0);
});

test("the export is passed on as a dated JSON download, with the player's own token", async () => {
  const h = harness(() => json({ account: { uid: "u1" } }));
  const response = await h.call("GET");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition") ?? "", /attachment; filename="rtsai-account-\d{4}-\d{2}-\d{2}\.json"/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { account: { uid: "u1" } });
  assert.equal(h.calls[0].init.method, "GET");
  assert.deepEqual(h.calls[0].init.headers, { Authorization: "Bearer player-token" });
});

test("deleting passes on the function's answer, including its ask to sign in again", async () => {
  const again = harness(() => json({ error: "Sign in again to delete your account", reauthenticate: true }, 401));
  const stale = await again.call("DELETE");
  assert.equal(stale.status, 401);
  assert.equal((await stale.json()).reauthenticate, true);
  assert.equal(stale.headers.get("content-disposition"), null);

  const ok = harness(() => json({ deleted: true, removed: { savedMaps: 2 }, notified: true }));
  const done = await ok.call("DELETE");
  assert.equal(done.status, 200);
  assert.equal((await done.json()).deleted, true);
  assert.equal(ok.calls[0].init.method, "DELETE");
});

test("a function that isn't deployed or can't be reached says so plainly, with the contact address", async () => {
  const missing = harness(() => new Response("<html>404 Page not found</html>", { status: 404, headers: { "content-type": "text/html" } }));
  const notDeployed = await missing.call("DELETE");
  assert.equal(notDeployed.status, 503);
  assert.match((await notDeployed.json()).error, /not available right now\. Write to \S+@\S+/);
  assert.equal(missing.errors.length, 1);

  const down = harness(() => { throw new Error("connect ECONNREFUSED"); });
  assert.equal((await down.call("GET")).status, 503);
  assert.equal((await harness(() => json({}), null).call("GET")).status, 503, "no function configured (emulators without ACCOUNT_FUNCTION_URL)");
});
