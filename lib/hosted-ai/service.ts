import Anthropic from "@anthropic-ai/sdk";
import { HOSTED_MODEL, hostedAiConfig, microsFromUsd, upstreamConfigured, usdFromMicros, type HostedAiConfig } from "./config";
import { errorResponse, HostedAiError, invalid, noStore } from "./errors";
import { FirestoreUsageStore } from "./firestore-store";
import { serviceAccount } from "./google-auth";
import { costMicros, reservationMicros } from "./pricing";
import { MemoryUsageStore, type InstallRecord, type UsageStore } from "./store";
import { bearerToken, issueInstallToken, verifyInstallToken } from "./tokens";
import { translateRequest, translateResponse } from "./translate";

/** Injection points for tests and local mocks. Production uses the defaults. */
type Overrides = { store?: UsageStore; anthropic?: () => Anthropic; now?: () => number };
let overrides: Overrides = {};
export function setHostedAiOverrides(next: Overrides) {
  overrides = next;
}

let memoryStore: MemoryUsageStore | null = null;
let firestoreStore: FirestoreUsageStore | null = null;

function now() {
  return overrides.now?.() ?? Date.now();
}

export function utcDay(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function utcMinute(ms: number) {
  return new Date(ms).toISOString().slice(0, 16).replace(/[-:T]/g, "");
}

function secondsUntilUtcMidnight(ms: number) {
  const midnight = Date.parse(`${utcDay(ms)}T00:00:00Z`) + 86_400_000;
  return Math.max(1, Math.ceil((midnight - ms) / 1_000));
}

function resetsAt(ms: number) {
  return new Date(Date.parse(`${utcDay(ms)}T00:00:00Z`) + 86_400_000).toISOString();
}

function selectStore(config: HostedAiConfig): UsageStore {
  if (overrides.store) return overrides.store;
  if (config.store === "firestore") {
    if (!serviceAccount()) {
      throw new HostedAiError(503, "store_unavailable", "Hosted AI quota storage is not configured.", "unavailable", 300);
    }
    return (firestoreStore ??= new FirestoreUsageStore());
  }
  if (config.production) {
    throw new HostedAiError(503, "store_unavailable", "Hosted AI quota storage is not configured.", "unavailable", 300);
  }
  return (memoryStore ??= new MemoryUsageStore());
}

function anthropicClient(config: HostedAiConfig) {
  if (overrides.anthropic) return overrides.anthropic();
  // The SDK reads ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL for local mocks) from the server environment.
  return new Anthropic({ maxRetries: 1, timeout: config.upstreamTimeoutMs });
}

function allowanceMicros(config: HostedAiConfig, install: InstallRecord) {
  return microsFromUsd(install.linkedUid ? config.linkedDailyUsd : config.anonymousDailyUsd);
}

async function storeCall<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (cause) {
    if (cause instanceof HostedAiError) throw cause;
    console.error("Hosted AI store failure", { message: cause instanceof Error ? cause.message.slice(0, 200) : "unknown" });
    throw new HostedAiError(503, "store_unavailable", "Hosted AI is temporarily unavailable.", "unavailable", 60);
  }
}

async function readBody(request: Request, limit: number) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  const tooLarge = () => new HostedAiError(413, "request_too_large", `Requests may be at most ${Math.floor(limit / 1_000)} KB`, "invalid");
  if (declared > limit) throw tooLarge();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function authenticate(request: Request, config: HostedAiConfig, store: UsageStore) {
  const installId = await verifyInstallToken(bearerToken(request), config.tokenSecret);
  const install = await storeCall(() => store.getInstall(installId));
  if (!install || install.revoked) {
    throw new HostedAiError(401, "install_token_revoked", "This RTS AI install token is no longer active.", "unauthorized");
  }
  return install;
}

function upstreamError(cause: unknown, structuredOutput: boolean): HostedAiError {
  if (cause instanceof Anthropic.BadRequestError) {
    const prefix = structuredOutput ? "response_format json_schema was rejected upstream: " : "";
    return new HostedAiError(400, "upstream_rejected", `${prefix}${cause.message}`.slice(0, 400), "invalid");
  }
  if (cause instanceof Anthropic.AuthenticationError || cause instanceof Anthropic.PermissionDeniedError) {
    console.error("Hosted AI upstream credential rejected", { status: cause.status });
    return new HostedAiError(503, "upstream_not_configured", "Hosted AI is temporarily unavailable.", "unavailable", 300);
  }
  if (cause instanceof Anthropic.RateLimitError) {
    const retry = Number(cause.headers?.get("retry-after") ?? 30);
    return new HostedAiError(503, "upstream_busy", "Hosted AI is busy; try again shortly.", "upstream", Number.isFinite(retry) ? retry : 30);
  }
  if (cause instanceof Anthropic.APIError) {
    return new HostedAiError(503, "upstream_unavailable", "Hosted AI is temporarily unavailable.", "upstream", 30);
  }
  return new HostedAiError(502, "upstream_error", "Hosted AI returned an unexpected error.", "upstream", 30);
}

