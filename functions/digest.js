// The pure half of the weekly digest: which Doha days a digest covers, and a week of dailyStats documents (plus the
// counts weekly.js gathers) into one scannable email: big numbers with week-over-week change, small bar charts made of
// table cells (email-safe, no images or scripts), top errors, and links. Dark by design, so Gmail's dark mode leaves
// it alone; every color is inline.
import { TIME_ZONE, qatarDate } from "./rollup.js";

export const SITE = "https://rtsai.net";
/** rtsai-net's Google Analytics 4 property (Firebase project analytics details); not a secret. */
export const GA_PROPERTY = process.env.GA_PROPERTY_ID || "549381181";
const FIRESTORE_CONSOLE = "https://console.firebase.google.com/project/rtsai-net/firestore/databases/-default-/data/~2FdailyStats";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The instant a Doha day starts (UTC+3 all year). */
export const qatarMidnight = (date) => new Date(`${date}T00:00:00+03:00`);
const parts = (date) => { const [y, m, d] = date.split("-").map(Number); return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; };
export const dayLabel = (date) => { const p = parts(date); return `${p.d} ${MONTHS[p.m - 1]}`; };
export function rangeLabel(first, last) {
  const a = parts(first), b = parts(last);
  if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `${a.d}–${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

/**
 * The seven Doha days a digest covers and the seven before. The Monday 08:00 digest covers last Monday to Sunday;
 * a digest sent by hand (throughToday) covers the last seven days up to now.
 */
export function digestWindow(now = new Date(), { throughToday = false } = {}) {
  const today = qatarDate(now), last = throughToday ? today : addDays(today, -1), first = addDays(last, -6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i));
  const previous = days.map((d) => addDays(d, -7));
  return { days, previous, throughToday, start: qatarMidnight(first), end: throughToday ? now : qatarMidnight(addDays(last, 1)), previousStart: qatarMidnight(previous[0]) };
}

/** Adds up the numbers in day documents, however deep: [{ a: { b: 1 } }, { a: { b: 2 } }] → { a: { b: 3 } }. */
export function sumDays(docs) {
  const out = {};
  const into = (target, source) => {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (typeof value === "number" && Number.isFinite(value)) target[key] = (target[key] ?? 0) + value;
      else if (value && typeof value === "object" && !Array.isArray(value) && typeof value.toDate !== "function") into(target[key] ??= {}, value);
    }
  };
  for (const doc of docs) into(out, doc);
  return out;
}

const at = (obj, path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const fmt = (v) => Math.round(n(v)).toLocaleString("en-US");
const plural = (count, one, many = `${one}s`) => `${fmt(count)} ${count === 1 ? one : many}`;
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const title = (id) => id.charAt(0).toUpperCase() + id.slice(1);

/** Week-over-week: "+12%", "−5%", "new" (nothing last week), or "—" (nothing either week). */
export function change(current, previous) {
  if (!previous) return current ? { text: "new", dir: "up" } : { text: "—", dir: "flat" };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { text: `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct)}%`, dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}

const LABELS = {
  kind: { skirmish: "Skirmish", campaign: "Campaign", scenario: "Scenario", multiplayer: "Multiplayer" },
  map: { random: "Random map", bundled: "Bundled map", earth: "Earth map", campaign: "Campaign mission" },
  result: { won: "Won", lost: "Lost", left: "Left early", error: "Crashed" },
  feedback: { bug: "Bug", feature: "Feature request", ui: "UI/UX", gameplay: "Gameplay", missions: "Mission generator", ai: "AI companion", general: "General" },
  method: { google: "Google", password: "Email & password" },
};
const label = (group, id) => LABELS[group]?.[id] ?? (id === "unknown" ? "Not reported" : id === "other" ? "Other" : title(id));

/** Rows of { id, label, value, second } sorted by value, from a counter map and an optional second one. */
function rows(group, map, second = {}, limit = 8) {
  const ids = new Set([...Object.keys(map ?? {}), ...Object.keys(second ?? {})]);
  return [...ids].map((id) => ({ id, label: label(group, id), value: n(map?.[id]), second: n(second?.[id]) }))
    .filter((r) => r.value || r.second).sort((a, b) => b.value - a.value || b.second - a.second).slice(0, limit);
}

/** Everything the email shows, as numbers: what the HTML and the text versions both render. */
export function digestModel(input) {
  const { window: w } = input;
  const week = sumDays(input.days), last = sumDays(input.previous);
  const ev = (sum, name) => n(at(sum, `events.${name}`));
  const finished = (sum) => n(at(sum, "finished.won")) + n(at(sum, "finished.lost"));
  const big = [
    { key: "players", label: "Active players", value: n(input.active), previous: n(input.previousActive), hint: "signed in and played" },
    { key: "signups", label: "New sign-ups", value: n(input.newPlayers), previous: n(input.previousNewPlayers), hint: "new accounts" },
    { key: "loads", label: "Game loads", value: ev(week, "game_loaded"), previous: ev(last, "game_loaded"), hint: "signed-in visits to /play" },
    { key: "started", label: "Matches started", value: ev(week, "match_started"), previous: ev(last, "match_started"), hint: "all modes" },
    { key: "finished", label: "Matches finished", value: finished(week), previous: finished(last), hint: "won or lost" },
    { key: "feedback", label: "Feedback", value: ev(week, "feedback_sent"), previous: ev(last, "feedback_sent"), hint: "reports sent" },
  ].map((b) => ({ ...b, change: change(b.value, b.previous) }));
  const timed = n(at(week, "ended.timed")), loadsTimed = n(at(week, "loaded.timed"));
  return {
    window: w,
    range: rangeLabel(w.days[0], w.days[6]),
    big,
    daily: input.days.map((d) => ({ date: d.date, weekday: WEEKDAYS[parts(d.date).wd], label: dayLabel(d.date), players: n(d.players), matches: n(at(d, "events.match_started")) })),
    modes: rows("kind", at(week, "started.kind"), at(week, "finished.kind")),
    factions: rows("faction", at(week, "started.faction"), at(week, "finished.faction"), 10),
    maps: rows("map", at(week, "started.map")),
    results: ["won", "lost", "left", "error", "other", "unknown"].map((id) => ({ id, label: label("result", id), value: n(at(week, `ended.result.${id}`)) })).filter((r) => r.value),
    signups: rows("method", at(week, "signups.method")),
    feedback: rows("feedback", at(week, "feedback.category")),
    softwareLoads: n(at(week, "loaded.gpu.software")),
    multiplayer: ev(week, "multiplayer_started"),
    assists: ev(week, "ai_assist"),
    errorCount: ev(week, "game_error"),
    previousErrorCount: ev(last, "game_error"),
    errors: (input.errors ?? []).slice(0, 5),
    avgMinutes: timed ? n(at(week, "ended.minutes")) / timed : null,
    avgLoadSeconds: loadsTimed ? n(at(week, "loaded.seconds")) / loadsTimed : null,
    allTime: [
      { label: "Players", value: n(input.global?.players) },
      { label: "Accounts", value: n(input.accounts) },
      { label: "Matches", value: n(input.global?.matches) },
      { label: "Multiplayer", value: n(input.global?.multiplayer) },
      { label: "AI assists", value: n(input.global?.aiAssists) },
    ],
    // Until the browser game reports match endings and loads to the server, say so instead of showing silent zeros.
    endingsMissing: ev(week, "match_started") > 0 && ev(week, "match_ended") === 0 && ev(week, "game_loaded") === 0,
  };
}

export function digestSubject(model) {
  const players = model.big.find((b) => b.key === "players"), started = model.big.find((b) => b.key === "started");
  const trend = started.previous ? ` (${started.change.text})` : "";
  return `RTS AI week of ${dayLabel(model.window.days[0])}: ${plural(players.value, "player")}, ${plural(started.value, "match", "matches")}${trend}`;
}

// ---- HTML: tables and inline styles only.
const C = { page: "#0d110b", card: "#151b12", panel: "#1d2518", line: "#2b3524", text: "#eef2e6", muted: "#9ba68f", gold: "#f0d68c",
  bar: "#d9a93c", bar2: "#7fb24a", track: "#283121", up: "#86d993", down: "#ff8f85", lost: "#e0645a", left: "#7d8873", crash: "#e09a3c" };
const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const cell = (color, width, height) => `<td${width === undefined ? "" : ` width="${width}%"`} height="${height}" bgcolor="${color}" style="background:${color};height:${height}px;font-size:0;line-height:0;">&nbsp;</td>`;
const bar = (value, max, color, height) => {
  const pct = max > 0 && value > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${pct ? cell(color, pct, height) : ""}${pct < 100 ? cell(C.track, undefined, height) : ""}</tr></table>`;
};
const heading = (text, note = "") => `<tr><td style="padding:22px 22px 8px;font-size:12px;letter-spacing:.12em;font-weight:700;color:${C.gold};">${esc(text)}${note ? `<span style="letter-spacing:0;font-weight:400;color:${C.muted};"> · ${esc(note)}</span>` : ""}</td></tr>`;
const empty = (text) => `<tr><td style="padding:2px 22px 4px;font-size:13px;color:${C.muted};">${esc(text)}</td></tr>`;

