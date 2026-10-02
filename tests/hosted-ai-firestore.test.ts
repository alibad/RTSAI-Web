import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, test } from "node:test";
import { POST as chatCompletions } from "../app/api/ai/v1/chat/completions/route";
import { POST as install } from "../app/api/ai/v1/install/route";
import { FirestoreUsageStore } from "../lib/hosted-ai/firestore-store";
import { setHostedAiOverrides, utcDay } from "../lib/hosted-ai/service";
import { resetSpendAlertMemo } from "../lib/hosted-ai/spend-alerts";
import { startMockAnthropic } from "../scripts/mock-anthropic.mjs";

// The Firestore REST store runs against a small in-process fake of the
// documents API (commit with update masks, preconditions and increment
// transforms, deletes, batchGet, get, and document creation in the Trigger
// Email `mail` collection) plus the OAuth and anonymous-auth token endpoints.
// It checks the request shapes and the accounting, not Google itself.

type Value = { integerValue?: string; stringValue?: string; booleanValue?: boolean; nullValue?: null; timestampValue?: string };
type Write = {
  delete?: string;
  update: { name: string; fields: Record<string, Value> };
  updateMask?: { fieldPaths: string[] };
  updateTransforms?: { fieldPath: string; increment: { integerValue: string } }[];
  currentDocument?: { exists: boolean };
};

const documents = new Map<string, Record<string, Value>>();
const tokenRequests: string[] = [];
const authorizations = new Set<string>();
const originalFetch = globalThis.fetch;
let mock: Awaited<ReturnType<typeof startMockAnthropic>>;

function json(status: number, value: unknown) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = input instanceof Request ? input.url : String(input);
  if (mock && url.startsWith(mock.url)) return originalFetch(input, init);
  if (url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=")) {
    return json(200, { idToken: "fake-mail-id-token", expiresIn: "3600" });
  }
  if (url === "https://oauth2.googleapis.com/token") {
    const body = new URLSearchParams(String(init?.body));
    tokenRequests.push(body.get("grant_type") ?? "");
    assert.equal(body.get("assertion")?.split(".").length, 3, "a signed JWT assertion is exchanged");
    return json(200, { access_token: "fake-access-token", expires_in: 3_600 });
  }
  authorizations.add(new Headers(init?.headers).get("authorization") ?? "");
  const base = "https://firestore.googleapis.com/v1/projects/demo-rtsai/databases/(default)/documents";
  assert.ok(url.startsWith(base), url);
  const suffix = url.slice(base.length);
  const prefix = "projects/demo-rtsai/databases/(default)/documents/";
  if (suffix === ":commit") {
    const { writes } = JSON.parse(String(init?.body)) as { writes: Write[] };
    for (const write of writes) {
      if (write.delete) continue;
      const exists = documents.has(write.update.name);
      if (write.currentDocument?.exists === false && exists) return json(409, { error: { status: "ALREADY_EXISTS" } });
      if (write.currentDocument?.exists === true && !exists) return json(404, { error: { status: "NOT_FOUND" } });
    }
    const writeResults = writes.map((write) => {
      if (write.delete) {
        documents.delete(write.delete);
        return { updateTime: new Date().toISOString() };
      }
      const current = { ...(documents.get(write.update.name) ?? {}) };
      const next = write.updateMask
        ? { ...current, ...Object.fromEntries(write.updateMask.fieldPaths.map((path) => [path, write.update.fields[path]])) }
        : { ...write.update.fields };
      const transformResults = (write.updateTransforms ?? []).map((transform) => {
        const value = Number(next[transform.fieldPath]?.integerValue ?? 0) + Number(transform.increment.integerValue);
        next[transform.fieldPath] = { integerValue: String(value) };
        return { integerValue: String(value) };
      });
      documents.set(write.update.name, next);
      return { updateTime: new Date().toISOString(), transformResults };
    });
    return json(200, { writeResults, commitTime: new Date().toISOString() });
  }
  if (suffix === ":batchGet") {
    const { documents: names } = JSON.parse(String(init?.body)) as { documents: string[] };
    return json(200, names.map((name) => (documents.has(name) ? { found: { name, fields: documents.get(name) } } : { missing: name })));
  }
  if (suffix === "/mail" && init?.method === "POST") {
    const name = `${prefix}mail/${crypto.randomUUID()}`;
    documents.set(name, (JSON.parse(String(init.body)) as { fields: Record<string, Value> }).fields);
    return json(200, { name, fields: documents.get(name) });
  }
  const name = prefix + suffix.slice(1);
  return documents.has(name) ? json(200, { name, fields: documents.get(name) }) : json(404, { error: { status: "NOT_FOUND" } });
}

