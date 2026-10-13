// firestore.rules against the local emulators: what signed-in players may and may not do (counters, matchmaking,
// feedback files).
//   firebase emulators:start --only auth,firestore --project demo-rtsai     (Java 11+)
//   node tools/firestore-rules-test.mjs          (on a fresh emulator: it creates fixed match codes)
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

// ---- feedback files (app/components/feedback/report-files.ts): create-only by the reporter, read by admins only
const owner = { token: "owner" }; // the emulator's admin token, standing in for the Firebase console
const doc = path => `projects/${project}/databases/(default)/documents/${path}`;
const create = (who, path, fields, serverTime = []) => call(who, "POST", ":commit", { writes: [{ update: { name: doc(path), fields }, currentDocument: { exists: false }, updateTransforms: serverTime.map(fieldPath => ({ fieldPath, setToServerValue: "REQUEST_TIME" })) }] });
const str = v => ({ stringValue: v }), int = v => ({ integerValue: String(v) }), bytes = n => ({ bytesValue: Buffer.alloc(n, 7).toString("base64") });
const admin = await user(`admin${Date.now()}@test.dev`);
await expect("console makes an admin", true, () => call(owner, "PATCH", `/admins/${admin.uid}`, { fields: { note: str("rules test") } }));
const report = crypto.randomUUID(), R = `feedbackReports/${report}`, fid = "k3v9q2m8x1b7n4c6", other = "a1b2c3d4e5f6g7h8";
const reportFields = uid => ({ owner: str(uid), source: str("game") });
await expect("reporter creates their report", true, () => create(a, R, reportFields(a.uid), ["created"]));
await expect("report for someone else", false, () => create(a, `feedbackReports/${crypto.randomUUID()}`, reportFields(b.uid), ["created"]));
await expect("report with a made-up time", false, () => create(a, `feedbackReports/${crypto.randomUUID()}`, { ...reportFields(a.uid), created: ts(0) }));
await expect("report id that isn't a UUID", false, () => create(a, "feedbackReports/not-a-uuid", reportFields(a.uid), ["created"]));
await expect("report with extra fields", false, () => create(a, `feedbackReports/${crypto.randomUUID()}`, { ...reportFields(a.uid), admin: { booleanValue: true } }, ["created"]));
await expect("anonymous visitor files a report", false, () => create(anon, `feedbackReports/${crypto.randomUUID()}`, reportFields(anon.uid), ["created"]));
await expect("signed-out visitor files a report", false, () => create(null, `feedbackReports/${crypto.randomUUID()}`, reportFields("x"), ["created"]));
await expect("report rewritten", false, () => call(a, "PATCH", `/${R}`, { fields: reportFields(a.uid) }));
await expect("reporter writes a 900 KiB chunk", true, () => create(a, `${R}/chunks/${fid}_0`, { data: bytes(921600) }));
await expect("chunk over 900 KiB", false, () => create(a, `${R}/chunks/${other}_0`, { data: bytes(921601) }));
await expect("13th chunk of a file", false, () => create(a, `${R}/chunks/${other}_12`, { data: bytes(10) }));
await expect("chunk that isn't bytes", false, () => create(a, `${R}/chunks/${other}_1`, { data: str("text") }));
await expect("chunk with extra fields", false, () => create(a, `${R}/chunks/${other}_2`, { data: bytes(10), note: str("x") }));
await expect("someone else adds a chunk", false, () => create(b, `${R}/chunks/${other}_0`, { data: bytes(10) }));
await expect("chunk rewritten", false, () => call(a, "PATCH", `/${R}/chunks/${fid}_0`, { fields: { data: bytes(10) } }));
const file = (extra = {}) => ({ name: str("screenshot-1.jpg"), kind: str("screenshot"), contentType: str("image/jpeg"), bytes: int(921600), chunks: int(1), ...extra });
await expect("reporter records the file", true, () => create(a, `${R}/files/${fid}`, file(), ["created"]));
await expect("a second chunk for the next file", true, () => create(a, `${R}/chunks/${other}_0`, { data: bytes(100) }));
await expect("file whose chunks aren't there", false, () => create(a, `${R}/files/zzzzzzzzzzzzzzzz`, file({ bytes: int(100) }), ["created"]));
await expect("file larger than its chunks", false, () => create(a, `${R}/files/${other}`, file({ bytes: int(921601) }), ["created"]));
await expect("file over 10 MB", false, () => create(a, `${R}/files/${other}`, file({ bytes: int(10485761), chunks: int(12) }), ["created"]));
await expect("HTML file", false, () => create(a, `${R}/files/${other}`, file({ kind: str("file"), contentType: str("text/html"), bytes: int(100) }), ["created"]));
await expect("screenshot that isn't an image", false, () => create(a, `${R}/files/${other}`, file({ contentType: str("audio/webm"), bytes: int(100) }), ["created"]));
await expect("voice note over 10 minutes", false, () => create(a, `${R}/files/${other}`, file({ kind: str("voice"), contentType: str("audio/webm"), bytes: int(100), durationSeconds: int(601) }), ["created"]));
await expect("file with a made-up time", false, () => create(a, `${R}/files/${other}`, file({ bytes: int(100), created: ts(0) })));
await expect("someone else records a file", false, () => create(b, `${R}/files/${other}`, file({ bytes: int(100) }), ["created"]));
await expect("voice note record", true, () => create(a, `${R}/files/${other}`, file({ name: str("voice-note.webm"), kind: str("voice"), contentType: str("audio/webm"), bytes: int(100), durationSeconds: int(42) }), ["created"]));
await expect("reporter reads their report back", false, () => call(a, "GET", `/${R}`));
await expect("reporter lists the files", false, () => call(a, "GET", `/${R}/files`));
await expect("reporter reads a chunk", false, () => call(a, "GET", `/${R}/chunks/${fid}_0`));
await expect("another player reads the report", false, () => call(b, "GET", `/${R}`));
await expect("listing all reports", false, () => call(b, "GET", "/feedbackReports"));
await expect("admin reads the report", true, () => call(admin, "GET", `/${R}`));
const listed = await expect("admin lists its files", true, () => call(admin, "GET", `/${R}/files`));
assert.equal(listed.body.documents.length, 2);
const chunk = await expect("admin reads a chunk", true, () => call(admin, "GET", `/${R}/chunks/${fid}_0`));
assert.equal(Buffer.from(chunk.body.fields.data.bytesValue, "base64").length, 921600);
await expect("reporter edits the report", false, () => call(a, "PATCH", `/${R}?updateMask.fieldPaths=source`, { fields: { source: str("web") } }));
await expect("reporter deletes a file", false, () => call(a, "DELETE", `/${R}/files/${fid}`));
await expect("admin deletes the report from the browser", false, () => call(admin, "DELETE", `/${R}`));
await expect("player makes themself an admin", false, () => call(a, "PATCH", `/admins/${a.uid}`, { fields: { note: str("me") } }));
await expect("admin reads the admin list", false, () => call(admin, "GET", `/admins/${admin.uid}`));

