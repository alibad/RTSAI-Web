// Writing one event into its day, with admin rights (the recordEvent function; clients can't touch dailyStats):
//   dailyStats/{date}                 the day's counters (rollup.js whitelists every field) and `players`, its unique players
//   dailyStats/{date}/players/{uid}   first/last seen that day, events, and the last match start (credits match_ended)
//   dailyStats/{date}/errors/{key}    one game error message and how often it happened that day
// One transaction: it reads only the player's own day document, so concurrent events never contend on the day.
import { FieldValue } from "firebase-admin/firestore";
import { qatarDate, rollupFor, TIME_ZONE } from "./rollup.js";

/** { "a.b": 1 } into { a: { b: FieldValue.increment(1) } } for a merging set. */
export function nested(inc) {
  const out = {};
  for (const [path, amount] of Object.entries(inc)) {
    const parts = path.split(".");
    let node = out;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    node[parts.at(-1)] = FieldValue.increment(amount);
  }
  return out;
}

export async function recordEvent(db, { uid, name, props, at = new Date() }) {
  const date = qatarDate(at);
  const day = db.collection("dailyStats").doc(date), player = day.collection("players").doc(uid);
  return db.runTransaction(async (tx) => {
    const seen = await tx.get(player);
    const { inc, start, error } = rollupFor(name, props, seen.exists ? seen.get("lastStart") ?? null : null);
    if (!seen.exists) inc.players = 1;
    tx.set(day, { date, timeZone: TIME_ZONE, updated: FieldValue.serverTimestamp(), ...nested(inc) }, { merge: true });
    tx.set(player, {
      ...(seen.exists ? {} : { first: FieldValue.serverTimestamp() }),
      last: FieldValue.serverTimestamp(), events: FieldValue.increment(1),
      ...(start ? { lastStart: start } : {}),
    }, { merge: true });
    if (error) tx.set(day.collection("errors").doc(error.key), { message: error.message, where: error.where, count: FieldValue.increment(1), last: FieldValue.serverTimestamp() }, { merge: true });
    return { date, newPlayer: !seen.exists };
  });
}
