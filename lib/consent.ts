/**
 * The player's analytics choice on this device. Google Analytics is on unless the player turned it off on the account
 * page (owner, 1 Nov 2026: no banner; asking every visitor is worse than counting). The choice lives in localStorage
 * under CONSENT_KEY, so the browser game on the same origin (rtsai.net/play) reads the same answer:
 * { "analytics": "granted" | "denied", "at": ISO time }. No record means on.
 * First-party product events for signed-in players (lib/track.ts → POST /api/event) are not Google Analytics and do not
 * depend on this choice; /privacy says so.
 */
export const CONSENT_KEY = "rtsai.consent.v1";
const CHANGED = "rtsai:consent";

export type AnalyticsChoice = "granted" | "denied";
export type ConsentRecord = { analytics: AnalyticsChoice; at: string };

/** A stored record, or null when there is none or it is not one we wrote. */
export function parseConsent(raw: string | null): ConsentRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ConsentRecord>;
    if (value.analytics !== "granted" && value.analytics !== "denied") return null;
    return { analytics: value.analytics, at: typeof value.at === "string" ? value.at : "" };
  } catch {
    return null;
  }
}

/** The choice made on this device, or null when the player never chose (or storage is blocked): analytics on. */
export function readConsent(): AnalyticsChoice | null {
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_KEY))?.analytics ?? null;
  } catch {
    return null;
  }
}

export function writeConsent(choice: AnalyticsChoice, now = new Date()) {
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ analytics: choice, at: now.toISOString() } satisfies ConsentRecord));
  } catch { /* private mode: the choice still applies to this page */ }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: choice }));
}

/** Calls back when the choice changes here or in another tab. */
export function subscribeConsent(callback: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === CONSENT_KEY || event.key === null) callback(); };
  window.addEventListener(CHANGED, callback);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, callback);
    window.removeEventListener("storage", onStorage);
  };
}