// ---- saved maps (lib/saved-maps.ts): created together by their owner; any member reads one by id; the owner lists
const mapIdOf = n => `earth-${String(n).repeat(16).slice(0, 16)}`;
const newMapDoc = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), v => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[v % 62]).join("");
const mapFields = (uid, extra = {}) => ({ owner: str(uid), mapId: str(mapIdOf(1)), title: str("Istanbul strait"), place: str("Istanbul, Türkiye"),
  latitude: { doubleValue: 41.025 }, longitude: { doubleValue: 29 }, radius: int(3500), seed: int(42), size: int(64), players: int(2), preview: bytes(5000), ...extra });
const dataFields = (uid, extra = {}) => ({ owner: str(uid), mapId: str(mapIdOf(1)), yaml: str("MapFormat: 12\n"), bin: bytes(17 + 6 * 64 * 128), ...extra });
const saveMap = (who, id, map, data) => call(who, "POST", ":commit", { writes: [
  ...(data ? [{ update: { name: doc(`mapData/${id}`), fields: data }, currentDocument: { exists: false } }] : []),
  ...(map ? [{ update: { name: doc(`maps/${id}`), fields: map }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: "created", setToServerValue: "REQUEST_TIME" }] }] : []),
] });
const M = newMapDoc();
await expect("player saves a map", true, () => saveMap(a, M, mapFields(a.uid), dataFields(a.uid)));
await expect("map without its data", false, () => saveMap(a, newMapDoc(), mapFields(a.uid), null));
await expect("data without its map", false, () => saveMap(a, newMapDoc(), null, dataFields(a.uid)));
await expect("map saved for someone else", false, () => saveMap(a, newMapDoc(), mapFields(b.uid), dataFields(b.uid)));
await expect("map and data that disagree", false, () => saveMap(a, newMapDoc(), mapFields(a.uid), dataFields(a.uid, { mapId: str(mapIdOf(2)) })));
await expect("map id that isn't a content id", false, () => saveMap(a, newMapDoc(), mapFields(a.uid, { mapId: str("earth-xyz") }), dataFields(a.uid, { mapId: str("earth-xyz") })));
await expect("map with extra fields", false, () => saveMap(a, newMapDoc(), mapFields(a.uid, { public: { booleanValue: true } }), dataFields(a.uid)));
await expect("map of an unsupported size", false, () => saveMap(a, newMapDoc(), mapFields(a.uid, { size: int(128) }), dataFields(a.uid)));
await expect("map data over the largest map", false, () => saveMap(a, newMapDoc(), mapFields(a.uid), dataFields(a.uid, { bin: bytes(76818) })));
await expect("preview over 128 KiB", false, () => saveMap(a, newMapDoc(), mapFields(a.uid, { preview: bytes(131073) }), dataFields(a.uid)));
await expect("map document id that isn't 20 letters", false, () => saveMap(a, "short", mapFields(a.uid), dataFields(a.uid)));
await expect("anonymous visitor saves a map", false, () => saveMap(anon, newMapDoc(), mapFields(anon.uid), dataFields(anon.uid)));
await expect("another player reads the map by id", true, () => call(b, "GET", `/maps/${M}`));
await expect("another player reads its data by id", true, () => call(b, "GET", `/mapData/${M}`));
await expect("signed-out visitor reads a map", false, () => call(null, "GET", `/maps/${M}`));
const own = await expect("owner lists their maps", true, () => call(a, "POST", ":runQuery", { structuredQuery: { from: [{ collectionId: "maps" }], where: { fieldFilter: { field: { fieldPath: "owner" }, op: "EQUAL", value: str(a.uid) } } } }));
assert.equal(own.body.filter(r => r.document).length, 1);
await expect("player lists someone else's maps", false, () => call(b, "POST", ":runQuery", { structuredQuery: { from: [{ collectionId: "maps" }], where: { fieldFilter: { field: { fieldPath: "owner" }, op: "EQUAL", value: str(a.uid) } } } }));
await expect("player lists every map", false, () => call(b, "GET", "/maps"));
await expect("player lists map data", false, () => call(a, "GET", "/mapData"));
await expect("owner renames their map", true, () => call(a, "PATCH", `/maps/${M}?updateMask.fieldPaths=title`, { fields: { title: str("The strait") } }));
await expect("owner changes their map's size", false, () => call(a, "PATCH", `/maps/${M}?updateMask.fieldPaths=size`, { fields: { size: int(80) } }));
await expect("owner rewrites the map data", false, () => call(a, "PATCH", `/mapData/${M}?updateMask.fieldPaths=yaml`, { fields: { yaml: str("x") } }));
await expect("another player renames it", false, () => call(b, "PATCH", `/maps/${M}?updateMask.fieldPaths=title`, { fields: { title: str("mine") } }));
await expect("another player deletes it", false, () => call(b, "DELETE", `/maps/${M}`));
await expect("owner deletes the map", true, () => call(a, "DELETE", `/maps/${M}`));
await expect("owner deletes its data", true, () => call(a, "DELETE", `/mapData/${M}`));

