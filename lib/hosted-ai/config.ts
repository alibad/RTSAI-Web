/**
 * Server-only configuration for the hosted co-commander proxy.
 *
 * Every value is read per request so tests and Vercel environment changes take
 * effect without a rebuild. Nothing here may use a NEXT_PUBLIC_ prefix: the
 * model key, token secret and service account never reach a browser or the game.
 */

/** The only upstream model. The owner chose Claude Haiku 4.5 explicitly. */
export const HOSTED_MODEL = "claude-haiku-4-5";

/** Model names the game may send. Every one is served by {@link HOSTED_MODEL}. */
export const ALLOWED_MODEL_ALIASES = new Set([HOSTED_MODEL, "rtsai-hosted", "hosted-brain"]);

/** Vercel rejects request bodies above 4.5 MB; stay clear of it even if misconfigured. */
const BODY_LIMIT_CEILING = 4_000_000;

function numberEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function flagEnv(name: string) {
  return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase());
}

export type HostedAiConfig = {
  killSwitch: boolean;
  tokenSecret: string;
  anonymousDailyUsd: number;
  linkedDailyUsd: number;
  globalDailyCapUsd: number;
  requestsPerMinute: number;
  installsPerIpPerDay: number;
  maxTokens: number;
  defaultMaxTokens: number;
  maxImages: number;
  maxImageBytes: number;
  maxTotalImageBytes: number;
  maxBodyBytes: number;
  upstreamTimeoutMs: number;
  store: "firestore" | "memory";
  /** True on the Vercel production deployment, where per-instance memory quotas are refused. */
  production: boolean;
};

export function hostedAiConfig(): HostedAiConfig {
  const production = process.env.VERCEL_ENV === "production";
  const configuredStore = (process.env.RTSAI_AI_STORE ?? "").trim().toLowerCase();
  return {
    killSwitch: flagEnv("RTSAI_AI_KILL_SWITCH"),
    tokenSecret: process.env.RTSAI_AI_TOKEN_SECRET ?? "",
    anonymousDailyUsd: numberEnv("RTSAI_AI_ANON_DAILY_USD", 0.25, 0, 100),
    linkedDailyUsd: numberEnv("RTSAI_AI_LINKED_DAILY_USD", 1, 0, 1_000),
    globalDailyCapUsd: numberEnv("RTSAI_AI_GLOBAL_DAILY_CAP_USD", 10, 0, 100_000),
    requestsPerMinute: numberEnv("RTSAI_AI_REQUESTS_PER_MINUTE", 12, 1, 600),
    installsPerIpPerDay: numberEnv("RTSAI_AI_INSTALLS_PER_IP_PER_DAY", 5, 1, 1_000),
    maxTokens: numberEnv("RTSAI_AI_MAX_TOKENS", 1_024, 16, 4_096),
    defaultMaxTokens: 512,
    maxImages: numberEnv("RTSAI_AI_MAX_IMAGES", 2, 0, 4),
    maxImageBytes: numberEnv("RTSAI_AI_MAX_IMAGE_BYTES", 400_000, 10_000, 3_750_000),
    maxTotalImageBytes: numberEnv("RTSAI_AI_MAX_TOTAL_IMAGE_BYTES", 600_000, 10_000, 3_000_000),
    maxBodyBytes: numberEnv("RTSAI_AI_MAX_BODY_BYTES", 2_000_000, 64_000, BODY_LIMIT_CEILING),
    // Below the game gateway's 18 s and the companion's 20 s budgets, so a slow
    // upstream turns into a clean 503 (and a local fallback) instead of a hang.
    upstreamTimeoutMs: numberEnv("RTSAI_AI_UPSTREAM_TIMEOUT_MS", 15_000, 2_000, 60_000),
    // Every Vercel deployment persists quotas in Firestore unless told otherwise;
    // production refuses the memory store outright (see selectStore in service.ts).
    store: configuredStore === "firestore" || (configuredStore !== "memory" && Boolean(process.env.VERCEL))
      ? "firestore"
      : "memory",
    production,
  };
}

export function upstreamConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export const microsFromUsd = (usd: number) => Math.round(usd * 1_000_000);
export const usdFromMicros = (micros: number) => Math.round(micros) / 1_000_000;
