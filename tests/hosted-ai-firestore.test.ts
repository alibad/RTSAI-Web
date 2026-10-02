import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { after, before, test } from "node:test";
import { FirestoreUsageStore } from "../lib/hosted-ai/firestore-store";

// The Firestore REST store runs against a small in-process fake of the
// documents API (commit with update masks, preconditions and increment
// transforms, batchGet, get) plus the OAuth token endpoint. It checks the
// request shapes and the increment-then-check accounting, not Google itself.

type Value = { integerValue?: string; stringValue?: string; booleanValue?: boolean; nullValue?: null; timestampValue?: string };
type Write = {
  update: { name: string; fields: Record<string, Value> };
  updateMask?: { fieldPaths: string[] };
  updateTransforms?: { fieldPath: string; increment: { integerValue: string } }[];
  currentDocument?: { exists: boolean };
};

const documents = new Map<string, Record<string, Value>>();
const tokenRequests: string[] = [];
const authorizations = new Set<string>();
const originalFetch = globalThis.fetch;

function json(status: number, value: unknown) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

async function fakeFetch(input: string | URL | Request, init?: RequestInit) {
  const url = String(input);
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
      const exists = documents.has(write.update.name);
      if (write.currentDocument?.exists === false && exists) return json(409, { error: { status: "ALREADY_EXISTS" } });
      if (write.currentDocument?.exists === true && !exists) return json(404, { error: { status: "NOT_FOUND" } });
    }
    const writeResults = writes.map((write) => {
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
  const name = prefix + suffix.slice(1);
  return documents.has(name) ? json(200, { name, fields: documents.get(name) }) : json(404, { error: { status: "NOT_FOUND" } });
}

before(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const account = {
    project_id: "demo-rtsai",
    client_email: "hosted-ai@demo-rtsai.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
  process.env.RTSAI_AI_FIREBASE_SERVICE_ACCOUNT = Buffer.from(JSON.stringify(account)).toString("base64");
  globalThis.fetch = fakeFetch as typeof fetch;
});

after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.RTSAI_AI_FIREBASE_SERVICE_ACCOUNT;
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
