import { googleAccessToken, serviceAccount } from "./google-auth";
import {
  decideReservation,
  type InstallRecord,
  type QuotaLimits,
  type SettledUsage,
  type SpendAlertClaim,
  type UsageSnapshot,
  type UsageStore,
} from "./store";

/**
 * Firestore (REST) implementation of the usage store, authenticated with a
 * server-only service account. Counters use atomic server-side `increment`
 * transforms inside single `commit` calls; the post-increment values come back
 * in `transformResults`, so a reservation is one round trip (plus one rollback
 * round trip only when a limit is exceeded).
 *
 * Collections (all server-only; client security rules should deny them):
 *   aiInstalls/{installId}            install record and account link
 *   aiInstallIps/{ipHash}_{day}       install issuance per hashed IP (TTL)
 *   aiUsage/{installId}_{day}         per-install daily spend and tokens (TTL)
 *   aiSpend/{day}                     global daily spend and tokens (TTL 60 days)
 *   aiRate/{installId}_{minute}       per-minute request counter (TTL)
 *   aiSpendAlerts/{day}_{percent}     one claimed operator spend alert per day and threshold (TTL)
 */

type Value = Record<string, unknown>;
type Write = Record<string, unknown>;

const DAY_MS = 86_400_000;

function timestamp(ms: number): Value {
  return { timestampValue: new Date(ms).toISOString() };
}

function integer(value: unknown) {
  if (value && typeof value === "object" && "integerValue" in value) return Number((value as { integerValue: string }).integerValue);
  if (value && typeof value === "object" && "doubleValue" in value) return Number((value as { doubleValue: number }).doubleValue);
  return 0;
}

export class FirestoreUsageStore implements UsageStore {
  readonly kind = "firestore" as const;

  private get account() {
    const account = serviceAccount();
    if (!account) throw new Error("RTSAI_AI_FIREBASE_SERVICE_ACCOUNT is not configured");
    return account;
  }

  private documentName(path: string) {
    return `projects/${this.account.project_id}/databases/(default)/documents/${path}`;
  }

