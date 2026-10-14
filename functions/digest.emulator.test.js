// Rollups and the weekly digest end to end on the local emulators: signed-in players' events go through recordEvent
// into dailyStats (counters, unique players, a match end credited to its start's faction, grouped errors), callers
// that aren't players are turned away, and sendDigestNow turns the week into one email to the team group that
// reaches a local SMTP server (standing in for mail.humanquest.net) with its delivery record written back.
// Needs (functions/.env.local: SMTP_URI=smtp://tester@127.0.0.1:2526; functions/.secret.local: SMTP_PASSWORD=test), from RTSAI-Web:
//   firebase emulators:start --only functions,firestore,auth --project demo-rtsai
//   node --test functions/digest.emulator.test.js   (FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, FUNCTIONS_EMULATOR_HOST,
//                                                    SMTP_SINK_PORT for other ports; DIGEST_PREVIEW_OUT=<file> keeps the HTML)
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import test from "node:test";
import { SMTPServer } from "smtp-server";
import { qatarDate } from "./rollup.js";

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const functions = `http://${process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001"}/demo-rtsai/europe-west1`;
const smtpPort = Number(process.env.SMTP_SINK_PORT ?? 2526);
const firestore = `http://${firestoreHost}/v1/projects/demo-rtsai/databases/(default)/documents`;
const up = await fetch(`${functions}/recordEvent`, { method: "GET" }).then((r) => r.status === 405, () => false);

const owner = { Authorization: "Bearer owner" };
const json = (r) => r.json();
async function player(email) {
  const body = email ? { email, password: "test-password-1", returnSecureToken: true } : { returnSecureToken: true };
  const r = await json(await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { uid: r.localId, token: r.idToken };
}
const record = (who, name, props = {}) => fetch(`${functions}/recordEvent`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(who ? { Authorization: `Bearer ${who.token}` } : {}) }, body: JSON.stringify({ name, props }),
});
/** A Firestore REST document as plain values. */
function plain(value) {
  if (!value) return undefined;
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([k, v]) => [k, plain(v)]));
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(plain);
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  return value.stringValue ?? value.booleanValue ?? value.timestampValue ?? null;
}
const read = async (path) => { const r = await fetch(`${firestore}/${path}`, { headers: owner }); return r.ok ? plain({ mapValue: await r.json() }) : null; };
const at = (doc, path) => path.split(".").reduce((o, k) => o?.[k], doc) ?? 0;

