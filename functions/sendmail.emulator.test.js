// The deployed function's whole path on the local emulators: a mail document is claimed, sent to a local SMTP server
// (smtp-server, standing in for mail.humanquest.net) and marked SUCCESS; a refused send is marked ERROR.
// Needs, from the repository root (functions/.env.local: SMTP_URI=smtp://tester@127.0.0.1:2525, .secret.local: SMTP_PASSWORD=test):
//   firebase emulators:start --only functions,firestore --project demo-rtsai
//   node --test functions/sendmail.emulator.test.js
import assert from "node:assert/strict";
import test from "node:test";
import { SMTPServer } from "smtp-server";

const host = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const firestore = `http://${host}/v1/projects/demo-rtsai/databases/(default)/documents`;
const up = await fetch(`http://${host}/`).then(() => true, () => false);

test("sendMail delivers a mail document over SMTP and records the outcome", { skip: !up && "emulators not running" }, async () => {
  const received = [];
  const server = new SMTPServer({
    secure: false, allowInsecureAuth: true, disabledCommands: ["STARTTLS"],
    onAuth: (auth, _session, done) => (auth.username === "tester" && auth.password === "test" ? done(null, { user: auth.username }) : done(new Error("bad login"))),
    onRcptTo: (address, _session, done) => (address.address.endsWith("@refused.test") ? done(new Error("No such mailbox")) : done()),
    onData: (stream, session, done) => { let raw = ""; stream.on("data", (c) => { raw += c; }); stream.on("end", () => { received.push({ to: session.envelope.rcptTo.map((r) => r.address), raw }); done(); }); },
  });
  await new Promise((resolve) => server.listen(2525, "127.0.0.1", resolve));
  const queue = async (to, subject) => {
    const r = await fetch(`${firestore}/mail`, { method: "POST", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { to: { arrayValue: { values: [{ stringValue: to }] } }, message: { mapValue: { fields: { subject: { stringValue: subject }, text: { stringValue: "Plain body" }, html: { stringValue: "<p>HTML body</p>" } } } } } }) });
    return (await r.json()).name.split("/").pop();
  };
  const delivery = async (id) => {
    for (let i = 0; i < 60; i++) {
      const d = (await (await fetch(`${firestore}/mail/${id}`, { headers: { Authorization: "Bearer owner" } })).json()).fields?.delivery?.mapValue?.fields;
      if (d?.state?.stringValue === "SUCCESS" || d?.state?.stringValue === "ERROR") return d;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`no delivery state for ${id}`);
  };
  try {
    const sent = await delivery(await queue("rtsai@googlegroups.com", "[RTS AI] Emulator test"));
    assert.equal(sent.state.stringValue, "SUCCESS");
    assert.equal(sent.attempts.integerValue, "1");
    assert.deepEqual(sent.info.mapValue.fields.accepted.arrayValue.values.map((v) => v.stringValue), ["rtsai@googlegroups.com"]);
    const mail = received.find((m) => m.raw.includes("[RTS AI] Emulator test"));
    assert.ok(mail, "the SMTP server received the message");
    assert.deepEqual(mail.to, ["rtsai@googlegroups.com"]);
    assert.match(mail.raw, /From: RTS AI <info@humanquest\.net>/);
    assert.match(mail.raw, /Reply-To: ali@humanquest\.net/);

    const refused = await delivery(await queue("nobody@refused.test", "[RTS AI] Refused"));
    assert.equal(refused.state.stringValue, "ERROR");
    assert.match(refused.error.stringValue, /No such mailbox|recipients/i);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