  private async call(suffix: string, init: RequestInit & { allowStatus?: number } = {}) {
    const account = this.account;
    const token = await googleAccessToken(account);
    const { allowStatus, ...request } = init;
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${account.project_id}/databases/(default)/documents${suffix}`,
      { ...request, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...request.headers } },
    );
    if (allowStatus !== undefined && response.status === allowStatus) return null;
    if (!response.ok) {
      const detail = (await response.text()).replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]").slice(0, 300);
      throw new Error(`Firestore request failed (${response.status}): ${detail}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  private increment(path: string, counters: Record<string, number>, fields: Record<string, Value> = {}): Write {
    return {
      update: { name: this.documentName(path), fields },
      updateMask: { fieldPaths: Object.keys(fields) },
      updateTransforms: Object.entries(counters).map(([fieldPath, amount]) => ({
        fieldPath,
        increment: { integerValue: String(Math.round(amount)) },
      })),
    };
  }

  private async commit(writes: Write[]) {
    const result = await this.call(":commit", { method: "POST", body: JSON.stringify({ writes }) });
    return ((result?.writeResults as { transformResults?: unknown[] }[]) ?? []).map((item) => (item.transformResults ?? []).map(integer));
  }

  async createInstall(record: InstallRecord, ipKey: string, day: string, ipLimit: number) {
    const expires = timestamp(Date.parse(`${day}T00:00:00Z`) + 2 * DAY_MS);
    const ipPath = `aiInstallIps/${ipKey}_${day}`;
    const [[count]] = await this.commit([this.increment(ipPath, { count: 1 }, { expireAt: expires })]);
    if (count > ipLimit) {
      await this.commit([this.increment(ipPath, { count: -1 }, { expireAt: expires })]);
      return false;
    }
    await this.commit([{
      update: {
        name: this.documentName(`aiInstalls/${record.installId}`),
        fields: {
          createdAt: timestamp(record.createdAt),
          linkedUid: { nullValue: null },
          revoked: { booleanValue: false },
        },
      },
      currentDocument: { exists: false },
    }]);
    return true;
  }

  async getInstall(installId: string): Promise<InstallRecord | null> {
    const document = await this.call(`/aiInstalls/${installId}`, { allowStatus: 404 });
    if (!document) return null;
    const fields = (document.fields ?? {}) as Record<string, Record<string, unknown>>;
    return {
      installId,
      createdAt: Date.parse(String(fields.createdAt?.timestampValue ?? "")) || 0,
      linkedUid: typeof fields.linkedUid?.stringValue === "string" ? fields.linkedUid.stringValue : null,
      revoked: fields.revoked?.booleanValue === true,
    };
  }

  async linkInstall(installId: string, uid: string) {
    try {
      await this.commit([{
        update: {
          name: this.documentName(`aiInstalls/${installId}`),
          fields: { linkedUid: { stringValue: uid }, linkedAt: timestamp(Date.now()) },
        },
        updateMask: { fieldPaths: ["linkedUid", "linkedAt"] },
        currentDocument: { exists: true },
      }]);
      return true;
    } catch {
      return false;
    }
  }

  async usage(installId: string, day: string): Promise<UsageSnapshot> {
    const result = await this.call(":batchGet", {
      method: "POST",
      body: JSON.stringify({ documents: [this.documentName(`aiUsage/${installId}_${day}`), this.documentName(`aiSpend/${day}`)] }),
    });
    const rows = (Array.isArray(result) ? result : []) as { found?: { name: string; fields?: Record<string, unknown> } }[];
    const fieldsOf = (suffix: string) => rows.find((row) => row.found?.name.endsWith(suffix))?.found?.fields ?? {};
    const install = fieldsOf(`aiUsage/${installId}_${day}`);
    const global = fieldsOf(`aiSpend/${day}`);
    return { installMicros: integer(install.chargedMicros), globalMicros: integer(global.chargedMicros), calls: integer(install.calls) };
  }

  private usageWrites(installId: string, day: string, minute: string | null, counters: Record<string, number>, minuteDelta = 0) {
    const dayStart = Date.parse(`${day}T00:00:00Z`);
    const writes = [
      this.increment(`aiUsage/${installId}_${day}`, counters, {
        day: { stringValue: day },
        installId: { stringValue: installId },
        expireAt: timestamp(dayStart + 3 * DAY_MS),
      }),
      this.increment(`aiSpend/${day}`, counters, { day: { stringValue: day }, expireAt: timestamp(dayStart + 60 * DAY_MS) }),
    ];
    if (minute) {
      writes.push(this.increment(`aiRate/${installId}_${minute}`, { count: minuteDelta }, { expireAt: timestamp(Date.now() + DAY_MS) }));
    }
    return writes;
  }

  async reserve(installId: string, day: string, minute: string, amountMicros: number, limits: QuotaLimits) {
    const [[install], [global], [minuteCount]] = await this.commit(
      this.usageWrites(installId, day, minute, { chargedMicros: amountMicros }, 1),
    );
    const outcome = decideReservation({ install, global, minute: minuteCount }, limits);
    if (!outcome.ok) await this.commit(this.usageWrites(installId, day, minute, { chargedMicros: -amountMicros }, -1));
    return outcome;
  }

  async settle(installId: string, day: string, reservedMicros: number, usage: SettledUsage) {
    const counters: Record<string, number> = { chargedMicros: usage.costMicros - reservedMicros };
    if (usage.costMicros > 0) {
      Object.assign(counters, {
        calls: 1,
        spentMicros: usage.costMicros,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
      });
    }
    // usageWrites returns [aiUsage, aiSpend]; transform results follow the counter order.
    const [, global] = await this.commit(this.usageWrites(installId, day, null, counters));
    const spentIndex = Object.keys(counters).indexOf("spentMicros");
    return { globalSpentMicros: spentIndex >= 0 && global?.[spentIndex] !== undefined ? global[spentIndex] : null };
  }

  async claimSpendAlert(day: string, thresholdPercent: number, claim: SpendAlertClaim) {
    const dayStart = Date.parse(`${day}T00:00:00Z`);
    // Create-if-absent: the precondition makes Firestore answer 409 ALREADY_EXISTS to every later claimer.
    const result = await this.call(":commit", {
      method: "POST",
      allowStatus: 409,
      body: JSON.stringify({
        writes: [{
          update: {
            name: this.documentName(`aiSpendAlerts/${day}_${thresholdPercent}`),
            fields: {
              day: { stringValue: day },
              thresholdPercent: { integerValue: String(thresholdPercent) },
              spentMicros: { integerValue: String(Math.round(claim.spentMicros)) },
              capMicros: { integerValue: String(Math.round(claim.capMicros)) },
              claimedAt: timestamp(claim.claimedAt),
              expireAt: timestamp(dayStart + 60 * DAY_MS),
            },
          },
          currentDocument: { exists: false },
        }],
      }),
    });
    return result !== null;
  }

  async releaseSpendAlert(day: string, thresholdPercent: number) {
    await this.commit([{ delete: this.documentName(`aiSpendAlerts/${day}_${thresholdPercent}`) }]);
  }
}
