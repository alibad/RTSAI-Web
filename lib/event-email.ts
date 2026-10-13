/** One event as an email to the event log group: what happened, who, and from where (the server adds the where). */
import { EVENTS, type EventName, type Severity } from "./event-registry";

export type EventContext = {
  at: string;
  country: string;
  region: string;
  city: string;
  userAgent: string;
  referer: string;
};

const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "Chrome on Windows" from a user agent, without a parsing library. */
export function describeDevice(userAgent: string) {
  const ua = userAgent || "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Unknown browser";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "unknown OS";
  return `${browser} on ${os}${/Mobile/.test(ua) ? " (mobile)" : ""}`;
}

export function eventEmail(input: {
  name: EventName;
  headline: string;
  user: { uid: string; email: string | null; name: string | null };
  props: Record<string, string | number | boolean>;
  counts: { player?: number; global?: number };
  context: EventContext;
}) {
  const spec = EVENTS[input.name];
  const severity: Severity = spec.severity;
  const dot = severity === "critical" ? "🔴" : severity === "notable" ? "🟡" : "🟢";
  const where = [input.context.city, input.context.region, input.context.country].filter(Boolean).join(", ");
  const rows: [string, string][] = [
    ["Event", `${spec.label} (${input.name})`],
    ["Player", [input.user.name, input.user.email].filter(Boolean).join(" · ") || input.user.uid],
    ...(input.counts.player !== undefined ? [["Player total", String(input.counts.player)] as [string, string]] : []),
    ...(input.counts.global !== undefined ? [["Overall total", input.counts.global.toLocaleString("en-US")] as [string, string]] : []),
    ["Where", where || "—"],
    ["Device", describeDevice(input.context.userAgent)],
    ["From page", input.context.referer || "—"],
    ["When (UTC)", input.context.at.replace("T", " ").slice(0, 19)],
    ...Object.entries(input.props).map(([k, v]) => [k.replace(/_/g, " "), String(v)] as [string, string]),
    ["Account ID", input.user.uid],
  ];
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#0f130e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:20px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e7df;">
<tr><td style="padding:16px 18px;background:#1b2316;color:#f0d68c;font-size:12px;letter-spacing:.14em;font-weight:700;">RTS AI · EVENT LOG</td></tr>
<tr><td style="padding:16px 18px 6px;font-size:18px;font-weight:700;color:#151a12;">${dot} ${esc(input.headline)}</td></tr>
<tr><td style="padding:4px 8px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(([k, v]) =>
    `<tr><td style="padding:6px 10px;color:#6d7566;font-size:13px;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:6px 10px;color:#151a12;font-size:13px;word-break:break-word;">${esc(v)}</td></tr>`).join("")}</table></td></tr>
</table></td></tr></table></body></html>`;
  const text = `${dot} ${input.headline}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n`;
  return { subject: `${dot} ${input.headline}${where ? ` · ${where}` : ""}`.slice(0, 190), html, text };
}
