import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CONSENT_KEY, parseConsent, readConsent, subscribeConsent, writeConsent } from "../lib/consent";

function fakeWindow(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial)), target = new EventTarget();
  const localStorage = { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v); } };
  Object.assign(globalThis, { window: Object.assign(target, { localStorage }) });
  return items;
}

test("no choice until the player makes one, and only our own record counts", () => {
  fakeWindow();
  assert.equal(readConsent(), null, "analytics stays off before any choice");
  assert.equal(parseConsent(null), null);
  assert.equal(parseConsent("granted"), null, "not JSON");
  assert.equal(parseConsent(JSON.stringify({ analytics: "yes" })), null);
  assert.deepEqual(parseConsent(JSON.stringify({ analytics: "denied", at: "2026-11-01T00:00:00.000Z" })), { analytics: "denied", at: "2026-11-01T00:00:00.000Z" });
});

test("a choice is remembered on the device and announced to the page", () => {
  const items = fakeWindow();
  let heard = 0;
  const stop = subscribeConsent(() => { heard++; });
  writeConsent("granted", new Date("2026-11-01T10:00:00Z"));
  assert.equal(readConsent(), "granted");
  assert.deepEqual(JSON.parse(items.get(CONSENT_KEY)!), { analytics: "granted", at: "2026-11-01T10:00:00.000Z" });
  writeConsent("denied");
  assert.equal(readConsent(), "denied", "declining is remembered the same way");
  assert.equal(heard, 2);
  stop();
  writeConsent("granted");
  assert.equal(heard, 2);
});

test("blocked storage means no consent, never an error", () => {
  Object.assign(globalThis, { window: Object.assign(new EventTarget(), { localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } }) });
  assert.equal(readConsent(), null);
  assert.doesNotThrow(() => writeConsent("granted"));
});

test("Google Analytics only loads after the player allows it, with ads signals always denied", async () => {
  const client = await readFile(new URL("../lib/firebase-client.ts", import.meta.url), "utf8");
  assert.match(client, /if \(!analyticsIsConfigured \|\| readConsent\(\) !== "granted"\) return null;/);
  assert.ok(client.indexOf("setConsent(consentFor(true))") < client.indexOf("getAnalytics(app)"), "consent is set before GA starts");
  for (const signal of ["ad_storage", "ad_user_data", "ad_personalization"]) assert.match(client, new RegExp(`${signal}: "denied"`));
  const banner = await readFile(new URL("../app/components/ConsentBanner.tsx", import.meta.url), "utf8");
  assert.match(banner, /choose\("denied"\)}[^>]*>No thanks</);
  assert.match(banner, /choose\("granted"\)}[^>]*>Allow</);
});