// ---- outgoing mail (lib/firebase-mail.ts): sendMail's exact shape (the Trigger Email contract), to the team group only
const mail = (to, message = {}) => ({ fields: { to: { arrayValue: { values: to.map(str) } }, message: { mapValue: { fields: { subject: str("[RTS AI] New player"), html: str("<p>Hi</p>"), text: str("Hi"), ...message } } } } });
await expect("player's request mails the team group", true, () => call(a, "POST", "/mail", mail(["rtsai@googlegroups.com"])));
await expect("server job mails the team group anonymously", true, () => call(anon, "POST", "/mail", mail(["rtsai@googlegroups.com"])));
await expect("mail to anyone else", false, () => call(a, "POST", "/mail", mail(["someone@example.com"])));
await expect("mail to the group and someone else", false, () => call(a, "POST", "/mail", mail(["rtsai@googlegroups.com", "someone@example.com"])));
await expect("mail with a hidden copy", false, () => call(a, "POST", "/mail", { fields: { ...mail(["rtsai@googlegroups.com"]).fields, bcc: { arrayValue: { values: [str("someone@example.com")] } } } }));
await expect("mail with an attachment field", false, () => call(a, "POST", "/mail", mail(["rtsai@googlegroups.com"], { attachments: str("x") })));
await expect("mail over the size limit", false, () => call(a, "POST", "/mail", mail(["rtsai@googlegroups.com"], { html: str("x".repeat(32768)) })));
await expect("signed-out visitor sends mail", false, () => call(null, "POST", "/mail", mail(["rtsai@googlegroups.com"])));
await expect("player reads the mail queue", false, () => call(a, "GET", "/mail"));

console.log(results.map(r => `${r.ok ? "PASS" : "FAIL"} ${r.label} (${r.status})`).join("\n"));
console.log(`\n${results.filter(r => r.ok).length}/${results.length} rules checks passed`);
