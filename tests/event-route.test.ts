import assert from "node:assert/strict";
import test from "node:test";
import { createEventHandler } from "../app/api/event/route";
import { EVENTS, MILESTONES, ordinal } from "../lib/event-registry";
import type { recordDailyEvent } from "../lib/event-rollup";
import type { CountResult } from "../lib/player-stats";

type Sent = { to: string | string[]; subject: string; text: string };
const identity = { uid: "u1", email: "ali@example.com", name: "Ali" };

function harness(counts: (input: { player?: string; global?: string }) => CountResult = () => ({}), rollup?: typeof recordDailyEvent) {
  const sent: Sent[] = [], counted: { player?: string; global?: string }[] = [], errors: unknown[] = [];
  const handle = createEventHandler({
    verifyIdentity: async request => request.headers.get("authorization") ? identity : null,
    count: async input => { counted.push({ player: input.player, global: input.global }); return counts(input); },
    sendEmail: async message => { sent.push(message); return "doc"; },
    recipients: () => ["rtsai@googlegroups.com"],
    reportError: (...args: unknown[]) => { errors.push(args); },
    rollup,
  });
  const post = (body: unknown, headers: Record<string, string> = {}) => handle(new Request("https://rtsai.net/api/event", {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Authorization: "Bearer t", "x-vercel-ip-country": "SA", "x-vercel-ip-city": "Riyadh", "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130", ...headers },
  }));
  return { post, sent, counted, errors };
}

test("rejects signed-out callers, other sites and unknown events", async () => {
  const h = harness();
  assert.equal((await h.post({ name: "match_started" }, { Authorization: "" })).status, 401);
  assert.equal((await h.post({ name: "match_started" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await h.post({ name: "drop_tables" })).status, 400);
  assert.equal(h.sent.length, 0);
});

test("a new sign-up is emailed once, and counted overall only the first time", async () => {
  let joined = 0, players = 41;
  const h = harness(input => input.player ? { player: ++joined } : { global: ++players });
  await h.post({ name: "sign_up", props: { method: "google" } });
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].subject, /New sign-up: Ali · Riyadh, SA/);
  assert.match(h.sent[0].text, /Chrome on Windows/);
  assert.deepEqual(h.counted, [{ player: "joined", global: undefined }, { player: undefined, global: "players" }]);
  await h.post({ name: "sign_up" });
  assert.equal(h.sent.length, 1, "a repeated sign-up call neither emails nor counts the player again");
  assert.equal(h.counted.length, 3);
});

test("first match, global milestones, and quiet in between", async () => {
  let player = 0, global = 8;
  const h = harness(() => ({ player: ++player, global: ++global }));
  await h.post({ name: "match_started", props: { mode: "skirmish" } });
  assert.match(h.sent.at(-1)!.subject, /First match for Ali/);
  await h.post({ name: "match_started" });
  assert.match(h.sent.at(-1)!.subject, /10th match overall/, "the 10th match overall is a milestone");
  const before = h.sent.length;
  await h.post({ name: "match_started" });
  assert.equal(h.sent.length, before, "the 11th match is quiet");
});

test("AI assists: first per player and the 1st / 10th / 100th / 1,000th overall", async () => {
  for (const n of [1, 10, 100, 1000]) assert.ok(MILESTONES.includes(n));
  const h = harness(() => ({ player: 5, global: 1000 }));
  await h.post({ name: "ai_assist" });
  assert.match(h.sent[0].subject, /1,000th AI co-commander assist overall/);
  assert.equal(ordinal(1), "1st"); assert.equal(ordinal(12), "12th"); assert.equal(ordinal(22), "22nd"); assert.equal(ordinal(103), "103rd");
});

test("every multiplayer match start is emailed with its shape", async () => {
  const h = harness(() => ({ player: 3, global: 57 }));
  await h.post({ name: "multiplayer_started", props: { players: 3, ai: 1, map: "Four Fronts", bad_key_ignored: { nested: true } } });
  assert.match(h.sent[0].subject, /Multiplayer match started by Ali: 3 players \+ 1 AI on Four Fronts/);
  assert.doesNotMatch(h.sent[0].text, /nested/);
});

test("game errors: the first three per player, then only milestones", async () => {
  let n = 0;
  const h = harness(() => ({ player: ++n }));
  for (let i = 0; i < 5; i++) await h.post({ name: "game_error", props: { message: "Synchronization mismatch at frame 812" } });
  assert.equal(h.sent.length, 3);
  assert.match(h.sent[2].subject, /Game error for Ali \(3rd\): Synchronization mismatch/);
});

test("a counter failure still emails always-notable events", async () => {
  const h = harness(() => { throw Error("firestore down"); });
  const response = await h.post({ name: "multiplayer_started", props: { players: 2 } });
  assert.equal(response.status, 200);
  assert.equal(h.sent.length, 1);
  assert.equal(h.errors.length, 1);
});

test("every event goes into its day's rollup with the caller's token and clean props; feedback through its own route", async () => {
  const rolled: { idToken: string; name: string; props: Record<string, unknown> }[] = [];
  const h = harness(() => ({}), async input => { rolled.push(input); return true; });
  for (const name of Object.keys(EVENTS)) await h.post({ name, props: { kind: "skirmish", faction: "russia", nested: { x: 1 } } });
  assert.deepEqual(rolled.map(r => r.name), Object.keys(EVENTS).filter(name => name !== "feedback_sent"));
  assert.equal(rolled[0].idToken, "t");
  assert.deepEqual(rolled[0].props, { kind: "skirmish", faction: "russia" });
  const signedOut = harness(() => ({}), async input => { rolled.push(input); return true; });
  await signedOut.post({ name: "match_started" }, { Authorization: "" });
  assert.equal(rolled.length, Object.keys(EVENTS).length - 1, "signed-out callers are never rolled up");
});

test("the rollup function knows every event the site and game send", async () => {
  const { EVENT_NAMES } = await import("../functions/rollup.js");
  assert.deepEqual([...EVENT_NAMES].sort(), Object.keys(EVENTS).sort());
});

test("a failed rollup never breaks the event, its counters or its email", async () => {
  const h = harness(() => ({ player: 1, global: 5 }), async () => { throw new Error("function down"); });
  const response = await h.post({ name: "match_started", props: { kind: "skirmish" } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).rolledUp, false);
  assert.match(h.sent[0].subject, /First match for Ali/);
  assert.deepEqual(h.errors.map(e => (e as unknown[])[0]), ["Daily rollup failed"]);
});

test("GA-only events are never counted or emailed", async () => {
  const h = harness();
  await h.post({ name: "game_loaded" });
  await h.post({ name: "match_ended", props: { result: "won" } });
  assert.equal(h.sent.length, 0);
});
