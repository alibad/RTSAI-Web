// A player's own data in rtsai-net, for the account page (RTSAI-Web app/account, through its /api/account route):
// exportAccount gathers it into one JSON file, eraseAccount deletes it. Both act only on the caller's own verified uid,
// never on an id from the request. What the player has here:
//   Firebase Auth user                       name, email, photo, sign-in methods, dates (deleted last)
//   players/{uid}                            usage counters and lastSeen (lib/player-stats.ts)
//   maps/{id}, mapData/{id} (owner)          saved Earth maps (lib/saved-maps.ts)
//   feedbackReports/{id} (owner)             feedback screenshots, voice notes and files, with chunks and file records
//   dailyStats/{day}/players/{uid}           first/last seen, event count and last match start per Doha day (record.js)
//   p2pMatches/{code} (host), joins (guest)  multiplayer introductions, normally gone within minutes
//   aiInstalls/{id} (linkedUid)              hosted AI installs linked to the account: unlinked, not deleted
//   mail/{id} naming the uid                 team emails about the player (event notices, feedback alerts)
// Outside Firebase, and so finished by hand from the team notice: feedback issues on GitHub, the Google Group's copies
// of team emails, and Google Analytics' records for the user ID.
import { FieldPath, FieldValue } from "firebase-admin/firestore";

/** Deleting needs a sign-in from the last ten minutes, so an old session on a shared computer can't do it. */
export const RECENT_LOGIN_SECONDS = 600;

export function recentLogin(token, nowMs = Date.now(), maxAgeSeconds = RECENT_LOGIN_SECONDS) {
  return typeof token?.auth_time === "number" && nowMs / 1000 - token.auth_time <= maxAgeSeconds;
}

/** Firestore values as plain JSON: times as ISO strings, binary data as its size only. */
export function plain(value) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return { bytes: value.length };
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

async function playerDays(db, uid) {
  const days = await db.collection("dailyStats").listDocuments();
  const refs = days.map((day) => day.collection("players").doc(uid)), found = [];
  for (let i = 0; i < refs.length; i += 300) found.push(...(await db.getAll(...refs.slice(i, i + 300))).filter((s) => s.exists));
  return found;
}

async function guestJoins(db, uid) {
  const matches = await db.collection("p2pMatches").listDocuments();
  return (await Promise.all(matches.map((m) => m.collection("joins").where("guest", "==", uid).get()))).flatMap((s) => s.docs);
}

/** Team emails that name the player: every event notice and feedback alert carries the account ID in its text. */
async function mailNaming(db, uid) {
  const found = [];
  let last = null;
  for (;;) {
    let query = db.collection("mail").orderBy(FieldPath.documentId()).select("message.subject", "message.text", "delivery.endTime").limit(500);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    found.push(...page.docs.filter((doc) => String(doc.get("message.text") ?? "").includes(uid)));
    if (page.size < 500) return found;
    last = page.docs.at(-1);
  }
}

const userNotFound = (error) => error?.code === "auth/user-not-found";

/** Everything above for one uid; `user` is null when the Auth account no longer exists. */
export async function findAccount(db, auth, uid) {
  const [user, player, maps, mapData, reports, days, hosted, joins, installs, mail] = await Promise.all([
    auth.getUser(uid).catch((error) => (userNotFound(error) ? null : Promise.reject(error))),
    db.collection("players").doc(uid).get(),
    db.collection("maps").where("owner", "==", uid).get(),
    db.collection("mapData").where("owner", "==", uid).get(),
    db.collection("feedbackReports").where("owner", "==", uid).get(),
    playerDays(db, uid),
    db.collection("p2pMatches").where("host", "==", uid).get(),
    guestJoins(db, uid),
    db.collection("aiInstalls").where("linkedUid", "==", uid).get(),
    mailNaming(db, uid),
  ]);
  return { user, player, maps: maps.docs, mapData: mapData.docs, reports: reports.docs, days, hosted: hosted.docs, joins, installs: installs.docs, mail };
}

export const OUTSIDE_FIREBASE = [
  "Google Analytics: only if you allowed analytics, events tied to your account ID (no name or email). Deleting your account asks the team to delete them.",
  "GitHub: feedback you sent is kept as a private issue on the team's repository, with your name and email. Deleting your account asks the team to remove them.",
  "Team email archive: copies of the team emails listed under teamEmails are also kept in the team's Google Group. Deleting your account asks the team to remove them.",
  "Your browser: your sign-in, your analytics choice and game settings are stored on your own device. Clear them in your browser's site settings.",
];

