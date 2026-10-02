/**
 * Claude Haiku 4.5 list prices (USD per million tokens), first-party API:
 * input $1, output $5, prompt-cache write $1.25 (5-minute TTL), cache read $0.10.
 * At $1 per million tokens one input token costs exactly one micro-dollar, so
 * all accounting is integer micro-USD.
 */
export const HAIKU_45_PRICES = {
  inputPerMTok: 1,
  outputPerMTok: 5,
  cacheWritePerMTok: 1.25,
  cacheReadPerMTok: 0.1,
} as const;

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function costMicros(usage: TokenUsage) {
  return Math.ceil(
    usage.input_tokens * HAIKU_45_PRICES.inputPerMTok +
      usage.output_tokens * HAIKU_45_PRICES.outputPerMTok +
      (usage.cache_creation_input_tokens ?? 0) * HAIKU_45_PRICES.cacheWritePerMTok +
      (usage.cache_read_input_tokens ?? 0) * HAIKU_45_PRICES.cacheReadPerMTok,
  );
}

/** Image tokens are roughly width × height / 750; Claude downsizes images above ~1.15 MP first. */
export function imageTokenEstimate(width: number | undefined, height: number | undefined) {
  if (!width || !height) return 1_600;
  const scale = Math.min(1, Math.sqrt(1_150_000 / (width * height)), 1_568 / Math.max(width, height));
  return Math.ceil((width * scale * height * scale) / 750);
}

/**
 * Upper-bound reservation for one request: generous input estimate (3 characters
 * per token) plus the full clamped output budget. Settlement replaces it with the
 * exact `usage` the API reports.
 */
export function reservationMicros(textCharacters: number, imageTokens: number, maxTokens: number) {
  return costMicros({ input_tokens: Math.ceil(textCharacters / 3) + imageTokens + 16, output_tokens: maxTokens });
}
