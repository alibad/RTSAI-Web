/**
 * Server-only mail writer for RTS AI's own Firebase project (rtsai-net).
 *
 * Each email is one document in the `mail` collection, the log of every message; the writer then calls our sendMail
 * function (functions/index.js, europe-west1) with its id, which sends it over SMTP and writes its `delivery` state
 * back (the Trigger Email extension's contract). A Firestore trigger can't do it: the database is in me-central2, where
 * Google offers no functions. firestore.rules ("Outgoing mail") only accepts the extension's exact shape, addressed to
 * the team group, so the writer needs no secret: it writes and calls with the signed-in caller's verified ID token when
 * the route has one, and otherwise (server jobs such as hosted-AI spend alerts) as an anonymous user of the project.
 * No SMTP credential or service account lives here.
 */

const projectId = () => process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";
const apiKey = () => process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "";

/** Local tests write to the Firestore and Auth emulators. */
function firestoreBase() {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  return `${emulator ? `http://${emulator}` : "https://firestore.googleapis.com"}/v1/projects/${projectId()}/databases/(default)/documents`;
}
function identityBase() {
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  return emulator ? `http://${emulator}/identitytoolkit.googleapis.com` : "https://identitytoolkit.googleapis.com";
}

/** The sendMail function; tests point MAIL_FUNCTION_URL at the emulator's, or (on the emulators) leave mail queued. */
function mailFunctionUrl() {
  if (process.env.MAIL_FUNCTION_URL) return process.env.MAIL_FUNCTION_URL;
  if (process.env.FIRESTORE_EMULATOR_HOST) return null;
  return `https://europe-west1-${projectId()}.cloudfunctions.net/sendMail`;
}

export function mailConfigured() {
  return Boolean(projectId() && apiKey());
}

let cachedToken: { idToken: string; expiresAtMs: number } | null = null;

async function anonymousMailToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs - 5 * 60_000) return cachedToken.idToken;
  if (!mailConfigured()) throw new Error("Firebase mail is not configured");

  const response = await fetch(`${identityBase()}/v1/accounts:signUp?key=${apiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  if (!response.ok) throw new Error(`Firebase mail authentication failed (${response.status})`);
  const payload = await response.json() as { idToken?: string; expiresIn?: string };
  if (!payload.idToken) throw new Error("Firebase mail authentication returned no token");
  cachedToken = {
    idToken: payload.idToken,
    expiresAtMs: Date.now() + Number(payload.expiresIn ?? 3_600) * 1_000,
  };
  return cachedToken.idToken;
}

type FirestoreValue = Record<string, unknown>;

function encodeValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number")
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
  return { stringValue: String(value) };
}

function encodeFields(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, encodeValue(item)]),
  );
}

/** The team's Google Group (MAIL_GROUP): every team email goes here, its searchable archive of events. */
export function mailGroup() {
  return (process.env.MAIL_GROUP ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function sendFirebaseEmail(input: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** The signed-in caller's verified Firebase ID token; without it the write is anonymous. */
  idToken?: string;
}) {
  if (!mailConfigured()) throw new Error("Firebase mail is not configured");
  const token = input.idToken || await anonymousMailToken();
  const document = {
    to: Array.isArray(input.to) ? input.to : [input.to],
    message: {
      subject: input.subject.slice(0, 199),
      html: input.html.slice(0, 32_767),
      text: input.text.slice(0, 32_767),
    },
  };

  const response = await fetch(`${firestoreBase()}/mail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(document) }),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]").slice(0, 500);
    throw new Error(`Firebase mail write failed (${response.status}): ${detail}`);
  }
  const result = await response.json() as { name?: string };
  const id = result.name?.split("/").pop() ?? null;
  const url = mailFunctionUrl();
  if (id && url) {
    const sent = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!sent.ok) throw new Error(`Mail ${id} queued but not sent (${sent.status}): ${(await sent.text()).slice(0, 300)}`);
  }
  return id;
}
