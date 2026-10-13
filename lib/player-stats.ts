/**
 * Usage counters in the rtsai-net Firestore: players/{uid} (per player) and stats/global (overall). The server writes
 * them with the caller's own Firebase ID token, so firestore.rules is the only authority: a player can only add 1 to
 * their own counters and to one overall counter at a time. Each commit returns the post-increment values, which decide
 * the milestone emails.
 */
import type { GlobalCounter, PlayerCounter } from "./event-registry";

type Value = Record<string, unknown>;
const projectId = () => process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";
/** FIRESTORE_EMULATOR_HOST (host:port) points the counters at a local emulator in tests. */
const base = () => process.env.FIRESTORE_EMULATOR_HOST
  ? `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1`
  : "https://firestore.googleapis.com/v1";

export type CountResult = { player?: number; global?: number };

export async function countEvent(input: { idToken: string; uid: string; player?: PlayerCounter; global?: GlobalCounter }): Promise<CountResult> {
  if (!projectId() || (!input.player && !input.global)) return {};
  const root = `projects/${projectId()}/databases/(default)/documents`;
  const writes: Value[] = [];
  const now = { fieldPath: "lastSeen", setToServerValue: "REQUEST_TIME" };
  if (input.player) writes.push({
    update: { name: `${root}/players/${input.uid}`, fields: {} },
    updateMask: { fieldPaths: [] },
    updateTransforms: [{ fieldPath: input.player, increment: { integerValue: "1" } }, now],
  });
  if (input.global) writes.push({
    update: { name: `${root}/stats/global`, fields: {} },
    updateMask: { fieldPaths: [] },
    updateTransforms: [{ fieldPath: input.global, increment: { integerValue: "1" } }],
  });
  const response = await fetch(`${base()}/${root}:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]").slice(0, 300);
    throw new Error(`Usage counter write failed (${response.status}): ${detail}`);
  }
  const result = await response.json() as { writeResults?: { transformResults?: { integerValue?: string }[] }[] };
  const values = (result.writeResults ?? []).map(w => Number(w.transformResults?.[0]?.integerValue ?? NaN));
  const out: CountResult = {};
  let i = 0;
  if (input.player) out.player = values[i++];
  if (input.global) out.global = values[i++];
  return out;
}
