// RTS AI's own Firebase functions (codebase "mail", europe-west1):
//   sendMail       the mail sender. The website (RTSAI-Web lib/firebase-mail.ts) writes each email as a Firestore mail/{id}
//                  document (shaped by firestore.rules "Outgoing mail") and then calls this function with its id; the
//                  function sends it over SMTP and writes the Trigger Email extension's delivery record back (send.js).
//   recordEvent    daily rollups. The website's /api/event and /api/feedback routes pass on each signed-in player's event;
//                  it is added to the player's Doha day in dailyStats (record.js, whitelisted by rollup.js).
//   weeklyDigest   every Monday 08:00 Doha time, one email to the team group: last week's players, matches by mode and
//                  faction, sign-ups, feedback and errors (weekly.js, digest.js), delivered like any other mail document.
//   sendDigestNow  the digest on demand, for the project's owners only (Cloud Run IAM, not public):
//                    curl -X POST -d "" -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
//                      https://europe-west1-rtsai-net.cloudfunctions.net/sendDigestNow
//                  ?preview=1 returns the email's HTML without sending; ?window=lastWeek covers last Monday to Sunday
//                  (default: the last 7 days up to now).
// Why calls and not Firestore triggers: a trigger must run in the database's region, and rtsai-net's database is in
// me-central2 (Dammam), where Google offers no Cloud Functions or Cloud Run without a sales agreement. Firebase
// Extensions shut down on 31 March 2027 anyway. The mailbox password is the SMTP_PASSWORD secret:
//   firebase functions:secrets:set SMTP_PASSWORD --project rtsai-net     (once)
//   firebase deploy --only functions:mail --project rtsai-net
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import nodemailer from "nodemailer";
import { transportFor } from "./mail.js";
import { deliver } from "./send.js";
import { recordEvent as record } from "./record.js";
import { EVENT_NAMES } from "./rollup.js";
import { digestWindow, renderDigest } from "./digest.js";
import { gatherDigest, sendDigest } from "./weekly.js";

const SMTP_PASSWORD = defineSecret("SMTP_PASSWORD");
// Not secrets; the local emulator test points them at its own SMTP server (functions/.env.local).
const SMTP_URI = process.env.SMTP_URI || "smtps://humanque@mail.humanquest.net:465";
const defaults = { from: process.env.MAIL_FROM || "RTS AI <info@humanquest.net>", replyTo: process.env.MAIL_REPLY_TO || "ali@humanquest.net" };
const region = "europe-west1";

initializeApp();
let cached = null;
const transport = () => (cached ??= nodemailer.createTransport(transportFor(SMTP_URI, SMTP_PASSWORD.value())));
const bearer = (req) => String(req.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
const short = (error) => String(error?.message ?? error).slice(0, 300);

export const sendMail = onRequest(
  { region, secrets: [SMTP_PASSWORD], maxInstances: 3, timeoutSeconds: 60, memory: "256MiB", cors: false },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    // Any signed-in or anonymous user of the project: the rules already decide what a mail document may say and to whom.
    try { await getAuth().verifyIdToken(bearer(req)); } catch { res.status(401).json({ error: "Sign in required" }); return; }
    const id = String(req.body?.id ?? "");
    if (!/^[A-Za-z0-9]{20}$/.test(id)) { res.status(400).json({ error: "Invalid mail id" }); return; }
    const db = getFirestore();
    try {
      const state = await deliver(db, db.collection("mail").doc(id), { transport, defaults, logger });
      res.status(200).json({ id, state: state ?? "ALREADY_CLAIMED" });
    } catch (error) {
      cached = null;
      res.status(502).json({ id, state: "ERROR", error: short(error) });
    }
  },
);

// Signed-in players only (never anonymous): the event is theirs, and dailyStats has no client rule at all, so this
// function and rollup.js's whitelist are the only way in. A player can only add their own events, one at a time.
export const recordEvent = onRequest(
  { region, maxInstances: 20, timeoutSeconds: 30, memory: "256MiB", cors: false },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    if (Number(req.get("content-length") ?? 0) > 8_000) { res.status(413).json({ error: "Event too large" }); return; }
    let user;
    try { user = await getAuth().verifyIdToken(bearer(req)); } catch { res.status(401).json({ error: "Sign in required" }); return; }
    if (user.firebase?.sign_in_provider === "anonymous") { res.status(403).json({ error: "Players only" }); return; }
    const name = req.body?.name;
    if (!EVENT_NAMES.includes(name)) { res.status(400).json({ error: "Unknown event" }); return; }
    try {
      res.status(200).json({ ok: true, ...(await record(getFirestore(), { uid: user.uid, name, props: req.body?.props })) });
    } catch (error) {
      logger.error(JSON.stringify({ severity: "ERROR", message: "rollup failed", event: name, error: short(error) }));
      res.status(500).json({ error: "Not recorded" });
    }
  },
);

export const weeklyDigest = onSchedule(
  { region, schedule: "0 8 * * 1", timeZone: "Asia/Qatar", secrets: [SMTP_PASSWORD], retryCount: 2, timeoutSeconds: 300, memory: "256MiB", maxInstances: 1 },
  async (event) => {
    // The scheduled time, not the clock: a retry covers the same week and finds the same mail document.
    const now = event?.scheduleTime ? new Date(event.scheduleTime) : new Date();
    try {
      const result = await sendDigest(getFirestore(), getAuth(), { now, id: `weekly-${digestWindow(now).days[0]}`, transport, defaults, logger });
      logger.info(JSON.stringify({ message: "weekly digest", ...result }));
    } catch (error) {
      cached = null;
      throw error;
    }
  },
);

export const sendDigestNow = onRequest(
  { region, invoker: "private", secrets: [SMTP_PASSWORD], maxInstances: 1, timeoutSeconds: 120, memory: "256MiB", cors: false },
  async (req, res) => {
    const throughToday = req.query.window !== "lastWeek";
    try {
      if (req.query.preview === "1") {
        const { subject, html } = renderDigest(await gatherDigest(getFirestore(), getAuth(), { throughToday, logger }));
        res.set("X-Digest-Subject", encodeURIComponent(subject)).type("html").send(html);
        return;
      }
      if (req.method !== "POST") { res.status(405).json({ error: "POST to send, or GET ?preview=1" }); return; }
      const result = await sendDigest(getFirestore(), getAuth(), { throughToday, transport, defaults, logger });
      res.status(result.state === "SUCCESS" ? 200 : 502).json(result);
    } catch (error) {
      cached = null;
      res.status(502).json({ state: "ERROR", error: short(error) });
    }
  },
);
