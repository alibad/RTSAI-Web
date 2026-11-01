"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { BarChart3 } from "lucide-react";
import { onConsentOpen, openConsentChoices, readConsent, subscribeConsent, writeConsent, type AnalyticsChoice } from "../../lib/consent";
import { analyticsIsConfigured, applyAnalyticsConsent } from "../../lib/firebase-client";

/** The device's analytics choice: undefined while rendering on the server, null before the player chooses. */
export function useAnalyticsChoice() {
  return useSyncExternalStore<AnalyticsChoice | null | undefined>(subscribeConsent, readConsent, () => undefined);
}

export function chooseAnalytics(choice: AnalyticsChoice) {
  writeConsent(choice);
  void applyAnalyticsConsent(choice);
}

/**
 * Asks once, before Google Analytics loads: "No thanks" and "Allow" are the same size, side by side, and either closes
 * it. The footer's "Privacy choices" (and the account page) bring it back.
 */
export function ConsentBanner() {
  const choice = useAnalyticsChoice();
  const [reopened, setReopened] = useState(false);
  useEffect(() => onConsentOpen(() => setReopened(true)), []);

  if (!analyticsIsConfigured || choice === undefined || (choice !== null && !reopened)) return null;
  const choose = (next: AnalyticsChoice) => { chooseAnalytics(next); setReopened(false); };
  return (
    <aside className="consent-banner" aria-label="Analytics choice">
      <span className="consent-icon" aria-hidden="true"><BarChart3 size={18} /></span>
      <div className="consent-copy">
        <strong>Allow analytics?</strong>
        <p>Google Analytics would count visits and matches so we can improve RTS AI. No ads, never your name or email. It stays off unless you allow it. <a href="/privacy#analytics">Details</a></p>
        {choice && <p className="consent-current">Now: {choice === "granted" ? "allowed" : "off"}</p>}
      </div>
      <div className="consent-actions">
        <button type="button" onClick={() => choose("denied")} aria-pressed={choice === "denied"}>No thanks</button>
        <button type="button" onClick={() => choose("granted")} aria-pressed={choice === "granted"}>Allow</button>
      </div>
    </aside>
  );
}

/** Footer link that reopens the banner. */
export function PrivacyChoicesLink() {
  if (!analyticsIsConfigured) return null;
  return <button type="button" className="footer-link-button" onClick={openConsentChoices}>Privacy choices</button>;
}
