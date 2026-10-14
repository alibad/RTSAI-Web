"use client";
/**
 * One call per activity: track("match_started", { mode: "skirmish" }). Every event goes to Google Analytics and, for a
 * signed-in player, to POST /api/event with their ID token, which adds it to the day's rollup for the weekly digest
 * and counts or emails it as lib/event-registry.ts says. Fire and forget: analytics never blocks or breaks the product.
 */
import type { EventName } from "./event-registry";
import { getFirebaseAuth, trackAnalyticsEvent } from "./firebase-client";

export async function track(name: EventName, props: Record<string, string | number | boolean | undefined> = {}) {
  void trackAnalyticsEvent(name, props);
  try {
    const user = getFirebaseAuth()?.currentUser;
    if (!user) return;
    const token = await user.getIdToken();
    await fetch("/api/event", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name, props }) });
  } catch { /* analytics is best-effort */ }
}