function tile(b) {
  const color = b.change.dir === "up" ? C.up : b.change.dir === "down" ? C.down : C.muted;
  const arrow = b.change.dir === "up" ? "▲ " : b.change.dir === "down" ? "▼ " : "";
  return `<td width="33%" valign="top" style="padding:5px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.panel}" style="background:${C.panel};border:1px solid ${C.line};border-radius:10px;"><tr><td style="padding:12px 12px 10px;">
<div style="font-size:30px;line-height:34px;font-weight:800;color:${C.text};">${fmt(b.value)}</div>
<div style="font-size:12px;font-weight:700;color:${C.text};padding-top:2px;">${esc(b.label)}</div>
<div style="font-size:12px;color:${color};padding-top:4px;">${arrow}${esc(b.change.text)} <span style="color:${C.muted};">vs ${fmt(b.previous)}</span></div>
</td></tr></table></td>`;
}

function barTable(list, { secondLabel } = {}) {
  if (!list.length) return "";
  const max = Math.max(...list.map((r) => Math.max(r.value, r.second)));
  return `<tr><td style="padding:0 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list.map((r) => `<tr>
<td width="112" style="padding:5px 10px 5px 0;font-size:13px;color:${C.text};white-space:nowrap;">${esc(r.label)}</td>
<td style="padding:5px 0;">${bar(r.value, max, C.bar, 10)}${secondLabel ? `<div style="height:3px;line-height:3px;font-size:0;">&nbsp;</div>${bar(r.second, max, C.bar2, 5)}` : ""}</td>
<td width="92" align="right" style="padding:5px 0 5px 10px;font-size:13px;color:${C.text};white-space:nowrap;"><b>${fmt(r.value)}</b>${secondLabel ? ` <span style="color:${C.bar2};">· ${fmt(r.second)}</span>` : ""}</td>
</tr>`).join("")}</table></td></tr>`;
}

