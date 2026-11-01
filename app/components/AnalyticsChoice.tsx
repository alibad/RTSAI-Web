"use client";

import { useSyncExternalStore } from "react";
import { readConsent, subscribeConsent, writeConsent, type AnalyticsChoice } from "../../lib/consent";
import { applyAnalyticsConsent } from "../../lib/firebase-client";

/** The device's analytics choice: undefined while rendering on the server, null when the player never turned it off. */
export function useAnalyticsChoice() {
  return useSyncExternalStore<AnalyticsChoice | null | undefined>(subscribeConsent, readConsent, () => undefined);
}

/** The account page's switch: "denied" turns Google Analytics off on this device, "granted" back on. */
export function chooseAnalytics(choice: AnalyticsChoice) {
  writeConsent(choice);
  void applyAnalyticsConsent(choice);
}