function paused() {
  return new HostedAiError(503, "service_paused", "Hosted AI is paused by the operator.", "paused", 300);
}

/** POST /api/ai/v1/chat/completions */
export async function handleChatCompletion(request: Request): Promise<Response> {
  const started = now();
  const config = hostedAiConfig();
  try {
    if (config.killSwitch) throw paused();
    const text = await readBody(request, config.maxBodyBytes);
    const store = selectStore(config);
    const install = await authenticate(request, config, store);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw invalid("invalid_json", "The request body is not valid JSON");
    }
    const translated = translateRequest(body, config);
    if (!upstreamConfigured()) {
      throw new HostedAiError(503, "upstream_not_configured", "Hosted AI is not configured yet.", "unavailable", 300);
    }

    const allowance = allowanceMicros(config, install);
    const reserved = reservationMicros(translated.textCharacters, translated.imageTokens, translated.maxTokens);
    const day = utcDay(started);
    const outcome = await storeCall(() => store.reserve(install.installId, day, utcMinute(started), reserved, {
      installMicros: allowance,
      globalMicros: microsFromUsd(config.globalDailyCapUsd),
      perMinute: config.requestsPerMinute,
    }));
    if (!outcome.ok) {
      if (outcome.reason === "allowance") {
        throw new HostedAiError(429, "daily_allowance_exhausted", "Today's hosted AI allowance is used up. It resets at 00:00 UTC.", "allowance", secondsUntilUtcMidnight(started));
      }
      if (outcome.reason === "budget") {
        throw new HostedAiError(503, "global_budget_exhausted", "Hosted AI has reached today's capacity. It resets at 00:00 UTC.", "budget", secondsUntilUtcMidnight(started));
      }
      throw new HostedAiError(429, "rate_limited", "Too many AI requests this minute.", "rate_limited", 60 - new Date(started).getUTCSeconds());
    }

    let message: Anthropic.Message;
    try {
      message = await anthropicClient(config).messages.create(translated.params);
    } catch (cause) {
      await storeCall(() => store.settle(install.installId, day, reserved, { costMicros: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).catch(() => undefined);
      throw upstreamError(cause, translated.structuredOutput);
    }

    const cost = costMicros(message.usage);
    try {
      await store.settle(install.installId, day, reserved, {
        costMicros: cost,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      });
    } catch (cause) {
      // The reservation already exceeds the real cost, so a failed settlement only over-counts.
      console.error("Hosted AI settlement failed", { message: cause instanceof Error ? cause.message.slice(0, 200) : "unknown" });
    }
    const used = outcome.installMicros - reserved + cost;
    const remaining = Math.max(0, allowance - used);
    console.info("hosted-ai call", {
      install: install.installId.slice(0, 8),
      input_tokens: message.usage.input_tokens,
      output_tokens: message.usage.output_tokens,
      images: translated.imageCount,
      image_kb: Math.round(translated.imageBytes / 1_000),
      cost_usd: usdFromMicros(cost),
      latency_ms: now() - started,
    });
    return Response.json(
      translateResponse(message, {
        rtsai: {
          cost_usd: usdFromMicros(cost),
          remaining_usd: usdFromMicros(remaining),
          daily_allowance_usd: usdFromMicros(allowance),
          resets_at: resetsAt(started),
        },
      }),
      {
        headers: {
          ...noStore,
          "x-rtsai-ai-state": "ok",
          "x-rtsai-cost-usd": usdFromMicros(cost).toFixed(6),
          "x-rtsai-remaining-usd": usdFromMicros(remaining).toFixed(6),
        },
      },
    );
  } catch (cause) {
    if (cause instanceof HostedAiError) return errorResponse(cause);
    console.error("Hosted AI unexpected failure", { name: cause instanceof Error ? cause.name : "unknown" });
    return errorResponse(new HostedAiError(500, "internal_error", "Hosted AI failed unexpectedly.", "upstream", 30));
  }
}

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

async function ipKey(ip: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`install-ip:${ip}`)));
  return Array.from(digest.subarray(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** POST /api/ai/v1/install — zero-click anonymous identity, rate limited per IP. */
export async function handleInstall(request: Request): Promise<Response> {
  const config = hostedAiConfig();
  try {
    await readBody(request, 4_000);
    const store = selectStore(config);
    const installId = crypto.randomUUID();
    const started = now();
    const { token, expiresAt } = await issueInstallToken(installId, config.tokenSecret, Math.floor(started / 1_000));
    const accepted = await storeCall(async () => store.createInstall(
      { installId, createdAt: started, linkedUid: null, revoked: false },
      await ipKey(clientIp(request), config.tokenSecret),
      utcDay(started),
      config.installsPerIpPerDay,
    ));
    if (!accepted) {
      throw new HostedAiError(429, "install_rate_limited", "Too many new installs from this network today.", "rate_limited", secondsUntilUtcMidnight(started));
    }
    return Response.json(
      {
        token,
        token_type: "Bearer",
        install_id: installId,
        expires_at: new Date(expiresAt * 1_000).toISOString(),
        tier: "anonymous",
        model: HOSTED_MODEL,
        daily_allowance_usd: config.anonymousDailyUsd,
      },
      { status: 201, headers: { ...noStore, "x-rtsai-ai-state": config.killSwitch ? "paused" : "ok" } },
    );
  } catch (cause) {
    if (cause instanceof HostedAiError) return errorResponse(cause);
    console.error("Hosted AI install failure", { name: cause instanceof Error ? cause.name : "unknown" });
    return errorResponse(new HostedAiError(500, "internal_error", "Install registration failed.", "unavailable", 60));
  }
}

/** GET /api/ai/v1/status — allowance and service state for the in-game HUD, without spending tokens. */
export async function handleStatus(request: Request): Promise<Response> {
  const config = hostedAiConfig();
  try {
    const store = selectStore(config);
    const install = await authenticate(request, config, store);
    const started = now();
    const usage = await storeCall(() => store.usage(install.installId, utcDay(started)));
    const allowance = allowanceMicros(config, install);
    const remaining = Math.max(0, allowance - usage.installMicros);
    const state = config.killSwitch
      ? "paused"
      : usage.globalMicros >= microsFromUsd(config.globalDailyCapUsd)
        ? "budget"
        : remaining <= 0
          ? "allowance"
          : "ok";
    return Response.json(
      {
        state,
        tier: install.linkedUid ? "linked" : "anonymous",
        model: HOSTED_MODEL,
        daily_allowance_usd: usdFromMicros(allowance),
        used_usd: usdFromMicros(usage.installMicros),
        remaining_usd: usdFromMicros(remaining),
        calls_today: usage.calls,
        resets_at: resetsAt(started),
      },
      { headers: { ...noStore, "x-rtsai-ai-state": state } },
    );
  } catch (cause) {
    if (cause instanceof HostedAiError) return errorResponse(cause);
    return errorResponse(new HostedAiError(500, "internal_error", "Status lookup failed.", "unavailable", 60));
  }
}

/**
 * POST /api/ai/v1/link — account-linking seam. Body: {"firebase_id_token": "..."}
 * with the install token as the bearer credential. A linked install receives
 * RTSAI_AI_LINKED_DAILY_USD instead of the anonymous allowance.
 */
export async function handleLink(request: Request, verifyFirebase: (idToken: string) => Promise<{ uid: string } | null>) {
  const config = hostedAiConfig();
  try {
    const store = selectStore(config);
    const install = await authenticate(request, config, store);
    let body: unknown;
    try {
      body = JSON.parse(await readBody(request, 8_000));
    } catch (cause) {
      if (cause instanceof HostedAiError) throw cause;
      throw invalid("invalid_json", "The request body is not valid JSON");
    }
    const idToken = typeof body === "object" && body && "firebase_id_token" in body ? String(body.firebase_id_token) : "";
    const identity = idToken ? await verifyFirebase(idToken) : null;
    if (!identity) throw new HostedAiError(401, "account_token_invalid", "Sign in to rtsai.net to link this install.", "unauthorized");
    if (!(await storeCall(() => store.linkInstall(install.installId, identity.uid)))) {
      throw new HostedAiError(401, "install_token_revoked", "This RTS AI install token is no longer active.", "unauthorized");
    }
    return Response.json({ linked: true, tier: "linked", daily_allowance_usd: config.linkedDailyUsd }, { headers: noStore });
  } catch (cause) {
    if (cause instanceof HostedAiError) return errorResponse(cause);
    return errorResponse(new HostedAiError(500, "internal_error", "Account linking failed.", "unavailable", 60));
  }
}

/** GET /api/ai/v1/models — OpenAI-style catalogue used by gateway health checks. */
export function handleModels() {
  return Response.json(
    { object: "list", data: [{ id: HOSTED_MODEL, object: "model", created: 0, owned_by: "anthropic" }] },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
