"use client";
/**
 * One call per activity: track("match_started", { mode: "skirmish" }). Every event goes to Google Analytics; events
 * that count or can email (see lib/event-registry.ts) also go to POST /api/event with the player's ID token. Fire and
 * forget: analytics never blocks or breaks the product.
 */
import { EVENTS, type EventName } from "./event-registry";
import { getFirebaseAuth, trackAnalyticsEvent } from "./firebase-client";

export async function track(name: EventName, props: Record<string, string | number | boolean | undefined> = {}) {
  void trackAnalyticsEvent(name, props);
  const spec = EVENTS[name];
  if (spec.email === "never" && !("player" in spec) && !("global" in spec)) return;
  try {
    const user = getFirebaseAuth()?.currentUser;
    if (!user) return;
    const token = await user.getIdToken();
    await fetch("/api/event", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name, props }) });
  } catch { /* analytics is best-effort */ }
}
