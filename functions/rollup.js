// The pure half of the daily rollups: one event (a name from RTSAI-Web lib/event-registry.ts and its small, flat props)
// into the counters it adds to dailyStats/{YYYY-MM-DD}. Every field name comes from the whitelists below, so whatever a
// client sends, a day document only ever has these few dozen fields. Days are Doha days (Asia/Qatar, UTC+3, no DST):
// the owner reads the numbers in Doha.

export const TIME_ZONE = "Asia/Qatar";

/** Every event the site and the game report (RTSAI-Web lib/event-registry.ts). */
export const EVENT_NAMES = ["sign_up", "login", "game_loaded", "match_started", "match_ended", "multiplayer_created",
  "multiplayer_joined", "multiplayer_started", "ai_assist", "feedback_sent", "game_error"];

export const KINDS = ["skirmish", "campaign", "scenario", "multiplayer"];
export const VIEWS = ["isometric", "classic"];
export const RESULTS = ["won", "lost", "left", "error"];
export const MAP_KINDS = ["random", "bundled", "earth", "campaign"];
/** The game's nations (RTSAI-WebGame web/src/ui/Flag.tsx) and its random pick. */
export const FACTIONS = ["america", "china", "cuba", "england", "france", "germany", "lebanon", "iran", "iraq", "israel",
  "korea", "libya", "russia", "saudi", "turkey", "ukraine", "yemen", "random"];
export const FEEDBACK_CATEGORIES = { "Bug": "bug", "Feature Request": "feature", "UI/UX": "ui", "Gameplay": "gameplay",
  "Mission Generator": "missions", "AI Companion": "ai", "General": "general" };

const pick = (value, allowed, missing = "unknown") => {
  if (value === undefined || value === null || value === "") return missing;
  const v = String(value).trim().toLowerCase();
  return allowed.includes(v) ? v : "other";
};
const num = (value, max) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : null);

/** YYYY-MM-DD of an instant, in Doha. */
export function qatarDate(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Where a match's map came from: the game's generator ("gen-…"), a saved Earth map ("earth-…"), a campaign mission, or the bundled list. */
export function mapKind(kind, map) {
  if (kind === "campaign") return "campaign";
  if (typeof map !== "string" || !map) return "unknown";
  if (map.startsWith("gen-")) return "random";
  if (/^earth-[a-f0-9]{8,}/.test(map)) return "earth";
  return "bundled";
}

/** "2", "3", "4" or "5plus" human players; anything else is unknown. */
function humans(n) {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1) return "unknown";
  return n >= 5 ? "p5plus" : `p${n}`;
}

/** Errors with different numbers in them are the same error: "frame 812" and "frame 97" group together. */
export function errorKey(message) {
  const normal = String(message ?? "unknown").toLowerCase().replace(/0x[0-9a-f]+|\d+/g, "#").replace(/\s+/g, " ").trim().slice(0, 200);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < normal.length; i++) {
    const c = normal.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * The counters one event adds to its day: { "events.match_started": 1, "started.faction.russia": 1, … } (field paths
 * to amounts), plus what the player's own day document remembers (`start`, so a later match_ended can be credited to
 * the faction and map it started with) and, for game errors, the message to group. `lastStart` is that remembered start.
 */
export function rollupFor(name, rawProps, lastStart = null) {
  if (!EVENT_NAMES.includes(name)) throw new Error(`Unknown event: ${String(name).slice(0, 40)}`);
  const props = rawProps && typeof rawProps === "object" && !Array.isArray(rawProps) ? rawProps : {};
  const inc = { [`events.${name}`]: 1 };
  const add = (path, amount = 1) => { inc[path] = (inc[path] ?? 0) + amount; };
  let start = null, error = null;

  switch (name) {
    case "sign_up": add(`signups.method.${pick(props.method, ["google", "password"])}`); break;
    case "login": add(`logins.method.${pick(props.method, ["google", "password"])}`); break;
    case "game_loaded": {
      add(`loaded.gpu.${pick(props.gpu, ["hardware", "software"])}`);
      add(`loaded.view.${pick(props.mode, VIEWS)}`);
      const seconds = num(props.seconds, 600);
      if (seconds !== null) { add("loaded.seconds", seconds); add("loaded.timed"); }
      break;
    }
    case "match_started": {
      const kind = pick(props.kind, KINDS);
      start = { kind, faction: pick(props.faction, FACTIONS), map: mapKind(kind, props.map), view: pick(props.mode, VIEWS) };
      add(`started.kind.${start.kind}`);
      add(`started.faction.${start.faction}`);
      add(`started.map.${start.map}`);
      add(`started.view.${start.view}`);
      add(`started.seats.${kind === "multiplayer" ? "multi" : "single"}`);
      break;
    }
    case "match_ended": {
      // The game reports a match's end with its kind and result; its faction and map come from the player's start.
      const kind = props.kind !== undefined ? pick(props.kind, KINDS) : lastStart?.kind ?? "unknown";
      const faction = props.faction !== undefined ? pick(props.faction, FACTIONS) : lastStart?.faction ?? "unknown";
      const map = props.map !== undefined ? mapKind(kind, props.map) : lastStart?.map ?? "unknown";
      const result = pick(props.result, RESULTS);
      add(`ended.kind.${kind}`);
      add(`ended.result.${result}`);
      add(`ended.faction.${faction}`);
      add(`ended.map.${map}`);
      add(`ended.view.${pick(props.mode, VIEWS)}`);
      if (result === "won" || result === "lost") {
        add(`finished.kind.${kind}`);
        add(`finished.faction.${faction}`);
        add(`finished.${result}`);
      }
      const minutes = num(props.minutes, 600);
      if (minutes !== null) { add("ended.minutes", minutes); add("ended.timed"); }
      break;
    }
    case "multiplayer_started": {
      add(`multiplayer.humans.${humans(props.players)}`);
      if (typeof props.ai === "number" && props.ai > 0) add("multiplayer.with_ai");
      break;
    }
    case "ai_assist": add(`assists.view.${pick(props.mode, VIEWS)}`); break;
    case "feedback_sent": {
      const category = typeof props.category !== "string" ? "unknown"
        : Object.hasOwn(FEEDBACK_CATEGORIES, props.category) ? FEEDBACK_CATEGORIES[props.category] : "other";
      add(`feedback.category.${category}`);
      add(`feedback.source.${pick(props.source, ["web", "game"])}`);
      break;
    }
    case "game_error": {
      const where = pick(props.where, ["runtime", "load", "network", "engine"]);
      add(`errors.where.${where}`);
      const message = typeof props.message === "string" && props.message.trim() ? props.message.trim().slice(0, 200) : "unknown";
      error = { key: errorKey(message), message, where };
      break;
    }
    default: break;
  }
  return { inc, start, error };
}
