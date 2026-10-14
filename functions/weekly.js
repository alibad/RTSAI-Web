// The weekly digest's data and its one email: reads a week of dailyStats (and the week before), the players active in
// it (their day documents, plus players/{uid}.lastSeen from before the rollups existed), new accounts from Firebase
// Auth, stats/global and the week's top game errors; renders digest.js; writes a mail/{id} document and delivers it
// with send.js, like every other team email.
import { FieldValue } from "firebase-admin/firestore";
import { digestWindow, renderDigest } from "./digest.js";
import { deliver } from "./send.js";

export const TEAM_GROUP = "rtsai@googlegroups.com";

async function playersOn(db, dates) {
  const lists = await Promise.all(dates.map((d) => db.collection("dailyStats").doc(d).collection("players").listDocuments()));
  return lists.flat().map((ref) => ref.id);
}

async function seenBetween(db, start, end) {
  const snap = await db.collection("players").where("lastSeen", ">=", start).where("lastSeen", "<", end).select().get();
  return snap.docs.map((d) => d.id);
}

/** Accounts that aren't anonymous (the site's server mails as anonymous users), and how many were created in each window. */
async function accounts(auth, w) {
  let token, total = 0, current = 0, previous = 0;
  do {
    const page = await auth.listUsers(1000, token);
    for (const user of page.users) {
      if (!user.providerData?.length) continue;
      total++;
      const created = Date.parse(user.metadata.creationTime);
      if (created >= w.start.getTime() && created < w.end.getTime()) current++;
      else if (created >= w.previousStart.getTime() && created < w.start.getTime()) previous++;
    }
    token = page.pageToken;
  } while (token);
  return { total, current, previous };
}

async function topErrors(db, dates) {
  const snaps = await Promise.all(dates.map((d) => db.collection("dailyStats").doc(d).collection("errors").get()));
  const merged = new Map();
  for (const doc of snaps.flatMap((s) => s.docs)) {
    const e = merged.get(doc.id) ?? { message: doc.get("message") ?? "unknown", where: doc.get("where") ?? "unknown", count: 0 };
    e.count += Number(doc.get("count") ?? 0);
    merged.set(doc.id, e);
  }
  return [...merged.values()].sort((a, b) => b.count - a.count).slice(0, 5);
}

export async function gatherDigest(db, auth, { now = new Date(), throughToday = false, logger = console } = {}) {
  const w = digestWindow(now, { throughToday });
  const refs = [...w.days, ...w.previous].map((d) => db.collection("dailyStats").doc(d));
  const snaps = await db.getAll(...refs);
  const docs = snaps.map((s, i) => ({ ...(s.exists ? s.data() : {}), date: refs[i].id }));
  // Without Auth (a missing permission), new players fall back to the sign_up events the rollups saw.
  const signUps = (list) => list.reduce((sum, d) => sum + Number(d.events?.sign_up ?? 0), 0);
  const [current, earlier, seenNow, seenBefore, people, errors, global] = await Promise.all([
    playersOn(db, w.days), playersOn(db, w.previous),
    seenBetween(db, w.start, w.end), seenBetween(db, w.previousStart, w.start),
    accounts(auth, w).catch((error) => {
      logger.warn?.(JSON.stringify({ message: "digest: Auth users unavailable, using sign_up events", error: String(error?.message ?? error).slice(0, 200) }));
      return { total: 0, current: signUps(docs.slice(0, 7)), previous: signUps(docs.slice(7)) };
    }),
    topErrors(db, w.days), db.doc("stats/global").get(),
  ]);
  return {
    window: w,
    days: docs.slice(0, 7), previous: docs.slice(7),
    active: new Set([...current, ...seenNow]).size, previousActive: new Set([...earlier, ...seenBefore]).size,
    newPlayers: people.current, previousNewPlayers: people.previous, accounts: people.total,
    global: global.exists ? global.data() : {},
    errors,
  };
}

/**
 * Builds and sends one digest to the team group. `id` names the mail document (the Monday digest uses one per week,
 * so a retried run never sends twice, but does retry a failed delivery). Returns the mail id, its delivery state and
 * the subject.
 */
export async function sendDigest(db, auth, { now = new Date(), throughToday = false, id, to = TEAM_GROUP, transport, defaults, logger = console }) {
  const input = await gatherDigest(db, auth, { now, throughToday, logger });
  const { subject, html, text } = renderDigest(input);
  const ref = id ? db.collection("mail").doc(id) : db.collection("mail").doc();
  const document = { to: [to], message: { subject, html, text }, digest: { first: input.window.days[0], last: input.window.days[6], throughToday } };
  try {
    await ref.create(document);
  } catch (error) {
    if (error?.code !== 6) throw error; // ALREADY_EXISTS: this week's digest was written before
    const state = (await ref.get()).get("delivery.state");
    if (state === "SUCCESS" || state === "PROCESSING") return { id: ref.id, state: `ALREADY_${state}`, subject };
    if (state === "ERROR") await ref.update({ delivery: FieldValue.delete() });
  }
  const state = await deliver(db, ref, { transport, defaults, logger });
  return { id: ref.id, state: state ?? "ALREADY_CLAIMED", subject };
}
