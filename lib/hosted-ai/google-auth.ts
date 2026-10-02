import { importPKCS8, SignJWT } from "jose";

/**
 * Server-only Google service-account access token (OAuth 2.0 JWT bearer grant)
 * for the Firestore REST API. The key arrives in RTSAI_AI_FIREBASE_SERVICE_ACCOUNT
 * as the downloaded JSON key, either raw or base64-encoded. It is never logged.
 */

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

const SCOPE = "https://www.googleapis.com/auth/datastore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

let cached: { token: string; expiresAtMs: number; email: string } | null = null;

export function serviceAccount(): ServiceAccount | null {
  const raw = (process.env.RTSAI_AI_FIREBASE_SERVICE_ACCOUNT ?? "").trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith("{") ? raw : atob(raw);
    const value = JSON.parse(json) as Partial<ServiceAccount>;
    if (!value.project_id || !value.client_email || !value.private_key) return null;
    return { project_id: value.project_id, client_email: value.client_email, private_key: value.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

export async function googleAccessToken(account: ServiceAccount) {
  if (cached && cached.email === account.client_email && Date.now() < cached.expiresAtMs - 5 * 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1_000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3_600)
    .sign(await importPKCS8(account.private_key, "RS256"));
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("Google token exchange returned no access token");
  cached = { token: payload.access_token, expiresAtMs: Date.now() + (payload.expires_in ?? 3_600) * 1_000, email: account.client_email };
  return cached.token;
}
