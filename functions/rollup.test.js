import assert from "node:assert/strict";
import test from "node:test";
import { FieldValue } from "firebase-admin/firestore";
import { errorKey, mapKind, qatarDate, rollupFor } from "./rollup.js";
import { nested } from "./record.js";

test("days are Doha days: 20:59 UTC is still today, 21:00 UTC is tomorrow", () => {
  assert.equal(qatarDate(new Date("2026-10-14T20:59:59Z")), "2026-10-14");
  assert.equal(qatarDate(new Date("2026-10-14T21:00:00Z")), "2026-10-15");
  assert.equal(qatarDate(new Date("2026-12-31T21:30:00Z")), "2027-01-01");
});

test("a match start counts its mode, faction, map kind, view and seats", () => {
  const { inc, start } = rollupFor("match_started", { kind: "skirmish", mode: "isometric", map: "gen-48213", faction: "russia", players: 2 });
  assert.deepEqual(inc, {
    "events.match_started": 1, "started.kind.skirmish": 1, "started.faction.russia": 1, "started.map.random": 1,
    "started.view.isometric": 1, "started.seats.single": 1,
  });
  assert.deepEqual(start, { kind: "skirmish", faction: "russia", map: "random", view: "isometric" });
  assert.equal(rollupFor("match_started", { kind: "multiplayer", map: "earth-0123456789abcdef" }).inc["started.seats.multi"], 1);
});

test("map kinds: random, saved Earth, campaign, bundled, unknown", () => {
  assert.equal(mapKind("skirmish", "gen-7"), "random");
  assert.equal(mapKind("skirmish", "earth-0123456789abcdef"), "earth");
  assert.equal(mapKind("campaign", "lines-of-hope-01"), "campaign");
  assert.equal(mapKind("skirmish", "four-fronts"), "bundled");
  assert.equal(mapKind("skirmish", undefined), "unknown");
});

test("a match end is credited to the faction and map its player started with", () => {
  const lastStart = { kind: "campaign", faction: "america", map: "campaign", view: "classic" };
  const { inc } = rollupFor("match_ended", { kind: "campaign", result: "won", minutes: 14.5, mode: "classic" }, lastStart);
  assert.deepEqual(inc, {
    "events.match_ended": 1, "ended.kind.campaign": 1, "ended.result.won": 1, "ended.faction.america": 1, "ended.map.campaign": 1,
    "ended.view.classic": 1, "finished.kind.campaign": 1, "finished.faction.america": 1, "finished.won": 1, "ended.minutes": 14.5, "ended.timed": 1,
  });
  const left = rollupFor("match_ended", { kind: "skirmish", result: "left", minutes: -3 }).inc;
  assert.equal(left["ended.result.left"], 1);
  assert.equal(left["ended.faction.unknown"], 1, "no start remembered");
  assert.equal(left["finished.kind.skirmish"], undefined, "leaving is not finishing");
  assert.equal(left["ended.minutes"], undefined, "negative minutes are ignored");
  assert.equal(rollupFor("match_ended", { result: "won", minutes: 99999 }).inc["ended.minutes"], 600, "minutes are capped");
});

test("whatever a client sends, only whitelisted field names come out", () => {
  const hostile = { kind: "x".repeat(300), faction: "__proto__", map: "../../etc", mode: "constructor", result: "won.lost", gpu: "a.b", method: "$where", category: "Bug; DROP" };
  for (const name of ["match_started", "match_ended", "game_loaded", "sign_up", "login", "feedback_sent", "ai_assist", "multiplayer_started", "game_error"]) {
    for (const path of Object.keys(rollupFor(name, hostile).inc)) assert.match(path, /^[a-z]+(\.[a-z0-9_]+){1,2}$/, `${name}: ${path}`);
  }
  for (const category of ["constructor", "__proto__", "toString"]) {
    assert.equal(rollupFor("feedback_sent", { category }).inc["feedback.category.other"], 1, category);
  }
  assert.equal(rollupFor("match_started", hostile).inc["started.faction.other"], 1);
  assert.equal(rollupFor("match_started", { faction: "Germany" }).inc["started.faction.germany"], 1, "case doesn't matter");
  assert.throws(() => rollupFor("drop_tables", {}), /Unknown event/);
  assert.deepEqual(rollupFor("login", "not an object").inc, { "events.login": 1, "logins.method.unknown": 1 });
});

test("game loads, sign-ups, feedback and multiplayer have their own small breakdowns", () => {
  assert.deepEqual(rollupFor("game_loaded", { mode: "isometric", seconds: 7.3, gpu: "software" }).inc,
    { "events.game_loaded": 1, "loaded.gpu.software": 1, "loaded.view.isometric": 1, "loaded.seconds": 7.3, "loaded.timed": 1 });
  assert.equal(rollupFor("sign_up", { method: "google" }).inc["signups.method.google"], 1);
  assert.deepEqual(rollupFor("feedback_sent", { category: "Feature Request", source: "game" }).inc,
    { "events.feedback_sent": 1, "feedback.category.feature": 1, "feedback.source.game": 1 });
  assert.deepEqual(rollupFor("multiplayer_started", { players: 6, ai: 1, map: "Four Fronts" }).inc,
    { "events.multiplayer_started": 1, "multiplayer.humans.p5plus": 1, "multiplayer.with_ai": 1 });
});

test("game errors group by message, whatever numbers are in it", () => {
  const a = rollupFor("game_error", { where: "runtime", message: "Synchronization mismatch at frame 812" });
  const b = rollupFor("game_error", { where: "runtime", message: "Synchronization mismatch at frame 97" });
  assert.equal(a.error.key, b.error.key);
  assert.match(a.error.key, /^[0-9a-f]{16}$/);
  assert.notEqual(a.error.key, errorKey("WebGL context lost"));
  assert.equal(a.inc["errors.where.runtime"], 1);
  assert.equal(rollupFor("game_error", {}).error.message, "unknown");
});

test("field paths become nested increments for one merging write", () => {
  const out = nested({ "events.match_started": 1, "started.kind.skirmish": 1, players: 1 });
  assert.ok(out.events.match_started.isEqual(FieldValue.increment(1)));
  assert.ok(out.started.kind.skirmish.isEqual(FieldValue.increment(1)));
  assert.ok(out.players.isEqual(FieldValue.increment(1)));
});
