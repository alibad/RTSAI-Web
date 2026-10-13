// sendMail end to end on the local emulators: a signed-in player writes a mail document (through firestore.rules), calls
// the function with its id, and the email reaches a local SMTP server (standing in for mail.humanquest.net) with the
// delivery record written back; a second call never sends again, a refused recipient is recorded as ERROR, and a
// caller who isn't signed in is turned away.
// Needs (functions/.env.local: SMTP_URI=smtp://tester@127.0.0.1:2526; functions/.secret.local: SMTP_PASSWORD=test), from RTSAI-Web:
//   firebase emulators:start --only functions,firestore,auth --project demo-rtsai
//   node --test functions/sendmail.emulator.test.js      (FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, FUNCTIONS_EMULATOR_HOST for other ports)
import assert from "node:assert/strict";
import test from "node:test";
import { SMTPServer } from "smtp-server";

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const functionUrl = `http://${process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001"}/demo-rtsai/europe-west1/sendMail`;
const firestore = `http://${firestoreHost}/v1/projects/demo-rtsai/databases/(default)/documents`;
const up = await fetch(functionUrl, { method: "GET" }).then(() => true, () => false);

test("sendMail sends a player's mail document over SMTP and records the outcome", { skip: !up && "emulators not running" }, async () => {
  const received = [];
  const smtp = new SMTPServer({
    secure: false, allowInsecureAuth: true, disabledCommands: ["STARTTLS"],
    onAuth: (auth, _s, done) => (auth.username === "tester" && auth.password === "test" ? done(null, { user: "tester" }) : done(new Error("bad login"))),
    onRcptTo: (address, _s, done) => (address.address.endsWith("@refused.test") ? done(new Error("No such mailbox")) : done()),
    onData: (stream, session, done) => { let raw = ""; stream.on("data", (c) => { raw += c; }); stream.on("end", () => { received.push({ to: session.envelope.rcptTo.map((r) => r.address), raw }); done(); }); },
  });
  await new Promise((resolve, reject) => { smtp.on("error", reject); smtp.listen(2526, "127.0.0.1", resolve); });
  const signUp = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `mailer${Date.now()}@test.dev`, password: "test-password-1", returnSecureToken: true }) });
  const { idToken } = await signUp.json();
  const queue = async (to, subject, token = idToken) => {
    const r = await fetch(`${firestore}/mail`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { to: { arrayValue: { values: [{ stringValue: to }] } }, message: { mapValue: { fields: { subject: { stringValue: subject }, text: { stringValue: "Plain body" }, html: { stringValue: "<p>HTML body</p>" } } } } } }) });
    return (await r.json()).name?.split("/").pop();
  };
  const call = (id, token = idToken) => fetch(functionUrl, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ id }) });
  const delivery = async (id) => (await (await fetch(`${firestore}/mail/${id}`, { headers: { Authorization: "Bearer owner" } })).json()).fields?.delivery?.mapValue?.fields;
  try {
    const id = await queue("rtsai@googlegroups.com", "[RTS AI] Function test");
    assert.ok(id, "the rules accept the player's mail to the team group");
    const first = await call(id);
    assert.equal(first.status, 200, await first.clone().text());
    assert.equal((await first.json()).state, "SUCCESS");
    const sent = await delivery(id);
    assert.equal(sent.state.stringValue, "SUCCESS");
    assert.deepEqual(sent.info.mapValue.fields.accepted.arrayValue.values.map((v) => v.stringValue), ["rtsai@googlegroups.com"]);
    const mail = received.find((m) => m.raw.includes("[RTS AI] Function test"));
    assert.ok(mail, "the SMTP server received it");
    assert.match(mail.raw, /From: RTS AI <info@humanquest\.net>/);
    assert.match(mail.raw, /Reply-To: ali@humanquest\.net/);

    assert.equal((await (await call(id)).json()).state, "ALREADY_CLAIMED");
    assert.equal(received.filter((m) => m.raw.includes("[RTS AI] Function test")).length, 1, "a second call doesn't send again");
    assert.equal((await call(id, "")).status, 401, "callers must be signed in");
    assert.equal((await call("../players/x")).status, 400);

    const refused = await queue("rtsai@googlegroups.com", "[RTS AI] Refused test");
    // The rules only accept the group, so a refused send is simulated by an owner-written document to a refused address.
    const bad = await (await fetch(`${firestore}/mail`, { method: "POST", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { to: { arrayValue: { values: [{ stringValue: "nobody@refused.test" }] } }, message: { mapValue: { fields: { subject: { stringValue: "[RTS AI] Refused" }, text: { stringValue: "x" } } } } } }) })).json();
    const badId = bad.name.split("/").pop();
    assert.equal((await call(badId)).status, 502);
    const failed = await delivery(badId);
    assert.equal(failed.state.stringValue, "ERROR");
    assert.match(failed.error.stringValue, /No such mailbox|recipients/i);
    assert.equal((await (await call(refused)).json()).state, "SUCCESS", "the next mail still goes out after a failure");
  } finally {
    await new Promise((resolve) => smtp.close(resolve));
  }
});
