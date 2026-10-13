// firestore.rules against the local emulators: what signed-in players may and may not do.
//   firebase emulators:start --only auth,firestore --project demo-rtsai     (Java 11+)
//   node tools/firestore-rules-test.mjs
// Then the same counters through the real writer: FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 is set below.
import assert from "node:assert/strict";

const project = "demo-rtsai", auth = "http://127.0.0.1:9099", fs = `http://127.0.0.1:8085/v1/projects/${project}/databases/(default)/documents`;
const results = [];
async function user(email) {
  const r = await fetch(`${auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(email ? { email, password: "test-password-1", returnSecureToken: true } : { returnSecureToken: true }) });
  const d = await r.json(); if (!d.idToken) throw Error(JSON.stringify(d)); return { uid: d.localId, token: d.idToken };
}
const call = async (who, method, path, body) => {
  const r = await fetch(`${fs}${path}`, { method, headers: { "Content-Type": "application/json", ...(who ? { Authorization: `Bearer ${who.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
async function expect(label, allowed, request) {
  const r = await request();
  const ok = allowed ? r.status === 200 : r.status === 403;
  results.push({ label, ok, status: r.status });
  assert.ok(ok, `${label}: expected ${allowed ? "allowed" : "denied"}, got ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r;
}
const bump = (who, doc, field, extra = []) => call(who, "POST", ":commit", { writes: [{ update: { name: `projects/${project}/databases/(default)/documents/${doc}`, fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: field, increment: { integerValue: "1" } }, ...extra] }] });
const now = { fieldPath: "lastSeen", setToServerValue: "REQUEST_TIME" };
const ts = minutes => ({ timestampValue: new Date(Date.now() + minutes * 60000).toISOString() });

const a = await user(`a${Date.now()}@test.dev`), b = await user(`b${Date.now()}@test.dev`), c = await user(`c${Date.now()}@test.dev`), anon = await user();

// ---- counters
const first = await expect("player bumps own counter (creates doc)", true, () => bump(a, `players/${a.uid}`, "matches", [now]));
assert.equal(first.body.writeResults[0].transformResults[0].integerValue, "1");
const second = await expect("player bumps again", true, () => bump(a, `players/${a.uid}`, "matches", [now]));
assert.equal(second.body.writeResults[0].transformResults[0].integerValue, "2");
await expect("player bumps someone else's doc", false, () => bump(b, `players/${a.uid}`, "matches", [now]));
await expect("player bumps without lastSeen", false, () => bump(a, `players/${a.uid}`, "matches"));
await expect("player bumps an unknown counter", false, () => bump(a, `players/${a.uid}`, "gold", [now]));
await expect("player sets a counter directly", false, () => call(a, "PATCH", `/players/${a.uid}?updateMask.fieldPaths=matches`, { fields: { matches: { integerValue: "500" } } }));
await expect("player bumps two counters at once", false, () => bump(a, `players/${a.uid}`, "matches", [now, { fieldPath: "errors", increment: { integerValue: "1" } }]));
await expect("player adds 5", false, () => call(a, "POST", ":commit", { writes: [{ update: { name: `projects/${project}/databases/(default)/documents/players/${a.uid}`, fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: "matches", increment: { integerValue: "5" } }, now] }] }));
await expect("player reads own counters", true, () => call(a, "GET", `/players/${a.uid}`));
await expect("player reads someone else's counters", false, () => call(b, "GET", `/players/${a.uid}`));
await expect("overall counter +1", true, () => bump(a, "stats/global", "matches"));
await expect("overall counter unknown field", false, () => bump(a, "stats/global", "gold"));
await expect("overall counter decrement", false, () => call(a, "POST", ":commit", { writes: [{ update: { name: `projects/${project}/databases/(default)/documents/stats/global`, fields: {} }, updateMask: { fieldPaths: [] }, updateTransforms: [{ fieldPath: "matches", increment: { integerValue: "-1" } }] }] }));
await expect("anonymous visitor counts", false, () => bump(anon, `players/${anon.uid}`, "matches", [now]));
await expect("signed-out visitor counts", false, () => bump(null, "stats/global", "matches"));
await expect("hosted AI data stays server-only", false, () => call(a, "GET", "/aiSpend/2026-10-13"));

// ---- matchmaking
const code = "K7Q4MX" + "", match = { fields: { host: { stringValue: a.uid }, version: { stringValue: "p2p-1:test" }, expires: ts(60) } };
await expect("host creates a match", true, () => call(a, "PATCH", `/p2pMatches/${code}?currentDocument.exists=false`, match));
await expect("match code must be 6 safe letters", false, () => call(a, "PATCH", `/p2pMatches/k7q4mx?currentDocument.exists=false`, match));
await expect("match for someone else", false, () => call(b, "PATCH", `/p2pMatches/ABCDEF?currentDocument.exists=false`, { fields: { ...match.fields, host: { stringValue: c.uid } } }));
await expect("match that never expires", false, () => call(a, "PATCH", `/p2pMatches/ABCDEG?currentDocument.exists=false`, { fields: { ...match.fields, expires: ts(600) } }));
await expect("overwrite someone's match", false, () => call(b, "PATCH", `/p2pMatches/${code}`, { fields: { ...match.fields, host: { stringValue: b.uid } } }));
await expect("anyone signed in reads a match by code", true, () => call(b, "GET", `/p2pMatches/${code}`));
await expect("listing all matches", false, () => call(b, "GET", `/p2pMatches`));
const join = { fields: { guest: { stringValue: b.uid }, offer: { stringValue: "v=0\r\nm=application" }, expires: ts(30) } };
await expect("guest posts an offer", true, () => call(b, "PATCH", `/p2pMatches/${code}/joins/join-b?currentDocument.exists=false`, join));
await expect("guest posts an offer as someone else", false, () => call(c, "PATCH", `/p2pMatches/${code}/joins/join-c?currentDocument.exists=false`, join));
await expect("offer to a match that doesn't exist", false, () => call(b, "PATCH", `/p2pMatches/ZZZZZZ/joins/join-b?currentDocument.exists=false`, join));
await expect("host lists offers", true, () => call(a, "GET", `/p2pMatches/${code}/joins`));
await expect("stranger lists offers", false, () => call(c, "GET", `/p2pMatches/${code}/joins`));
await expect("stranger reads an offer", false, () => call(c, "GET", `/p2pMatches/${code}/joins/join-b`));
await expect("host answers", true, () => call(a, "PATCH", `/p2pMatches/${code}/joins/join-b?updateMask.fieldPaths=answer`, { fields: { answer: { stringValue: "v=0\r\nm=application answer" } } }));
await expect("guest reads the answer", true, () => call(b, "GET", `/p2pMatches/${code}/joins/join-b`));
await expect("stranger forges an answer", false, () => call(c, "PATCH", `/p2pMatches/${code}/joins/join-b?updateMask.fieldPaths=answer`, { fields: { answer: { stringValue: "v=0 evil" } } }));
await expect("guest edits their answer", false, () => call(b, "PATCH", `/p2pMatches/${code}/joins/join-b?updateMask.fieldPaths=answer`, { fields: { answer: { stringValue: "v=0 x" } } }));
await expect("host rewrites the offer", false, () => call(a, "PATCH", `/p2pMatches/${code}/joins/join-b?updateMask.fieldPaths=offer`, { fields: { offer: { stringValue: "v=0 x" } } }));
await expect("anonymous visitor reads a match", false, () => call(anon, "GET", `/p2pMatches/${code}`));
await expect("guest deletes the match", false, () => call(b, "DELETE", `/p2pMatches/${code}`));
await expect("host closes the match", true, () => call(a, "DELETE", `/p2pMatches/${code}`));

console.log(results.map(r => `${r.ok ? "PASS" : "FAIL"} ${r.label} (${r.status})`).join("\n"));
console.log(`\n${results.filter(r => r.ok).length}/${results.length} rules checks passed`);
