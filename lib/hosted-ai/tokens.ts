import { jwtVerify, SignJWT } from "jose";
import { HostedAiError } from "./errors";

/**
 * Zero-click install identity. The game asks `/api/ai/v1/install` once on first
 * launch and stores the token with Windows DPAPI. The token only names an
 * install; the allowance tier lives in the usage store so linking an account
 * (or revoking an install) never requires reissuing a token.
 */

const ISSUER = "https://rtsai.net";
const AUDIENCE = "rtsai-ai-proxy";
const TOKEN_TYPE = "rtsai-install";
const TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

function secretKey(secret: string) {
  if (secret.length < 32) {
    throw new HostedAiError(503, "token_secret_not_configured", "Hosted AI is not configured yet.", "unavailable");
  }
  return new TextEncoder().encode(secret);
}

export async function issueInstallToken(installId: string, secret: string, nowSeconds = Math.floor(Date.now() / 1_000)) {
  const expiresAt = nowSeconds + TOKEN_LIFETIME_SECONDS;
  const token = await new SignJWT({ typ: TOKEN_TYPE, v: 1 })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(installId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiresAt)
    .sign(secretKey(secret));
  return { token, expiresAt };
}

export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return "";
  return authorization.slice("Bearer ".length).trim();
}

/** Returns the install id or throws a 401 the game answers by requesting a new token. */
export async function verifyInstallToken(token: string, secret: string) {
  const key = secretKey(secret);
  if (!token) throw new HostedAiError(401, "install_token_missing", "An RTS AI install token is required.", "unauthorized");
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
    if (payload.typ !== TOKEN_TYPE || typeof payload.sub !== "string" || !/^[0-9a-f-]{36}$/.test(payload.sub)) {
      throw new Error("wrong token type");
    }
    return payload.sub;
  } catch {
    throw new HostedAiError(401, "install_token_invalid", "The RTS AI install token is invalid or expired.", "unauthorized");
  }
}
