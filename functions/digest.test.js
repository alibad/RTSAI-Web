import assert from "node:assert/strict";
import test from "node:test";
import { change, digestWindow, rangeLabel, renderDigest, sumDays } from "./digest.js";

test("the Monday 08:00 Doha digest covers last Monday to Sunday; one sent by hand, the last 7 days to now", () => {
  const monday = new Date("2026-10-19T05:00:00Z"); // 08:00 in Doha
  const w = digestWindow(monday);
  assert.deepEqual(w.days, ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  assert.equal(w.previous[0], "2026-10-05");
  assert.equal(w.start.toISOString(), "2026-10-11T21:00:00.000Z");
  assert.equal(w.end.toISOString(), "2026-10-18T21:00:00.000Z");
  assert.equal(w.previousStart.toISOString(), "2026-10-04T21:00:00.000Z");
  const now = new Date("2026-10-14T09:30:00Z"), manual = digestWindow(now, { throughToday: true });
  assert.deepEqual([manual.days[0], manual.days[6]], ["2026-10-08", "2026-10-14"]);
  assert.equal(manual.end, now);
  assert.equal(rangeLabel("2026-09-28", "2026-10-04"), "28 Sep – 4 Oct 2026");
  assert.equal(rangeLabel("2026-10-08", "2026-10-14"), "8–14 Oct 2026");
});

test("day documents add up however deep; timestamps and labels are skipped", () => {
  const ts = { toDate: () => new Date() };
  assert.deepEqual(sumDays([
    { date: "2026-10-12", updated: ts, players: 2, events: { match_started: 3 }, started: { kind: { skirmish: 3 } } },
    { date: "2026-10-13", players: 1, events: { match_started: 1, login: 2 }, ended: { minutes: 12.5 } },
  ]), { players: 3, events: { match_started: 4, login: 2 }, started: { kind: { skirmish: 3 } }, ended: { minutes: 12.5 } });
});

test("week-over-week change reads +, −, new or —", () => {
  assert.deepEqual(change(118, 105), { text: "+12%", dir: "up" });
  assert.deepEqual(change(5, 10), { text: "−50%", dir: "down" });
  assert.deepEqual(change(3, 0), { text: "new", dir: "up" });
  assert.deepEqual(change(0, 0), { text: "—", dir: "flat" });
  assert.deepEqual(change(7, 7), { text: "±0%", dir: "flat" });
});

const window = digestWindow(new Date("2026-10-12T05:00:00Z")); // Monday 12 Oct: the week of 5 Oct
const day = (date, extra = {}) => ({ date, ...extra });
function week() {
  return {
    window,
    days: window.days.map((d, i) => day(d, i === 2 ? {
      players: 4,
      events: { match_started: 70, match_ended: 50, game_loaded: 30, feedback_sent: 2, game_error: 6, multiplayer_started: 3, ai_assist: 9, sign_up: 3 },
      started: { kind: { skirmish: 50, campaign: 15, multiplayer: 5 }, faction: { russia: 30, america: 25, iran: 15 }, map: { random: 40, bundled: 20, earth: 10 } },
      ended: { result: { won: 25, lost: 15, left: 8, error: 2 }, minutes: 600, timed: 40 },
      finished: { kind: { skirmish: 30, campaign: 10 }, faction: { russia: 20, america: 20 }, won: 25, lost: 15 },
      signups: { method: { google: 2, password: 1 } }, feedback: { category: { bug: 1, gameplay: 1 } },
      loaded: { gpu: { hardware: 28, software: 2 }, seconds: 150, timed: 30 },
    } : i === 4 ? { players: 2, events: { match_started: 48 } } : {})),
    previous: window.previous.map((d, i) => day(d, i === 0 ? { players: 3, events: { match_started: 105, feedback_sent: 1 }, finished: { won: 30, lost: 20 } } : {})),
    active: 42, previousActive: 40, newPlayers: 5, previousNewPlayers: 0, accounts: 88,
    global: { players: 120, matches: 1500, multiplayer: 40, aiAssists: 300 },
    errors: [{ message: "WebGL <context> lost & \"gone\"", where: "runtime", count: 4 }, { message: "Sync mismatch at frame #", where: "unknown", count: 2 }],
  };
}

test("the subject says the week, players, matches and their trend", () => {
  const { subject } = renderDigest(week());
  assert.equal(subject, "RTS AI week of 5 Oct: 42 players, 118 matches (+12%)");
  const quiet = renderDigest({ ...week(), days: window.days.map((d) => day(d)), previous: window.previous.map((d) => day(d)), active: 1 });
  assert.equal(quiet.subject, "RTS AI week of 5 Oct: 1 player, 0 matches");
});

test("the email is visual and scannable: big numbers, bar charts, errors, links; data is escaped", () => {
  const { html, text, model } = renderDigest(week());
  assert.deepEqual(model.big.map((b) => [b.key, b.value, b.change.text]), [
    ["players", 42, "+5%"], ["signups", 5, "new"], ["loads", 30, "new"], ["started", 118, "+12%"], ["finished", 40, "−20%"], ["feedback", 2, "+100%"],
  ]);
  assert.deepEqual(model.modes.map((r) => [r.label, r.value, r.second]), [["Skirmish", 50, 30], ["Campaign", 15, 10], ["Multiplayer", 5, 0]]);
  assert.deepEqual(model.factions.map((r) => r.label), ["Russia", "America", "Iran"]);
  assert.equal(model.avgMinutes, 15);
  for (const piece of ["RTS AI · WEEKLY", "Week of 5 Oct", "5–11 Oct 2026", "MATCHES BY MODE", "MATCHES BY FACTION", "HOW MATCHES ENDED", "GAME ERRORS",
    "ALL TIME", "1,500", "Player accounts", "88", "https://rtsai.net", "analytics.google.com/analytics/web/#/p549381181/reports", "bgcolor=\"#d9a93c\"", "Russia", "average match 15.0 min"]) {
    assert.ok(html.includes(piece), `html has ${piece}`);
  }
  assert.ok(html.includes("WebGL &lt;context&gt; lost &amp; &quot;gone&quot;"), "error messages are escaped");
  assert.ok(!html.includes("<context>"));
  assert.ok(!/<script|<img|<style/i.test(html), "no scripts, images or style blocks: inline only");
  assert.ok(html.length < 60_000, `under Gmail's clipping limit (${html.length} bytes)`);
  for (const piece of ["Active players", "42", "+5% vs 40 last week", "Skirmish", "█", "50 started · 30 finished", "4×", "GA4 reports: https://analytics.google.com"]) {
    assert.ok(text.includes(piece), `text has ${piece}`);
  }
  assert.ok(!model.endingsMissing);
});

test("an empty week still renders, says so, and flags missing match endings", () => {
  const empty = renderDigest({ window, days: window.days.map((d) => day(d)), previous: window.previous.map((d) => day(d)), active: 0, previousActive: 0, newPlayers: 0, previousNewPlayers: 0, accounts: 0, global: {}, errors: [] });
  assert.match(empty.html, /No matches this week\./);
  assert.match(empty.html, /No game errors reported this week\./);
  assert.match(empty.text, /No matches this week\./);
  const startsOnly = renderDigest({ ...week(), days: window.days.map((d, i) => day(d, i ? {} : { events: { match_started: 3 }, started: { kind: { skirmish: 3 } } })) });
  assert.ok(startsOnly.model.endingsMissing);
  assert.match(startsOnly.html, /until the browser game reports them/);
});