export async function exportAccount(db, auth, uid, now = new Date()) {
  const found = await findAccount(db, auth, uid);
  const yaml = new Map(found.mapData.map((doc) => [doc.id, doc.get("yaml") ?? null]));
  const reports = await Promise.all(found.reports.map(async (doc) => ({
    id: doc.id, ...plain(doc.data()),
    files: (await doc.ref.collection("files").get()).docs.map((file) => ({ id: file.id, ...plain(file.data()) })),
  })));
  const user = found.user;
  return {
    about: "Everything RTS AI keeps about your account in its Firebase project (rtsai-net), as of exportedAt. See https://rtsai.net/privacy.",
    exportedAt: now.toISOString(),
    account: user && {
      uid: user.uid, email: user.email ?? null, emailVerified: user.emailVerified, name: user.displayName ?? null, photoURL: user.photoURL ?? null,
      signInMethods: user.providerData.map((p) => p.providerId), created: user.metadata.creationTime, lastSignIn: user.metadata.lastSignInTime,
    },
    stats: found.player.exists ? plain(found.player.data()) : null,
    savedMaps: found.maps.map((doc) => ({ id: doc.id, ...plain(doc.data()), mapYaml: yaml.get(doc.id) ?? null, openInGame: `https://rtsai.net/play/?saved=${doc.id}` })),
    feedbackFiles: reports,
    dailyActivity: found.days.map((doc) => ({ day: doc.ref.parent.parent.id, ...plain(doc.data()) })),
    multiplayerIntroductions: [...found.hosted, ...found.joins].map((doc) => ({ path: doc.ref.path, ...plain(doc.data()) })),
    hostedAiInstalls: found.installs.map((doc) => ({ id: doc.id, ...plain(doc.data()) })),
    teamEmails: found.mail.map((doc) => ({ id: doc.id, subject: doc.get("message.subject") ?? "", text: doc.get("message.text") ?? "", sent: plain(doc.get("delivery.endTime")) })),
    outsideFirebase: OUTSIDE_FIREBASE,
  };
}

/** Deletes the player's data, then their Auth account; returns how much went. Safe to repeat while the account exists. */
export async function eraseAccount(db, auth, uid) {
  const found = await findAccount(db, auth, uid);
  if (!found.user) return null;
  const writer = db.bulkWriter();
  if (found.player.exists) writer.delete(found.player.ref);
  for (const doc of [...found.maps, ...found.mapData, ...found.days, ...found.joins, ...found.mail]) writer.delete(doc.ref);
  for (const doc of found.installs) writer.update(doc.ref, { linkedUid: null, linkedAt: FieldValue.delete() });
  await writer.close();
  for (const doc of [...found.reports, ...found.hosted]) await db.recursiveDelete(doc.ref);
  await auth.deleteUser(uid);
  return {
    stats: found.player.exists ? 1 : 0, savedMaps: found.maps.length, feedbackReports: found.reports.length, dailyRecords: found.days.length,
    multiplayer: found.hosted.length + found.joins.length, aiInstallsUnlinked: found.installs.length, teamEmails: found.mail.length,
  };
}

/** The team's to-do after a deletion: what went automatically, and the three places only a person can clear. */
// Feedback issues live in the private Human Quest inbox, labelled app:rtsai (lib/github.ts, lib/feedback.ts).
export function deletionNotice(uid, removed, { at = new Date(), issues = "https://github.com/alibad/humanquest-feedback/issues" } = {}) {
  const done = Object.entries(removed).map(([what, n]) => `${what}: ${n}`).join(", ");
  const steps = [
    `GitHub feedback issues: search ${issues}?q=${encodeURIComponent(`label:app:rtsai "${uid}"`)} and delete what you find.`,
    `Google Group archive (rtsai@googlegroups.com): search for ${uid} and delete those posts.`,
    `Google Analytics: Explore → User explorer, find user ID ${uid}, and delete the user.`,
  ];
  const subject = "🗑️ Account deleted: 3 steps by hand";
  const text = `A player deleted their RTS AI account on ${at.toISOString().slice(0, 16).replace("T", " ")} UTC.\n\nAccount ID: ${uid}\nRemoved automatically: ${done}\n\nStill to do by hand:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`;
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const html = `<!doctype html><html><body style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#151a12;"><h2 style="font-size:18px;">${esc(subject)}</h2>`
    + `<p>A player deleted their RTS AI account on ${esc(at.toISOString().slice(0, 16).replace("T", " "))} UTC.</p><p><b>Account ID:</b> ${esc(uid)}<br><b>Removed automatically:</b> ${esc(done)}</p>`
    + `<p><b>Still to do by hand:</b></p><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></body></html>`;
  return { subject, text, html };
}
