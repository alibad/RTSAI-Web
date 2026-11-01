import assert from "node:assert/strict";
import test from "node:test";
import { Timestamp } from "firebase-admin/firestore";
import { deletionNotice, plain, recentLogin, RECENT_LOGIN_SECONDS } from "./account.js";

test("deleting needs a sign-in from the last ten minutes", () => {
  const now = Date.parse("2026-11-01T10:00:00Z");
  assert.equal(recentLogin({ auth_time: now / 1000 - 30 }, now), true);
  assert.equal(recentLogin({ auth_time: now / 1000 - RECENT_LOGIN_SECONDS }, now), true);
  assert.equal(recentLogin({ auth_time: now / 1000 - RECENT_LOGIN_SECONDS - 1 }, now), false);
  assert.equal(recentLogin({}, now), false);
  assert.equal(recentLogin(null, now), false);
});

test("exports are plain JSON: times as ISO, binary data as its size", () => {
  const out = plain({ at: Timestamp.fromDate(new Date("2026-10-30T08:00:00Z")), preview: Buffer.alloc(12), nested: { list: [1, "a", null] }, missing: undefined });
  assert.deepEqual(out, { at: "2026-10-30T08:00:00.000Z", preview: { bytes: 12 }, nested: { list: [1, "a", null] }, missing: null });
});

test("the team's deletion notice names only the account ID and the steps left by hand", () => {
  const notice = deletionNotice("UID123abc", { stats: 1, savedMaps: 2, teamEmails: 4 }, { at: new Date("2026-11-01T09:30:00Z") });
  assert.match(notice.subject, /Account deleted/);
  assert.match(notice.text, /Account ID: UID123abc/);
  assert.match(notice.text, /savedMaps: 2/);
  assert.match(notice.text, /issues\?q=%22UID123abc%22/);
  assert.match(notice.text, /Google Group archive/);
  assert.match(notice.text, /Google Analytics/);
  assert.match(notice.html, /<ol><li>GitHub feedback issues/);
});