test("events roll up into the Doha day, and the digest reaches the team group", { skip: !up && "emulators not running" }, async () => {
  const received = [];
  const smtp = new SMTPServer({
    secure: false, allowInsecureAuth: true, disabledCommands: ["STARTTLS"],
    onAuth: (auth, _s, done) => (auth.username === "tester" && auth.password === "test" ? done(null, { user: "tester" }) : done(new Error("bad login"))),
    onData: (stream, session, done) => { let raw = ""; stream.on("data", (c) => { raw += c; }); stream.on("end", () => { received.push({ to: session.envelope.rcptTo.map((r) => r.address), raw }); done(); }); },
  });
  await new Promise((resolve, reject) => { smtp.on("error", reject); smtp.listen(smtpPort, "127.0.0.1", resolve); });
  try {
    const today = qatarDate(), day = `dailyStats/${today}`;
    const before = (await read(day)) ?? {};
    const a = await player(`digest-a${Date.now()}@test.dev`), b = await player(`digest-b${Date.now()}@test.dev`), anon = await player();

    for (const [who, name, props] of [
      [a, "sign_up", { method: "password" }],
      [a, "game_loaded", { mode: "isometric", seconds: 5.5, gpu: "software" }],
      [a, "match_started", { kind: "skirmish", mode: "isometric", map: "gen-4821", faction: "russia", players: 2 }],
      [a, "match_ended", { kind: "skirmish", result: "won", minutes: 12.5, mode: "isometric" }],
      [a, "game_error", { where: "runtime", message: "Synchronization mismatch at frame 812" }],
      [a, "game_error", { where: "runtime", message: "Synchronization mismatch at frame 97" }],
      [b, "match_started", { kind: "campaign", mode: "classic", map: "lines-of-hope-01", faction: "america", junk: "x".repeat(200) }],
      [b, "feedback_sent", { category: "Bug", source: "game" }],
    ]) {
      const r = await record(who, name, props);
      assert.equal(r.status, 200, `${name}: ${await r.clone().text()}`);
      assert.equal((await r.json()).date, today);
    }
    assert.equal((await record(anon, "match_started")).status, 403, "anonymous users aren't players");
    assert.equal((await record(null, "match_started")).status, 401, "callers must be signed in");
    assert.equal((await record(a, "drop_tables")).status, 400, "only known events");

    const after = await read(day), delta = (path) => at(after, path) - at(before, path);
    assert.equal(after.timeZone, "Asia/Qatar");
    assert.equal(delta("players"), 2, "two new players today");
    assert.equal(delta("events.match_started"), 2);
    assert.equal(delta("started.kind.skirmish"), 1); assert.equal(delta("started.kind.campaign"), 1);
    assert.equal(delta("started.faction.russia"), 1); assert.equal(delta("started.map.random"), 1); assert.equal(delta("started.map.campaign"), 1);
    assert.equal(delta("ended.faction.russia"), 1, "the end is credited to the faction the match started with");
    assert.equal(delta("finished.won"), 1); assert.equal(delta("ended.minutes"), 12.5);
    assert.equal(delta("loaded.gpu.software"), 1); assert.equal(delta("signups.method.password"), 1);
    assert.equal(delta("feedback.category.bug"), 1); assert.equal(delta("feedback.source.game"), 1);
    assert.equal(delta("events.game_error"), 2);
    assert.ok(!JSON.stringify(after).includes("junk"), "props outside the whitelist never reach the day");
    const mine = await read(`${day}/players/${a.uid}`);
    assert.equal(mine.events, 6); assert.equal(mine.lastStart.faction, "russia");
    const errors = await (await fetch(`${firestore}/${day}/errors`, { headers: owner })).json();
    const sync = errors.documents.map((d) => plain({ mapValue: d })).find((e) => e.message.startsWith("Synchronization mismatch"));
    assert.ok(sync.count >= 2, "both frames group under one error");

    // Players can't read or write the rollups themselves: dailyStats has no client rule.
    assert.equal((await fetch(`${firestore}/${day}`, { headers: { Authorization: `Bearer ${a.token}` } })).status, 403);
    assert.equal((await fetch(`${firestore}/${day}?updateMask.fieldPaths=players`, { method: "PATCH", headers: { Authorization: `Bearer ${a.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields: { players: { integerValue: "999" } } }) })).status, 403);

    await fetch(`${firestore}/stats/global`, { method: "PATCH", headers: { ...owner, "Content-Type": "application/json" }, body: JSON.stringify({ fields: { players: { integerValue: "41" }, matches: { integerValue: "1234" }, multiplayer: { integerValue: "7" }, aiAssists: { integerValue: "88" } } }) });

    const preview = await fetch(`${functions}/sendDigestNow?preview=1`);
    assert.equal(preview.status, 200, await preview.clone().text());
    const html = await preview.text();
    assert.match(html, /RTS AI · WEEKLY/); assert.match(html, /1,234/); assert.match(html, /Synchronization mismatch/);
    assert.match(decodeURIComponent(preview.headers.get("x-digest-subject")), /^RTS AI week of \d+ \w+: \d+ players?, \d+ match(es)?/);
    if (process.env.DIGEST_PREVIEW_OUT) await writeFile(process.env.DIGEST_PREVIEW_OUT, html);

    const sent = await fetch(`${functions}/sendDigestNow`, { method: "POST" });
    const result = await sent.json();
    assert.equal(sent.status, 200, JSON.stringify(result));
    assert.equal(result.state, "SUCCESS");
    const mail = await read(`mail/${result.id}`);
    assert.deepEqual(mail.to, ["rtsai@googlegroups.com"]);
    assert.equal(mail.message.subject, result.subject);
    assert.equal(mail.delivery.state, "SUCCESS");
    assert.deepEqual(mail.delivery.info.accepted, ["rtsai@googlegroups.com"]);
    const email = received.find((m) => m.raw.includes("RTS AI week of"));
    assert.ok(email, "the SMTP server received the digest");
    assert.deepEqual(email.to, ["rtsai@googlegroups.com"]);
    assert.match(email.raw, /From: RTS AI <info@humanquest\.net>/);
    assert.match(email.raw, /multipart\/alternative/); assert.match(email.raw, /text\/plain/); assert.match(email.raw, /text\/html/);
  } finally {
    await new Promise((resolve) => smtp.close(resolve));
  }
});