function dailyChart(daily) {
  const max = Math.max(1, ...daily.map((d) => d.players));
  const col = (d) => {
    const h = d.players ? Math.max(4, Math.round((d.players / max) * 64)) : 2;
    return `<td width="14%" align="center" valign="bottom" style="padding:0 3px;">
<div style="font-size:12px;font-weight:700;color:${C.text};padding-bottom:3px;">${d.players || ""}</div>
<table role="presentation" width="26" cellpadding="0" cellspacing="0" align="center"><tr>${cell(d.players ? C.bar : C.track, undefined, h)}</tr></table></td>`;
  };
  return `<tr><td style="padding:4px 22px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>${daily.map(col).join("")}</tr>
<tr>${daily.map((d) => `<td align="center" style="padding-top:6px;font-size:11px;line-height:14px;color:${C.muted};">${d.weekday}<br>${esc(d.label)}</td>`).join("")}</tr>
<tr>${daily.map((d) => `<td align="center" style="padding-top:3px;font-size:11px;color:${d.matches ? C.bar2 : C.muted};">${d.matches ? `▸ ${fmt(d.matches)}` : "·"}</td>`).join("")}</tr>
</table></td></tr>
<tr><td style="padding:6px 22px 0;font-size:11px;color:${C.muted};"><span style="color:${C.bar};">■</span> players that day &nbsp; <span style="color:${C.bar2};">▸</span> matches started</td></tr>`;
}

function resultsBar(results) {
  if (!results.length) return "";
  const total = results.reduce((s, r) => s + r.value, 0), colors = { won: C.bar2, lost: C.lost, left: C.left, error: C.crash };
  let used = 0;
  const cells = results.map((r, i) => {
    const pct = i === results.length - 1 ? 100 - used : Math.max(1, Math.round((r.value / total) * 100));
    used += pct;
    return cell(colors[r.id] ?? C.muted, pct, 12);
  }).join("");
  return `<tr><td style="padding:6px 22px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
<div style="padding-top:6px;font-size:12px;color:${C.muted};">${results.map((r) => `<span style="color:${colors[r.id] ?? C.muted};">■</span> ${esc(r.label)} <b style="color:${C.text};">${fmt(r.value)}</b>`).join(" &nbsp; ")}</div></td></tr>`;
}

