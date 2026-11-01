import { LEGAL } from "../../../lib/legal";
import { bearerToken, verifyFirebaseIdentity } from "../../../lib/firebase-token";

/**
 * GET /api/account: the signed-in player's data as a JSON download. DELETE /api/account: erases it and the account.
 * Both go on to the `account` function on rtsai-net (functions/account.js), which has the admin rights to read and
 * delete what the player's browser can't; it gets the player's own ID token and checks it again, so no secret lives
 * here. DELETE needs a sign-in from the last ten minutes; the function answers 401 { reauthenticate: true } otherwise.
 */

const allowedOrigins = ["https://rtsai.net", "https://www.rtsai.net"];
const projectId = () => process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";

/** The account function; tests point ACCOUNT_FUNCTION_URL at the emulator's. */
export function accountFunctionUrl() {
  if (process.env.ACCOUNT_FUNCTION_URL) return process.env.ACCOUNT_FUNCTION_URL;
  if (process.env.FIRESTORE_EMULATOR_HOST || !projectId()) return null;
  return `https://europe-west1-${projectId()}.cloudfunctions.net/account`;
}

const unavailable = () => Response.json({ error: `Account tools are not available right now. Write to ${LEGAL.contactEmail} and we'll do it for you.` }, { status: 503 });

export function createAccountHandler(deps: {
  verifyIdentity: typeof verifyFirebaseIdentity;
  functionUrl: () => string | null;
  fetch: typeof fetch;
  reportError: typeof console.error;
}) {
  return async function handleAccount(request: Request) {
    const origin = request.headers.get("origin");
    if (origin && !allowedOrigins.includes(origin) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return Response.json({ error: "Invalid request origin" }, { status: 403 });
    const identity = await deps.verifyIdentity(request);
    if (!identity) return Response.json({ error: "Sign in required" }, { status: 401 });
    const url = deps.functionUrl();
    if (!url) return unavailable();
    let response: Response;
    try {
      response = await deps.fetch(url, { method: request.method, headers: { Authorization: `Bearer ${bearerToken(request)}` }, signal: AbortSignal.timeout(120_000) });
    } catch (cause) {
      deps.reportError("Account function unreachable", { method: request.method, message: cause instanceof Error ? cause.message.slice(0, 300) : "unknown" });
      return unavailable();
    }
    // Not deployed yet (Google's own 404 page) or any other answer that isn't the function's JSON.
    if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
      deps.reportError("Account function answered without JSON", { method: request.method, status: response.status });
      return unavailable();
    }
    const body = await response.text();
    const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    if (request.method === "GET" && response.ok) headers["Content-Disposition"] = `attachment; filename="rtsai-account-${new Date().toISOString().slice(0, 10)}.json"`;
    return new Response(body, { status: response.status, headers });
  };
}

const handler = createAccountHandler({ verifyIdentity: verifyFirebaseIdentity, functionUrl: accountFunctionUrl, fetch: (...args) => fetch(...args), reportError: console.error });
export const GET = handler;
export const DELETE = handler;
