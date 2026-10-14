/**
 * Daily rollups for the weekly digest. Every event a signed-in player sends (POST /api/event, and every feedback report
 * through /api/feedback) is also added to its Doha day in rtsai-net's Firestore, dailyStats/{YYYY-MM-DD}, by our
 * recordEvent function (functions/index.js, europe-west1). The function writes with admin rights through a whitelist
 * of fields (functions/rollup.js), so props can never grow a document, and clients have no rule for dailyStats at all.
 * It gets the caller's own verified ID token and checks it again; no secret lives here. Best effort: a slow or failed
 * rollup is reported and never breaks the request.
 */

const projectId = () => process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";

/** The recordEvent function; tests point RECORD_EVENT_URL at the emulator's, or (on the emulators) skip the rollup. */
function recordEventUrl() {
  if (process.env.RECORD_EVENT_URL) return process.env.RECORD_EVENT_URL;
  if (process.env.FIRESTORE_EMULATOR_HOST || !projectId()) return null;
  return `https://europe-west1-${projectId()}.cloudfunctions.net/recordEvent`;
}

export async function recordDailyEvent(input: { idToken: string; name: string; props: Record<string, string | number | boolean> }) {
  const url = recordEventUrl();
  if (!url || !input.idToken) return false;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: input.name, props: input.props }),
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) throw new Error(`Daily rollup failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  return true;
}