function button(href, text, primary = false) {
  const bg = primary ? C.gold : C.panel, fg = primary ? "#1b2316" : C.text;
  return `<td style="padding:4px;"><a href="${esc(href)}" style="display:inline-block;padding:9px 14px;border-radius:8px;background:${bg};border:1px solid ${primary ? C.gold : C.line};color:${fg};font-size:13px;font-weight:700;text-decoration:none;">${esc(text)}</a></td>`;
}

export function gaLinks() {
  return { reports: `https://analytics.google.com/analytics/web/#/p${GA_PROPERTY}/reports/intelligenthome`, realtime: `https://analytics.google.com/analytics/web/#/p${GA_PROPERTY}/realtime/overview` };
}

export function renderDigest(input) {
  const m = digestModel(input), subject = digestSubject(m), ga = gaLinks();
  const span = m.window.throughToday ? `last 7 days, ${m.range}, to now` : m.range;
  const extras = [
    m.avgMinutes !== null ? `average match ${m.avgMinutes.toFixed(1)} min` : "",
    m.multiplayer ? plural(m.multiplayer, "multiplayer match", "multiplayer matches") : "",
    m.assists ? plural(m.assists, "AI co-commander assist") : "",
    m.avgLoadSeconds !== null ? `game loads in ${m.avgLoadSeconds.toFixed(1)} s on average` : "",
    m.softwareLoads ? `${plural(m.softwareLoads, "load")} on software rendering (no GPU)` : "",
  ].filter(Boolean);
  const errorsChange = change(m.errorCount, m.previousErrorCount);

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page};font-family:${font};" bgcolor="${C.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page};"><tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.card}" style="max-width:620px;background:${C.card};border:1px solid ${C.line};border-radius:14px;">
<tr><td style="padding:18px 22px 4px;font-size:12px;letter-spacing:.16em;font-weight:800;color:${C.gold};">RTS AI · WEEKLY</td></tr>
<tr><td style="padding:0 22px;font-size:22px;line-height:28px;font-weight:800;color:${C.text};">Week of ${esc(dayLabel(m.window.days[0]))}</td></tr>
<tr><td style="padding:2px 22px 10px;font-size:13px;color:${C.muted};">${esc(span)} · Doha time</td></tr>
<tr><td style="padding:0 17px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${m.big.slice(0, 3).map(tile).join("")}</tr><tr>${m.big.slice(3).map(tile).join("")}</tr></table></td></tr>
${extras.length ? `<tr><td style="padding:8px 22px 0;font-size:13px;color:${C.muted};">${esc(extras.join(" · "))}</td></tr>` : ""}
${m.endingsMissing ? `<tr><td style="padding:10px 22px 0;font-size:12px;color:${C.crash};">Finished matches and game loads stay at 0 until the browser game reports them to the server.</td></tr>` : ""}
${heading("EVERY DAY")}
${dailyChart(m.daily)}
${heading("MATCHES BY MODE", "started · finished")}
${m.modes.length ? barTable(m.modes, { secondLabel: true }) : empty("No matches this week.")}
${heading("MATCHES BY FACTION", "started · finished")}
${m.factions.length ? barTable(m.factions, { secondLabel: true }) : empty("No matches this week.")}
${m.maps.length ? `${heading("MAPS")}${barTable(m.maps)}` : ""}
${m.results.length ? `${heading("HOW MATCHES ENDED")}${resultsBar(m.results)}` : ""}
${heading("SIGN-UPS AND FEEDBACK")}
${m.signups.length || m.feedback.length ? barTable([...m.signups.map((r) => ({ ...r, label: `Sign-up · ${r.label}` })), ...m.feedback.map((r) => ({ ...r, label: `Feedback · ${r.label}` }))]) : empty("No sign-up or feedback events this week.")}
${heading("GAME ERRORS", `${fmt(m.errorCount)} this week, ${errorsChange.text} vs last week`)}
${m.errors.length ? `<tr><td style="padding:0 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${m.errors.map((e) => `<tr><td width="46" valign="top" style="padding:5px 8px 5px 0;"><span style="display:inline-block;min-width:24px;padding:2px 7px;border-radius:10px;background:#4a1f1b;color:#ffb3ab;font-size:12px;font-weight:700;text-align:center;">${fmt(e.count)}</span></td><td style="padding:5px 0;font-size:12px;line-height:17px;color:${C.text};font-family:Consolas,Menlo,monospace;word-break:break-word;">${esc(e.message)}${e.where && e.where !== "unknown" ? ` <span style="color:${C.muted};font-family:${font};">· ${esc(e.where)}</span>` : ""}</td></tr>`).join("")}</table></td></tr>` : empty("No game errors reported this week.")}
${heading("ALL TIME")}
<tr><td style="padding:0 17px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${m.allTime.map((t) => `<td width="20%" valign="top" style="padding:5px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.panel}" style="background:${C.panel};border:1px solid ${C.line};border-radius:10px;"><tr><td align="center" style="padding:10px 4px;"><div style="font-size:20px;font-weight:800;color:${C.text};">${fmt(t.value)}</div><div style="font-size:11px;color:${C.muted};padding-top:2px;">${esc(t.label)}</div></td></tr></table></td>`).join("")}</tr></table></td></tr>
<tr><td style="padding:20px 18px 6px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${button(SITE, "rtsai.net", true)}${button(`${SITE}/play`, "Play")}${button(ga.reports, "GA4 reports")}${button(ga.realtime, "GA4 realtime")}${button(FIRESTORE_CONSOLE, "Daily stats")}</tr></table></td></tr>
<tr><td style="padding:10px 22px 20px;font-size:11px;line-height:16px;color:${C.muted};">Days are Doha days (${TIME_ZONE}). Counts are signed-in players; anonymous visitors and page views are in GA4. Sent every Monday at 08:00 by the weeklyDigest function from Firestore dailyStats.</td></tr>
</table></td></tr></table></body></html>`;

  const pad = (s, w) => (s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length));
  const textBars = (list, second) => {
    const max = Math.max(1, ...list.map((r) => Math.max(r.value, r.second)));
    return list.map((r) => `  ${pad(r.label, 18)} ${pad("█".repeat(Math.max(r.value ? 1 : 0, Math.round((r.value / max) * 20))), 20)} ${fmt(r.value)}${second ? ` started · ${fmt(r.second)} finished` : ""}`).join("\n");
  };
  const text = [
    `RTS AI · week of ${dayLabel(m.window.days[0])} (${span}, Doha time)`,
    "",
    ...m.big.map((b) => `  ${pad(b.label, 18)} ${pad(fmt(b.value), 7)} ${b.change.text} vs ${fmt(b.previous)} last week`),
    ...(extras.length ? ["", `  ${extras.join(" · ")}`] : []),
    ...(m.endingsMissing ? ["", "  Finished matches and game loads stay at 0 until the browser game reports them to the server."] : []),
    "",
    "EVERY DAY (players · matches started)",
    ...m.daily.map((d) => `  ${d.weekday} ${pad(d.label, 7)} ${pad("█".repeat(Math.round((d.players / Math.max(1, ...m.daily.map((x) => x.players))) * 20)), 20)} ${d.players} · ${d.matches}`),
    "",
    "MATCHES BY MODE",
    m.modes.length ? textBars(m.modes, true) : "  No matches this week.",
    "",
    "MATCHES BY FACTION",
    m.factions.length ? textBars(m.factions, true) : "  No matches this week.",
    ...(m.maps.length ? ["", "MAPS", textBars(m.maps)] : []),
    ...(m.results.length ? ["", "HOW MATCHES ENDED", `  ${m.results.map((r) => `${r.label} ${fmt(r.value)}`).join(" · ")}`] : []),
    "",
    "SIGN-UPS AND FEEDBACK",
    m.signups.length || m.feedback.length ? textBars([...m.signups.map((r) => ({ ...r, label: `Sign-up ${r.label}` })), ...m.feedback.map((r) => ({ ...r, label: `Feedback ${r.label}` }))]) : "  No sign-up or feedback events this week.",
    "",
    `GAME ERRORS (${fmt(m.errorCount)} this week, ${errorsChange.text} vs last week)`,
    m.errors.length ? m.errors.map((e) => `  ${pad(`${fmt(e.count)}×`, 6)} ${e.message}`).join("\n") : "  No game errors reported this week.",
    "",
    "ALL TIME",
    `  ${m.allTime.map((t) => `${t.label} ${fmt(t.value)}`).join(" · ")}`,
    "",
    `rtsai.net: ${SITE}`,
    `GA4 reports: ${ga.reports}`,
    `GA4 realtime: ${ga.realtime}`,
    `Daily stats: ${FIRESTORE_CONSOLE}`,
    "",
    `Days are Doha days (${TIME_ZONE}). Counts are signed-in players; anonymous visitors and page views are in GA4.`,
  ].join("\n");
  return { subject, html, text, model: m };
}
