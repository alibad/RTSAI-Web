/**
 * Every activity RTS AI tracks, defined once. The site and the browser game (same origin, rtsai.net/play) send these
 * names to Google Analytics and to POST /api/event, which adds each to its day's rollup (dailyStats, for the weekly
 * digest: lib/event-rollup.ts), counts them per player and overall, and emails the event log group (MAIL_GROUP) when
 * an event is always-notable or a counter reaches a milestone. A new event name also goes into functions/rollup.js.
 */

export type EventCategory = "auth" | "activation" | "engagement" | "social" | "ai" | "feedback" | "error";
export type Severity = "info" | "notable" | "critical";

/** Per-player counters (Firestore players/{uid}) and overall counters (stats/global). */
export const PLAYER_COUNTERS = ["joined", "matches", "multiplayer", "aiAssists", "errors"] as const;
export const GLOBAL_COUNTERS = ["players", "matches", "multiplayer", "aiAssists"] as const;
export type PlayerCounter = (typeof PLAYER_COUNTERS)[number];
export type GlobalCounter = (typeof GLOBAL_COUNTERS)[number];

/** Counts worth an email: the 1st, 10th, 100th… */
export const MILESTONES = [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000];

export type EventSpec = {
  category: EventCategory;
  severity: Severity;
  label: string;
  /** "always": every occurrence is emailed. "milestones": only when a counter hits a milestone. */
  email: "always" | "milestones" | "never";
  player?: PlayerCounter;
  global?: GlobalCounter;
  /** Player milestones to email (default: the first time only). */
  playerMilestones?: number[];
  /** Count the overall counter only the first time for this player (sign-ups can't be inflated by repeats). */
  globalOnce?: boolean;
};

export const EVENTS = {
  sign_up: { category: "auth", severity: "notable", label: "New sign-up", email: "milestones", player: "joined", global: "players", globalOnce: true },
  login: { category: "auth", severity: "info", label: "Sign-in", email: "never" },
  game_loaded: { category: "activation", severity: "info", label: "Game loaded", email: "never" },
  match_started: { category: "engagement", severity: "info", label: "Match started", email: "milestones", player: "matches", global: "matches" },
  match_ended: { category: "engagement", severity: "info", label: "Match ended", email: "never" },
  multiplayer_created: { category: "social", severity: "info", label: "Multiplayer match created", email: "never" },
  multiplayer_joined: { category: "social", severity: "info", label: "Joined a multiplayer match", email: "never" },
  multiplayer_started: { category: "social", severity: "notable", label: "Multiplayer match started", email: "always", player: "multiplayer", global: "multiplayer" },
  ai_assist: { category: "ai", severity: "info", label: "AI co-commander suggestion applied", email: "milestones", player: "aiAssists", global: "aiAssists" },
  feedback_sent: { category: "feedback", severity: "notable", label: "Feedback sent", email: "never" },
  // The first few errors per player are emailed, then only at milestones, so one broken session can't flood the log.
  game_error: { category: "error", severity: "critical", label: "Game error", email: "milestones", player: "errors", playerMilestones: [1, 2, 3, 10, 100] },
} satisfies Record<string, EventSpec>;

export type EventName = keyof typeof EVENTS;

export function isEventName(name: unknown): name is EventName {
  return typeof name === "string" && Object.hasOwn(EVENTS, name);
}

export const isMilestone = (count: number, milestones = MILESTONES) => milestones.includes(count);

/** Short, human names for the milestone email subject. */
export const COUNTER_LABELS: Record<PlayerCounter | GlobalCounter, string> = {
  players: "player",
  joined: "sign-up",
  matches: "match",
  multiplayer: "multiplayer match",
  aiAssists: "AI co-commander assist",
  errors: "error",
};

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n.toLocaleString("en-US") + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Event props are small, flat and plain; anything else is dropped before it reaches GA or email. */
export function cleanProps(input: unknown): Record<string, string | number | boolean> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input).slice(0, 16)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, 300);
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
  }
  return out;
}
