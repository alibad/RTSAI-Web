// RTS AI's mail sender. Every new document in Firestore `mail` (written by RTSAI-Web lib/firebase-mail.ts, shaped by
// firestore.rules "Outgoing mail") is sent over SMTP, and its delivery state is written back on it, the same contract
// as the Trigger Email extension it replaces (Firebase Extensions shut down on 31 March 2027):
//   delivery: { state: PROCESSING → SUCCESS | ERROR, attempts, startTime, endTime, error, info }
// It runs next to the database (me-central2). The mailbox password is a Secret Manager secret:
//   firebase functions:secrets:set SMTP_PASSWORD --project rtsai-net     (once)
//   firebase deploy --only functions --project rtsai-net
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import nodemailer from "nodemailer";
import { messageFor, transportFor } from "./mail.js";

const SMTP_PASSWORD = defineSecret("SMTP_PASSWORD");
// Not secrets; the local emulator test points them at its own SMTP server (functions/.env.local).
const SMTP_URI = process.env.SMTP_URI || "smtps://humanque@mail.humanquest.net:465";
const DEFAULTS = { from: process.env.MAIL_FROM || "RTS AI <info@humanquest.net>", replyTo: process.env.MAIL_REPLY_TO || "ali@humanquest.net" };

initializeApp();
let transport = null;

export const sendMail = onDocumentCreated(
  { document: "mail/{id}", region: "me-central2", secrets: [SMTP_PASSWORD], maxInstances: 3, timeoutSeconds: 60, memory: "256MiB" },
  async (event) => {
    const ref = event.data?.ref;
    if (!ref) return;
    // Claim it once: Firestore events are delivered at least once.
    const doc = await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.get("delivery.state")) return null;
      tx.update(ref, { "delivery.state": "PROCESSING", "delivery.attempts": FieldValue.increment(1), "delivery.startTime": FieldValue.serverTimestamp() });
      return snap.data();
    });
    if (!doc) return;
    try {
      transport ??= nodemailer.createTransport(transportFor(SMTP_URI, SMTP_PASSWORD.value()));
      const info = await transport.sendMail(messageFor(doc, DEFAULTS));
      await ref.update({
        "delivery.state": "SUCCESS", "delivery.endTime": FieldValue.serverTimestamp(),
        "delivery.info": { messageId: info.messageId ?? null, accepted: info.accepted ?? [], rejected: info.rejected ?? [], response: info.response ?? null },
      });
      logger.info("mail sent", { id: ref.id, accepted: info.accepted?.length ?? 0 });
    } catch (error) {
      transport = null;
      const message = String(error?.message ?? error).slice(0, 500);
      await ref.update({ "delivery.state": "ERROR", "delivery.endTime": FieldValue.serverTimestamp(), "delivery.error": message });
      logger.error("mail failed", { id: ref.id, error: message });
    }
  },
);
