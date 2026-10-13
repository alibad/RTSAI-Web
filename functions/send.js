// Delivering one mail document: claim it once (events arrive at least once), send it over SMTP, and write the
// Trigger Email extension's delivery record back on it: PROCESSING, then SUCCESS (with the server's reply) or ERROR.
import { FieldValue } from "firebase-admin/firestore";
import { messageFor } from "./mail.js";

/** Sends mail/{id} at `ref` unless it was already claimed; returns the final state, or null when skipped. */
export async function deliver(db, ref, { transport, defaults, logger = console }) {
  const doc = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get("delivery.state")) return null;
    tx.update(ref, { "delivery.state": "PROCESSING", "delivery.attempts": FieldValue.increment(1), "delivery.startTime": FieldValue.serverTimestamp() });
    return snap.data();
  });
  if (!doc) return null;
  try {
    const info = await transport().sendMail(messageFor(doc, defaults));
    await ref.update({
      "delivery.state": "SUCCESS", "delivery.endTime": FieldValue.serverTimestamp(),
      "delivery.info": { messageId: info.messageId ?? null, accepted: info.accepted ?? [], rejected: info.rejected ?? [], response: info.response ?? null },
    });
    logger.info?.(JSON.stringify({ message: "mail sent", id: ref.id, accepted: info.accepted?.length ?? 0 }));
    return "SUCCESS";
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 500);
    await ref.update({ "delivery.state": "ERROR", "delivery.endTime": FieldValue.serverTimestamp(), "delivery.error": message });
    logger.error?.(JSON.stringify({ severity: "ERROR", message: "mail failed", id: ref.id, error: message }));
    throw error;
  }
}
