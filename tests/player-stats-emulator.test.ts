import assert from "node:assert/strict";
import test from "node:test";

// Needs: firebase emulators:start --only auth,firestore --project demo-rtsai. Skipped when they aren't running.
const up = await fetch("http://127.0.0.1:8085/").then(() => true, () => false);

test("countEvent writes +1 through firestore.rules and returns the new totals", { skip: !up && "Firestore emulator not running" }, async () => {
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8085";
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "demo-rtsai";
  const { countEvent } = await import("../lib/player-stats");
  const r = await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `stats${Date.now()}@test.dev`, password: "test-password-1", returnSecureToken: true }) });
  const { idToken, localId } = await r.json() as { idToken: string; localId: string };
  const first = await countEvent({ idToken, uid: localId, player: "aiAssists", global: "aiAssists" });
  const second = await countEvent({ idToken, uid: localId, player: "aiAssists", global: "aiAssists" });
  assert.equal(first.player, 1); assert.equal(second.player, 2);
  assert.equal(second.global, first.global! + 1);
  await assert.rejects(countEvent({ idToken, uid: "someone-else", player: "matches" }), /403/);
});
