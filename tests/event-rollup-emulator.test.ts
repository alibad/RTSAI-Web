import assert from "node:assert/strict";
import test from "node:test";

// Needs: firebase emulators:start --only functions,firestore,auth --project demo-rtsai. Skipped when they aren't running.
// A signed-in player's POST /api/event goes on to the recordEvent function (functions/), which adds it to the day.
// FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST and FUNCTIONS_EMULATOR_HOST point it at other ports.
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const recordUrl = `http://${process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001"}/demo-rtsai/europe-west1/recordEvent`;
const up = await fetch(recordUrl).then(r => r.status === 405, () => false);

test("an event posted to /api/event lands in its Doha day's rollup", { skip: !up && "emulators not running" }, async () => {
  Object.assign(process.env, {
    FIRESTORE_EMULATOR_HOST: firestoreHost, FIREBASE_AUTH_EMULATOR_HOST: authHost, RECORD_EVENT_URL: recordUrl, MAIL_GROUP: "",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-rtsai", NEXT_PUBLIC_FIREBASE_API_KEY: "demo",
  });
  const { POST } = await import("../app/api/event/route");
  const { qatarDate } = await import("../functions/rollup.js");
  const day = `http://${firestoreHost}/v1/projects/demo-rtsai/databases/(default)/documents/dailyStats/${qatarDate()}`;
  const cuba = async () => {
    const doc = await (await fetch(day, { headers: { Authorization: "Bearer owner" } })).json() as { fields?: { started?: { mapValue: { fields: { faction?: { mapValue: { fields: { cuba?: { integerValue: string } } } } } } } } };
    return Number(doc.fields?.started?.mapValue.fields.faction?.mapValue.fields.cuba?.integerValue ?? 0);
  };
  const signUp = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `rollup${Date.now()}@test.dev`, password: "test-password-1", returnSecureToken: true }) });
  const { idToken } = await signUp.json() as { idToken: string };
  const before = await cuba();
  const response = await POST(new Request("http://localhost/api/event", {
    method: "POST", headers: { origin: "http://localhost:3000", "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ name: "match_started", props: { kind: "skirmish", faction: "cuba", map: "gen-12", mode: "isometric" } }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json() as { rolledUp: boolean; counts: { player?: number } };
  assert.equal(body.rolledUp, true);
  assert.equal(body.counts.player, 1, "the player's own counters still count through firestore.rules");
  assert.equal(await cuba(), before + 1);
});
