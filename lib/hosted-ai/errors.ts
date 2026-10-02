/**
 * OpenAI-compatible error envelopes with a stable machine code and a coarse
 * `x-rtsai-ai-state` header. The game maps the state to a HUD line and decides
 * whether to fall back to a local model or to deterministic alerts.
 */

export type HostedAiState =
  | "ok"
  | "invalid"
  | "unauthorized"
  | "allowance"
  | "rate_limited"
  | "paused"
  | "budget"
  | "unavailable"
  | "upstream";

export class HostedAiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly state: HostedAiState,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "HostedAiError";
  }
}

const errorTypes: Record<number, string> = {
  400: "invalid_request_error",
  401: "authentication_error",
  403: "permission_error",
  404: "not_found_error",
  413: "invalid_request_error",
  429: "rate_limit_error",
  502: "api_error",
  503: "service_unavailable",
};

export const noStore = { "Cache-Control": "no-store" } as const;

export function errorResponse(error: HostedAiError) {
  const headers: Record<string, string> = { ...noStore, "x-rtsai-ai-state": error.state };
  if (error.retryAfterSeconds !== undefined) headers["Retry-After"] = String(Math.max(1, Math.ceil(error.retryAfterSeconds)));
  return Response.json(
    {
      error: {
        message: error.message,
        type: errorTypes[error.status] ?? "api_error",
        code: error.code,
        rtsai_state: error.state,
      },
    },
    { status: error.status, headers },
  );
}

export const invalid = (code: string, message: string) => new HostedAiError(400, code, message, "invalid");
