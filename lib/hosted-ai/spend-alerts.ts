import { escapeHtml } from "../feedback";
import { mailConfigured as firebaseMailConfigured, mailGroup, sendFirebaseEmail } from "../firebase-mail";
import { usdFromMicros } from "./config";
import type { UsageStore } from "./store";

/**
 * Operator email alerts for the global hosted-AI spend.
 *
 * When today's settled spend across every install crosses 50% and then 80% of
 * RTSAI_AI_GLOBAL_DAILY_CAP_USD, one email per threshold per UTC day is queued
 * through the Firebase mail path (rtsai-net's `mail` collection, delivered by the
 * Trigger Email extension) to the team group, the first MAIL_GROUP address.
 *
 * The usage store deduplicates across server instances (claimSpendAlert); a
 * small in-process memo keeps later calls on the same instance from touching
 * the store again. Alerts never contain player data: only totals and the cap.
 */

export const SPEND_ALERT_THRESHOLDS = [50, 80] as const;

/** After a failed send, this instance waits before retrying the same alert. */
const RETRY_AFTER_FAILURE_MS = 5 * 60_000;

export type SendMail = typeof sendFirebaseEmail;

type AlertInput = {
  store: UsageStore;
  day: string;
  spentMicros: number;
  capMicros: number;
  now: number;
  sendMail?: SendMail;
};

/** `${day}:${threshold}` → earliest time this instance may try again (Infinity once handled). */
const memo = new Map<string, number>();
let warnedUnconfigured = false;

/** Test helper: forget what this instance has already handled, as a fresh server instance would. */
export function resetSpendAlertMemo() {
  memo.clear();
  warnedUnconfigured = false;
}

export function spendAlertRecipient() {
  return mailGroup()[0] || "";
}

function mailConfigured() {
  return firebaseMailConfigured() && Boolean(spendAlertRecipient());
}

/** Thresholds (percent) that today's settled spend has reached. */
export function reachedThresholds(spentMicros: number, capMicros: number) {
  if (capMicros <= 0) return [];
  return SPEND_ALERT_THRESHOLDS.filter((threshold) => spentMicros * 100 >= capMicros * threshold);
}

const usd = (micros: number) => `$${usdFromMicros(micros).toFixed(2)}`;

export function createSpendAlertEmail(input: { day: string; thresholdPercent: number; spentMicros: number; capMicros: number }) {
  const { day, thresholdPercent, spentMicros, capMicros } = input;
  const subject = `RTS AI hosted AI spend passed ${thresholdPercent}% of today's cap (${usd(spentMicros)} of ${usd(capMicros)})`;
  const lines = [
    `Hosted AI spend on ${day} (UTC) has reached ${usd(spentMicros)}, at least ${thresholdPercent}% of the ${usd(capMicros)} daily cap.`,
    "At 100% the proxy refuses new model calls with 503 global_budget_exhausted until 00:00 UTC, and the game falls back to local AI or alert lines.",
    "To raise the cap: set RTSAI_AI_GLOBAL_DAILY_CAP_USD in Vercel (takes effect on the next deployment).",
    "To stop spend now: disable the API key in the Anthropic Console. RTSAI_AI_KILL_SWITCH=1 pauses calls after the next deployment.",
  ];
  const text = `${subject}\n\n${lines.join("\n\n")}\n`;
  const html = `<!doctype html><html><body style="margin:0;background:#111411;color:#f0eee6;font-family:Arial,sans-serif"><div style="max-width:680px;margin:0 auto;padding:40px 24px"><p style="margin:0 0 8px;color:#ef5b3f;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">RTS AI hosted AI · spend alert</p><h1 style="margin:0 0 18px;font-size:28px;line-height:1.15">${escapeHtml(`${thresholdPercent}% of today's cap used`)}</h1>${lines.map((line) => `<p style="margin:0 0 14px;color:#d5d7cf;font-size:15px;line-height:1.55">${escapeHtml(line)}</p>`).join("")}</div></body></html>`;
  return { subject, text, html };
}

/**
 * Queues any newly reached threshold alerts. Never throws: alerting must not
 * fail or delay a player's answer beyond the rare call that crosses a threshold.
 */
export async function sendSpendAlerts(input: AlertInput) {
  const { store, day, spentMicros, capMicros, now } = input;
  const thresholds = reachedThresholds(spentMicros, capMicros);
  if (!thresholds.length) return [];
  if (!mailConfigured()) {
    if (!warnedUnconfigured) console.warn("Hosted AI spend alerts are not configured (NEXT_PUBLIC_FIREBASE_PROJECT_ID, NEXT_PUBLIC_FIREBASE_API_KEY, MAIL_GROUP)");
    warnedUnconfigured = true;
    return [];
  }
  for (const key of memo.keys()) if (!key.startsWith(`${day}:`)) memo.delete(key);

  const sent: number[] = [];
  for (const thresholdPercent of thresholds) {
    const key = `${day}:${thresholdPercent}`;
    if ((memo.get(key) ?? 0) > now) continue;
    memo.set(key, Number.POSITIVE_INFINITY);
    let claimed = false;
    try {
      claimed = await store.claimSpendAlert(day, thresholdPercent, { spentMicros, capMicros, claimedAt: now });
      if (!claimed) continue;
      const email = createSpendAlertEmail({ day, thresholdPercent, spentMicros, capMicros });
      await (input.sendMail ?? sendFirebaseEmail)({ to: spendAlertRecipient(), subject: email.subject, html: email.html, text: email.text });
      sent.push(thresholdPercent);
      console.info("hosted-ai spend alert queued", { day, threshold: thresholdPercent, spent_usd: usdFromMicros(spentMicros) });
    } catch (cause) {
      memo.set(key, now + RETRY_AFTER_FAILURE_MS);
      console.error("Hosted AI spend alert failed", { threshold: thresholdPercent, message: cause instanceof Error ? cause.message.slice(0, 200) : "unknown" });
      if (claimed) await store.releaseSpendAlert(day, thresholdPercent).catch(() => undefined);
    }
  }
  return sent;
}
