// RTS AI's own Firebase functions (codebase "mail", europe-west1):
//   sendMail       the mail sender. The website (RTSAI-Web lib/firebase-mail.ts) writes each email as a Firestore mail/{id}
//                  document (shaped by firestore.rules "Outgoing mail") and then calls this function with its id; the
//                  function sends it over SMTP and writes the Trigger Email extension's delivery record back (send.js).
//   recordEvent    daily rollups. The website's /api/event and /api/feedback routes pass on each signed-in player's event;
//                  it is added to the player's Doha day in dailyStats (record.js, whitelisted by rollup.js).
//   weeklyDigest   every Monday 08:00 Doha time, one email to the team group: last week's players, matches by mode and
//                  faction, sign-ups, feedback and errors (weekly.js, digest.js), delivered like any other mail document.
//   account        a signed-in player's own data (account.js), called by the website's /api/account with the player's ID
//                  token: GET returns it all as JSON, DELETE (after a sign-in in the last ten minutes) erases it and the
//                  account, then mails the team the steps left by hand.
//   sendDigestNow  the digest on demand, for the project's owners only (Cloud Run IAM, not public):
//                    curl -X POST -d "" -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
//                      https://europe-west1-rtsai-net.cloudfunctions.net/sendDigestNow
//                  ?preview=1 returns the email's HTML without sending; ?window=lastWeek covers last Monday to Sunday
//                  (default: the last 7 days up to now).
//   relay          the web game's multiplayer relay (relay.js): a signed-in player's browser asks for short-lived
//                  Cloudflare TURN credentials before it connects to the other players, so two networks that cannot
//                  reach each other still play. The relay key's secret is TURN_KEY_API_TOKEN:
//                    firebase functions:secrets:set TURN_KEY_API_TOKEN --project rtsai-net     (once)
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
import { gatherDigest, sendDigest, TEAM_GROUP } from "./weekly.js";
import { deletionNotice, eraseAccount, exportAccount, recentLogin } from "./account.js";
import { relayServers } from "./relay.js";

const SMTP_PASSWORD = defineSecret("SMTP_PASSWORD");
const TURN_KEY_API_TOKEN = defineSecret("TURN_KEY_API_TOKEN");
// The Cloudflare TURN key: the "rtsai-multiplayer" app under Realtime > TURN Server in the Cloudflare dashboard
// (created 20 Nov 2026). Its id is not a secret; its token is (TURN_KEY_API_TOKEN).
const TURN_KEY_ID = process.env.TURN_KEY_ID || "a71c061da6e2d02e39ef1357f3e82a58";
// The web game calls the relay function from its own page: rtsai.net/play, or a local test build.
const GAME_ORIGINS = [/^https:\/\/(www\.)?rtsai\.net$/, /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/];
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

// The player's own account only: the uid comes from their verified, unrevoked ID token, never from the request.
export const account = onRequest(
  { region, secrets: [SMTP_PASSWORD], maxInstances: 5, timeoutSeconds: 300, memory: "512MiB", cors: false },
  async (req, res) => {
    if (req.method !== "GET" && req.method !== "DELETE") { res.status(405).json({ error: "GET or DELETE only" }); return; }
    let user;
    try { user = await getAuth().verifyIdToken(bearer(req), true); } catch { res.status(401).json({ error: "Sign in required" }); return; }
    if (user.firebase?.sign_in_provider === "anonymous") { res.status(403).json({ error: "Players only" }); return; }
    const db = getFirestore();
    try {
      if (req.method === "GET") { res.status(200).json(await exportAccount(db, getAuth(), user.uid)); return; }
      if (!recentLogin(user)) { res.status(401).json({ error: "Sign in again to delete your account", reauthenticate: true }); return; }
      const removed = await eraseAccount(db, getAuth(), user.uid);
      if (!removed) { res.status(410).json({ error: "This account is already deleted" }); return; }
      logger.info(JSON.stringify({ message: "account deleted", uid: user.uid, ...removed }));
      let notified = false;
      try {
        const ref = db.collection("mail").doc();
        await ref.create({ to: [TEAM_GROUP], message: deletionNotice(user.uid, removed) });
        notified = (await deliver(db, ref, { transport, defaults, logger })) === "SUCCESS";
      } catch (error) {
        cached = null;
        logger.error(JSON.stringify({ severity: "ERROR", message: "deletion notice failed", uid: user.uid, error: short(error) }));
      }
      res.status(200).json({ deleted: true, removed, notified });
    } catch (error) {
      logger.error(JSON.stringify({ severity: "ERROR", message: `account ${req.method} failed`, uid: user.uid, error: short(error) }));
      // Auth goes last, so after a failure the account still exists and trying again finishes the job.
      res.status(500).json({ error: req.method === "GET" ? "Your data could not be gathered. Try again." : "Deleting stopped part way. Your account is still there: try again." });
    }
  },
);

// Signed-in players only (never anonymous): every credential can carry traffic the account pays for, so it goes to a
// verified account and expires after a few hours (RELAY_TTL_S). A failure answers 503 and the game connects without
// a relay, as before.
export const relay = onRequest(
  { region, secrets: [TURN_KEY_API_TOKEN], maxInstances: 5, timeoutSeconds: 20, memory: "256MiB", cors: GAME_ORIGINS },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
    let user;
    try { user = await getAuth().verifyIdToken(bearer(req)); } catch { res.status(401).json({ error: "Sign in required" }); return; }
    if (user.firebase?.sign_in_provider === "anonymous") { res.status(403).json({ error: "Players only" }); return; }
    try {
      const { iceServers, ttl } = await relayServers({ keyId: TURN_KEY_ID, token: TURN_KEY_API_TOKEN.value() });
      logger.info(JSON.stringify({ message: "relay credentials", uid: user.uid }));
      res.set("Cache-Control", "no-store").status(200).json({ iceServers, expires: Date.now() + ttl * 1000 });
    } catch (error) {
      logger.error(JSON.stringify({ severity: "ERROR", message: "relay credentials failed", uid: user.uid, error: short(error) }));
      res.status(503).json({ error: "No relay right now" });
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