before(async () => {
  mock = await startMockAnthropic();
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const account = {
    project_id: "demo-rtsai",
    client_email: "hosted-ai@demo-rtsai.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  process.env.RTSAI_AI_FIREBASE_SERVICE_ACCOUNT = Buffer.from(JSON.stringify(account)).toString("base64");
  globalThis.fetch = fakeFetch as typeof fetch;
});

after(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.RTSAI_AI_FIREBASE_SERVICE_ACCOUNT;
  await mock.close();
});

const installId = "6f1d2a43-3a0e-4f8e-9a51-8f7c2f0c1b11";
const day = "2026-10-02";
const limits = { installMicros: 10_000, globalMicros: 1_000_000, perMinute: 3 };

test("installs are created once and limited per hashed IP", async () => {
  const store = new FirestoreUsageStore();
  const record = { installId, createdAt: Date.parse("2026-10-02T12:00:00Z"), linkedUid: null, revoked: false };
  assert.equal(await store.createInstall(record, "iphash", day, 2), true);
  assert.equal(await store.createInstall({ ...record, installId: "6f1d2a43-3a0e-4f8e-9a51-8f7c2f0c1b12" }, "iphash", day, 2), true);
  assert.equal(await store.createInstall({ ...record, installId: "6f1d2a43-3a0e-4f8e-9a51-8f7c2f0c1b13" }, "iphash", day, 2), false);
  const counter = documents.get(`projects/demo-rtsai/databases/(default)/documents/aiInstallIps/iphash_${day}`);
  assert.equal(counter?.count.integerValue, "2", "the rejected install is rolled back");
  assert.ok(counter?.expireAt.timestampValue, "counters carry a TTL field");

  assert.deepEqual(await store.getInstall(installId), { ...record });
  assert.equal(await store.linkInstall(installId, "firebase-uid"), true);
  assert.equal((await store.getInstall(installId))?.linkedUid, "firebase-uid");
  assert.equal(await store.linkInstall("6f1d2a43-3a0e-4f8e-9a51-8f7c2f0c1b99", "firebase-uid"), false);
  assert.equal(await store.getInstall("6f1d2a43-3a0e-4f8e-9a51-8f7c2f0c1b99"), null);
});

test("reservations increment atomically, roll back over the limit and settle to the real cost", async () => {
  const store = new FirestoreUsageStore();
  assert.deepEqual(await store.reserve(installId, day, "202610021200", 6_000, limits), { ok: true, installMicros: 6_000, globalMicros: 6_000 });
  const denied = await store.reserve(installId, day, "202610021200", 6_000, limits);
  assert.equal(denied.ok, false);
  assert.equal(!denied.ok && denied.reason, "allowance");
  assert.deepEqual(await store.usage(installId, day), { installMicros: 6_000, globalMicros: 6_000, calls: 0 });

  await store.settle(installId, day, 6_000, { costMicros: 1_250, inputTokens: 1_000, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 });
  assert.deepEqual(await store.usage(installId, day), { installMicros: 1_250, globalMicros: 1_250, calls: 1 });
  const usage = documents.get(`projects/demo-rtsai/databases/(default)/documents/aiUsage/${installId}_${day}`);
  assert.equal(usage?.inputTokens.integerValue, "1000");
  assert.equal(usage?.spentMicros.integerValue, "1250");

  assert.equal((await store.reserve(installId, day, "202610021201", 100, limits)).ok, true);
  assert.equal((await store.reserve(installId, day, "202610021201", 100, limits)).ok, true);
  assert.equal((await store.reserve(installId, day, "202610021201", 100, limits)).ok, true);
  const limited = await store.reserve(installId, day, "202610021201", 100, limits);
  assert.equal(!limited.ok && limited.reason, "rate_limited");

  assert.deepEqual(tokenRequests, ["urn:ietf:params:oauth:grant-type:jwt-bearer"], "the access token is cached");
  assert.deepEqual([...authorizations], ["Bearer fake-access-token"]);
});

const documentsRoot = "projects/demo-rtsai/databases/(default)/documents";
const mailDocuments = () => [...documents.entries()].filter(([name]) => name.startsWith(`${documentsRoot}/mail/`)).map(([, fields]) => fields);
type MailFields = { to: { arrayValue: { values: Value[] } }; message: { mapValue: { fields: Record<string, Value> } } };

