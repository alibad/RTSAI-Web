import assert from "node:assert/strict";
import test from "node:test";

// Needs: firebase emulators:start --only auth,firestore --project demo-rtsai. Skipped when they aren't running.
// The writer puts one document in the project's own `mail` collection, which the Trigger Email extension delivers.
const up = await fetch("http://127.0.0.1:8085/").then(() => true, () => false);

test("sendFirebaseEmail queues team mail in rtsai-net's own mail collection, through firestore.rules", { skip: !up && "Firestore emulator not running" }, async () => {
  Object.assign(process.env, {
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-rtsai", NEXT_PUBLIC_FIREBASE_API_KEY: "demo",
  });
  const { sendFirebaseEmail } = await import("../lib/firebase-mail");
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `mail${Date.now()}@test.dev`, password: "test-password-1", returnSecureToken: true }) });
  const { idToken } = await r.json() as { idToken: string };
  const mail = { to: "rtsai@googlegroups.com", subject: "[RTS AI] New player", html: "<p>Welcome</p>", text: "Welcome" };

  const asPlayer = await sendFirebaseEmail({ ...mail, idToken });
  const anonymously = await sendFirebaseEmail(mail);
  for (const id of [asPlayer, anonymously]) {
    const doc = await (await fetch(`http://127.0.0.1:8085/v1/projects/demo-rtsai/databases/(default)/documents/mail/${id}`, { headers: { Authorization: "Bearer owner" } })).json() as { fields: { to: { arrayValue: { values: { stringValue: string }[] } }; message: { mapValue: { fields: Record<string, { stringValue: string }> } } } };
    assert.deepEqual(doc.fields.to.arrayValue.values.map((v) => v.stringValue), ["rtsai@googlegroups.com"]);
    assert.equal(doc.fields.message.mapValue.fields.subject.stringValue, "[RTS AI] New player");
  }
  await assert.rejects(sendFirebaseEmail({ ...mail, to: "someone@example.com", idToken }), /403/, "the rules refuse any other recipient");
});
