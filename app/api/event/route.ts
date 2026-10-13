import { COUNTER_LABELS, EVENTS, cleanProps, isEventName, isMilestone, ordinal, type EventName } from "../../../lib/event-registry";
import { eventEmail } from "../../../lib/event-email";
import { mailGroup, sendFirebaseEmail } from "../../../lib/firebase-mail";
import { bearerToken, verifyFirebaseIdentity, type FirebaseIdentity } from "../../../lib/firebase-token";
import { countEvent, type CountResult } from "../../../lib/player-stats";

/**
 * POST /api/event { name, props } from the signed-in site or game (same origin). Counts the event per player and
 * overall, then emails the event log group (MAIL_GROUP) for always-notable events and milestones. The server adds what
 * the browser can't know about itself: country and city, device, and the page. Analytics never breaks the product:
 * failures are logged and the caller fires and forgets.
 */

const allowedOrigins = ["https://rtsai.net", "https://www.rtsai.net"];
const decode = (value: string | null) => { if (!value) return ""; try { return decodeURIComponent(value); } catch { return value; } };

function who(identity: FirebaseIdentity) { return identity.name || identity.email || "a player"; }

function headlines(name: EventName, identity: FirebaseIdentity, props: Record<string, string | number | boolean>, counts: CountResult) {
  const spec = EVENTS[name], out: string[] = [];
  if (spec.email === "never") return out;
  if (name === "multiplayer_started") out.push(`Multiplayer match started by ${who(identity)}: ${props.players ?? "?"} players${props.ai ? ` + ${props.ai} AI` : ""}${props.map ? ` on ${props.map}` : ""}`);
  else if (spec.email === "always") out.push(`${spec.label}: ${who(identity)}`);
  const playerMilestones = "playerMilestones" in spec ? spec.playerMilestones : [1];
  if (spec.email === "milestones" && counts.player !== undefined && playerMilestones.includes(counts.player)) {
    if (name === "sign_up") out.push(`New sign-up: ${who(identity)}`);
    else if (name === "game_error") out.push(`Game error for ${who(identity)} (${ordinal(counts.player)}): ${String(props.message ?? "unknown").slice(0, 80)}`);
    else if (counts.player === 1) out.push(`First ${COUNTER_LABELS[spec.player!]} for ${who(identity)}`);
    else out.push(`${who(identity)} reached their ${ordinal(counts.player)} ${COUNTER_LABELS[spec.player!]}`);
  }
  if ("global" in spec && counts.global !== undefined && isMilestone(counts.global)) out.push(`🎉 ${ordinal(counts.global)} ${COUNTER_LABELS[spec.global]} overall`);
  return out;
}

export function createEventHandler(deps: {
  verifyIdentity: typeof verifyFirebaseIdentity;
  count: typeof countEvent;
  sendEmail: typeof sendFirebaseEmail;
  recipients: typeof mailGroup;
  reportError: typeof console.error;
}) {
  return async function handleEvent(request: Request) {
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigins.includes(origin) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
    if (Number(request.headers.get("content-length") ?? 0) > 8_000) return Response.json({ error: "Event too large" }, { status: 413 });
    const identity = await deps.verifyIdentity(request);
    if (!identity) return Response.json({ error: "Sign in required" }, { status: 401 });
    let body: { name?: unknown; props?: unknown };
    try { body = await request.json(); } catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
    if (!isEventName(body.name)) return Response.json({ error: "Unknown event" }, { status: 400 });
    const name = body.name, spec: (typeof EVENTS)[EventName] = EVENTS[name], props = cleanProps(body.props);

    let counts: CountResult = {};
    try {
      const idToken = bearerToken(request), player = "player" in spec ? spec.player : undefined, global = "global" in spec ? spec.global : undefined;
      const once = "globalOnce" in spec && spec.globalOnce;
      counts = await deps.count({ idToken, uid: identity.uid, player, global: once ? undefined : global });
      if (once && global && counts.player === 1) counts.global = (await deps.count({ idToken, uid: identity.uid, global })).global;
    } catch (cause) {
      deps.reportError("Usage counter failed", { event: name, message: cause instanceof Error ? cause.message.slice(0, 300) : "unknown" });
    }

    const lines = headlines(name, identity, props, counts), to = deps.recipients();
    let emailed = false;
    if (lines.length && to.length) {
      const h = request.headers;
      try {
        await deps.sendEmail({
          to, idToken: bearerToken(request),
          ...eventEmail({ name, headline: lines.join(" · "), user: identity, props, counts, context: {
            at: new Date().toISOString(), country: h.get("x-vercel-ip-country") ?? "", region: decode(h.get("x-vercel-ip-country-region")),
            city: decode(h.get("x-vercel-ip-city")), userAgent: h.get("user-agent") ?? "", referer: h.get("referer") ?? "",
          } }),
        });
        emailed = true;
      } catch (cause) {
        deps.reportError("Event email failed", { event: name, message: cause instanceof Error ? cause.message.slice(0, 300) : "unknown" });
      }
    }
    return Response.json({ ok: true, counts, emailed });
  };
}

export const POST = createEventHandler({
  verifyIdentity: verifyFirebaseIdentity,
  count: countEvent,
  sendEmail: sendFirebaseEmail,
  recipients: mailGroup,
  reportError: console.error,
});