test("settlement reports today's global spend, and spend alerts are claimed once per day and threshold", async () => {
  const store = new FirestoreUsageStore();
  const alertDay = "2026-10-03";
  await store.reserve(installId, alertDay, "202610031200", 2_000, limits);
  assert.deepEqual(await store.settle(installId, alertDay, 2_000, { costMicros: 700, inputTokens: 500, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 }), { globalSpentMicros: 700 });
  assert.deepEqual(await store.settle(installId, alertDay, 0, { costMicros: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), { globalSpentMicros: null }, "a failed upstream call settles without spend");

  const claim = { spentMicros: 5_000_000, capMicros: 10_000_000, claimedAt: Date.parse("2026-10-03T15:00:00Z") };
  assert.equal(await store.claimSpendAlert(alertDay, 50, claim), true);
  assert.equal(await store.claimSpendAlert(alertDay, 50, claim), false, "the second claim is refused by the create-if-absent precondition");
  assert.equal(await new FirestoreUsageStore().claimSpendAlert(alertDay, 50, claim), false, "other instances see the same claim");
  const record = documents.get(`${documentsRoot}/aiSpendAlerts/${alertDay}_50`);
  assert.equal(record?.thresholdPercent.integerValue, "50");
  assert.equal(record?.spentMicros.integerValue, "5000000");
  assert.equal(record?.expireAt.timestampValue, "2026-12-02T00:00:00.000Z", "alert claims carry a TTL field");

  await store.releaseSpendAlert(alertDay, 50);
  assert.equal(documents.has(`${documentsRoot}/aiSpendAlerts/${alertDay}_50`), false);
  assert.equal(await store.claimSpendAlert(alertDay, 50, claim), true, "a released claim can be retried");
  assert.equal(await store.claimSpendAlert(alertDay, 80, claim), true, "each threshold has its own claim");
  assert.equal(await store.claimSpendAlert("2026-10-04", 50, claim), true, "and each day");
});

test("a chat call that crosses 50% of the cap queues exactly one alert in the Firebase mail collection", async () => {
  const NOW = Date.parse("2026-10-05T09:30:00Z");
  const day = utcDay(NOW);
  Object.assign(process.env, {
    ANTHROPIC_API_KEY: "test-placeholder-not-a-real-key",
    ANTHROPIC_BASE_URL: mock.url,
    RTSAI_AI_TOKEN_SECRET: "test-secret-0123456789abcdef0123456789abcdef",
    RTSAI_AI_STORE: "firestore",
    RTSAI_AI_GLOBAL_DAILY_CAP_USD: "1",
    MAIL_FIREBASE_PROJECT_ID: "demo-rtsai",
    MAIL_FIREBASE_API_KEY: "test-placeholder",
    FEEDBACK_ADMIN_EMAIL: "ops@example.com",
  });
  setHostedAiOverrides({ now: () => NOW });
  resetSpendAlertMemo();
  try {
    const registered = await install(new Request("https://rtsai.net/api/ai/v1/install", { method: "POST", headers: { "x-forwarded-for": "203.0.113.50" } }));
    assert.equal(registered.status, 201);
    const { token } = (await registered.json()) as { token: string };
    documents.set(`${documentsRoot}/aiSpend/${day}`, { chargedMicros: { integerValue: "499990" }, spentMicros: { integerValue: "499990" } });
    const ask = () => chatCompletions(new Request("https://rtsai.net/api/ai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5", messages: [{ role: "user", content: "Where is the enemy?" }] }),
    }));

    assert.equal((await ask()).status, 200);
    assert.equal(mailDocuments().length, 1);
    const mail = mailDocuments()[0] as unknown as MailFields;
    assert.deepEqual(mail.to.arrayValue.values, [{ stringValue: "ops@example.com" }]);
    assert.match(String(mail.message.mapValue.fields.subject.stringValue), /passed 50% of today's cap/);
    assert.equal(JSON.stringify(mail).includes("Where is the enemy?"), false, "player prompts never reach the alert");
    assert.ok(documents.has(`${documentsRoot}/aiSpendAlerts/${day}_50`));

    assert.equal((await ask()).status, 200);
    resetSpendAlertMemo();
    assert.equal((await ask()).status, 200);
    assert.equal(mailDocuments().length, 1, "later calls and fresh instances do not send it again");
  } finally {
    setHostedAiOverrides({});
    for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "RTSAI_AI_TOKEN_SECRET", "RTSAI_AI_STORE", "RTSAI_AI_GLOBAL_DAILY_CAP_USD", "MAIL_FIREBASE_PROJECT_ID", "MAIL_FIREBASE_API_KEY", "FEEDBACK_ADMIN_EMAIL"]) delete process.env[name];
  }
});
