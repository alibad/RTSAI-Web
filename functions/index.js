// RTS AI's mail sender, a Firebase function. The website (RTSAI-Web lib/firebase-mail.ts) writes each email as a
// Firestore mail/{id} document (shaped by firestore.rules "Outgoing mail") and then calls this function with its id;
// the function sends it over SMTP and writes the Trigger Email extension's delivery record back (send.js).
// Why a call and not a Firestore trigger: a trigger must run in the database's region, and rtsai-net's database is in
// me-central2 (Dammam), where Google offers no Cloud Functions or Cloud Run without a sales agreement. Firebase
// Extensions shut down on 31 March 2027 anyway. The mailbox password is the SMTP_PASSWORD secret:
//   firebase functions:secrets:set SMTP_PASSWORD --project rtsai-net     (once)
//   firebase deploy --only functions --project rtsai-net
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import nodemailer from "nodemailer";
import { transportFor } from "./mail.js";
import { deliver } from "./send.js";

const SMTP_PASSWORD = defineSecret("SMTP_PASSWORD");
// Not secrets; the local emulator test points them at its own SMTP server (functions/.env.local).
const SMTP_URI = process.env.SMTP_URI || "smtps://humanque@mail.humanquest.net:465";
const defaults = { from: process.env.MAIL_FROM || "RTS AI <info@humanquest.net>", replyTo: process.env.MAIL_REPLY_TO || "ali@humanquest.net" };

initializeApp();
let cached = null;
const transport = () => (cached ??= nodemailer.createTransport(transportFor(SMTP_URI, SMTP_PASSWORD.value())));

export const sendMail = onRequest(
  { region: "europe-west1", secrets: [SMTP_PASSWORD], maxInstances: 3, timeoutSeconds: 60, memory: "256MiB", cors: false },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    // Any signed-in or anonymous user of the project: the rules already decide what a mail document may say and to whom.
    const token = String(req.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    try { await getAuth().verifyIdToken(token); } catch { res.status(401).json({ error: "Sign in required" }); return; }
    const id = String(req.body?.id ?? "");
    if (!/^[A-Za-z0-9]{20}$/.test(id)) { res.status(400).json({ error: "Invalid mail id" }); return; }
    const db = getFirestore();
    try {
      const state = await deliver(db, db.collection("mail").doc(id), { transport, defaults, logger });
      res.status(200).json({ id, state: state ?? "ALREADY_CLAIMED" });
    } catch (error) {
      cached = null;
      res.status(502).json({ id, state: "ERROR", error: String(error?.message ?? error).slice(0, 300) });
    }
  },
);
