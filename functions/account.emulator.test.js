// The account function end to end on the local emulators: two players with data in every place account.js knows;
// player A downloads theirs (and sees none of B's), then deletes the account. Everything of A's goes, B's stays, the
// hosted AI install is unlinked, and the team gets the steps left by hand (delivered to a local SMTP server).
// Needs (functions/.env.local: SMTP_URI=smtp://tester@127.0.0.1:2526; functions/.secret.local: SMTP_PASSWORD=test), from RTSAI-Web:
//   firebase emulators:start --only functions,firestore,auth --project demo-rtsai
//   node --test functions/account.emulator.test.js      (one emulator test at a time: they share SMTP port 2526; FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST, FUNCTIONS_EMULATOR_HOST for other ports)
import assert from "node:assert/strict";
import test from "node:test";
import { SMTPServer } from "smtp-server";

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8085";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const functionUrl = `http://${process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001"}/demo-rtsai/europe-west1/account`;
const firestore = `http://${firestoreHost}/v1/projects/demo-rtsai/databases/(default)/documents`;
const up = await fetch(functionUrl, { method: "POST" }).then((r) => r.status === 405, () => false);

const owner = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const value = (v) => typeof v === "string" ? { stringValue: v } : typeof v === "number" ? { integerValue: String(v) } : v === null ? { nullValue: null } : { mapValue: { fields: fields(v) } };
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, value(v)]));
const put = (path, data) => fetch(`${firestore}/${path}`, { method: "PATCH", headers: owner, body: JSON.stringify({ fields: fields(data) }) }).then((r) => assert.equal(r.status, 200, path));
const exists = async (path) => (await fetch(`${firestore}/${path}`, { headers: owner })).status === 200;
const get = async (path) => (await (await fetch(`${firestore}/${path}`, { headers: owner })).json()).fields ?? {};

async function signUp(name) {
  const r = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `${name.toLowerCase()}${Date.now()}@test.dev`, password: "test-password-1", displayName: name, returnSecureToken: true }) });
  const { idToken, localId } = await r.json();
  return { token: idToken, uid: localId };
}

const call = (method, token) => fetch(functionUrl, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });

test("a player downloads and then deletes only their own account", { skip: !up && "emulators not running" }, async () => {
  const received = [];
  const smtp = new SMTPServer({
    secure: false, allowInsecureAuth: true, disabledCommands: ["STARTTLS"],
    onAuth: (_a, _s, done) => done(null, { user: "tester" }),
    onData: (stream, _s, done) => { let raw = ""; stream.on("data", (c) => { raw += c; }); stream.on("end", () => { received.push(raw); done(); }); },
  });
  await new Promise((resolve, reject) => { smtp.on("error", reject); smtp.listen(2526, "127.0.0.1", resolve); });
  try {
    const a = await signUp("Alia"), b = await signUp("Bassam"), id = Date.now().toString(36), day = "dailyStats/2026-10-30";
    for (const p of [a, b]) {
      await put(`players/${p.uid}`, { matches: 3, multiplayer: 1 });
      await put(`maps/m${id}${p.uid.slice(0, 4)}`, { owner: p.uid, mapId: "earth-0123456789abcdef", title: `${p.uid} map`, place: "Doha", players: 2 });
      await put(`mapData/m${id}${p.uid.slice(0, 4)}`, { owner: p.uid, mapId: "earth-0123456789abcdef", yaml: "MapFormat: 12" });
      await put(`feedbackReports/r${id}${p.uid.slice(0, 4)}`, { owner: p.uid, source: "web" });
      await put(`feedbackReports/r${id}${p.uid.slice(0, 4)}/files/f${id}`, { name: "shot.png", kind: "screenshot", contentType: "image/png", bytes: 10, chunks: 1 });
      await put(`feedbackReports/r${id}${p.uid.slice(0, 4)}/chunks/f${id}_0`, { note: "bytes" });
      await put(`${day}/players/${p.uid}`, { events: 5 });
      await put(`mail/x${id}${p.uid.slice(0, 4)}`, { to: "rtsai@googlegroups.com", message: { subject: "First match", text: `Player: someone\nAccount ID: ${p.uid}\n` } });
      await put(`aiInstalls/i${id}${p.uid.slice(0, 4)}`, { linkedUid: p.uid, linkedAt: "2026-10-30" });
    }
    await put(`p2pMatches/H${id}`, { host: a.uid, version: "x" });
    await put(`p2pMatches/G${id}`, { host: b.uid, version: "x" });
    await put(`p2pMatches/G${id}/joins/j${id}`, { guest: a.uid, offer: "sdp" });

    assert.equal((await call("GET", "")).status, 401, "signed out");
    assert.equal((await call("POST", a.token)).status, 405);

    const exported = await call("GET", a.token);
    assert.equal(exported.status, 200, await exported.clone().text());
    const data = await exported.json();
    assert.equal(data.account.uid, a.uid);
    assert.equal(data.account.name, "Alia");
    assert.equal(data.stats.matches, 3);
    assert.deepEqual(data.savedMaps.map((m) => m.owner), [a.uid]);
    assert.equal(data.savedMaps[0].mapYaml, "MapFormat: 12");
    assert.match(data.savedMaps[0].openInGame, /\/play\/\?saved=m/);
    assert.equal(data.feedbackFiles.length, 1);
    assert.equal(data.feedbackFiles[0].files[0].name, "shot.png");
    assert.equal(data.dailyActivity.length, 1);
    assert.equal(data.dailyActivity[0].events, 5);
    assert.equal(data.multiplayerIntroductions.length, 2, "the match A hosts and the join A sent");
    assert.equal(data.hostedAiInstalls.length, 1);
    assert.equal(data.teamEmails.length, 1);
    assert.ok(data.outsideFirebase.some((line) => /GitHub/.test(line)));
    assert.ok(!JSON.stringify(data).includes(b.uid), "nothing of the other player's");

    const deleted = await call("DELETE", a.token);
    assert.equal(deleted.status, 200, await deleted.clone().text());
    const result = await deleted.json();
    assert.equal(result.deleted, true);
    assert.deepEqual(result.removed, { stats: 1, savedMaps: 1, feedbackReports: 1, dailyRecords: 1, multiplayer: 2, aiInstallsUnlinked: 1, teamEmails: 1 });
    assert.equal(result.notified, true);
    assert.ok(received.some((raw) => raw.includes("Account deleted") && raw.includes(a.uid)), "the team gets the steps left by hand");

    for (const s of [a, b]) {
      const mine = s === a, tag = `${id}${s.uid.slice(0, 4)}`;
      for (const path of [`players/${s.uid}`, `maps/m${tag}`, `mapData/m${tag}`, `feedbackReports/r${tag}`, `feedbackReports/r${tag}/files/f${id}`,
        `feedbackReports/r${tag}/chunks/f${id}_0`, `${day}/players/${s.uid}`, `mail/x${tag}`]) assert.equal(await exists(path), !mine, `${mine ? "A's" : "B's"} ${path}`);
      const install = await get(`aiInstalls/i${tag}`);
      if (mine) { assert.ok("nullValue" in install.linkedUid, "A's install is unlinked"); assert.equal(install.linkedAt, undefined); }
      else assert.equal(install.linkedUid.stringValue, b.uid);
    }
    assert.equal(await exists(`p2pMatches/H${id}`), false);
    assert.equal(await exists(`p2pMatches/G${id}`), true);
    assert.equal(await exists(`p2pMatches/G${id}/joins/j${id}`), false);

    const lookup = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: a.token }) });
    assert.notEqual(lookup.status, 200, "A's sign-in is gone");
    assert.equal((await call("DELETE", a.token)).status, 401, "a deleted account's old token is refused");
    assert.equal((await call("GET", b.token)).status, 200, "B can still sign in and download");
  } finally {
    await new Promise((resolve) => smtp.close(resolve));
  }
});
