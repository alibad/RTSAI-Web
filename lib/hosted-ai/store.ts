/**
 * Durable usage accounting behind one small interface.
 *
 * Spend is tracked in integer micro-USD. `chargedMicros` holds settled cost
 * plus in-flight reservations, so concurrent requests cannot overspend: a
 * request atomically increments every counter it needs first, then rolls back
 * if any limit is exceeded (increment-then-check).
 */

export type InstallRecord = {
  installId: string;
  createdAt: number;
  /** Firebase uid after the player links an rtsai.net account (raises the allowance). */
  linkedUid: string | null;
  revoked: boolean;
};

export type QuotaLimits = { installMicros: number; globalMicros: number; perMinute: number };

export type ReserveOutcome =
  | { ok: true; installMicros: number; globalMicros: number }
  | { ok: false; reason: "allowance" | "budget" | "rate_limited"; installMicros: number; globalMicros: number };

export type SettledUsage = { costMicros: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export type UsageSnapshot = { installMicros: number; globalMicros: number; calls: number };

/** Totals after a settlement. `globalSpentMicros` is today's settled spend across every install (null when unknown). */
export type SettleResult = { globalSpentMicros: number | null };

/** Facts recorded with a claimed spend alert, for the operator's audit trail. */
export type SpendAlertClaim = { spentMicros: number; capMicros: number; claimedAt: number };

export interface UsageStore {
  readonly kind: "memory" | "firestore";
  /** Counts the install against its IP's daily limit, then records it. Returns false when the IP is over the limit. */
  createInstall(record: InstallRecord, ipKey: string, day: string, ipLimit: number): Promise<boolean>;
  getInstall(installId: string): Promise<InstallRecord | null>;
  /** Account-linking seam: a linked install gets the higher daily allowance. */
  linkInstall(installId: string, uid: string): Promise<boolean>;
  usage(installId: string, day: string): Promise<UsageSnapshot>;
  reserve(installId: string, day: string, minute: string, amountMicros: number, limits: QuotaLimits): Promise<ReserveOutcome>;
  settle(installId: string, day: string, reservedMicros: number, usage: SettledUsage): Promise<SettleResult>;
  /**
   * Claims the one alert email for a spend threshold (percent of the daily cap) on a UTC day.
   * Resolves true for exactly one caller per day and threshold, across every server instance.
   */
  claimSpendAlert(day: string, thresholdPercent: number, claim: SpendAlertClaim): Promise<boolean>;
  /** Gives a claim back after the email could not be queued, so a later call can retry it. */
  releaseSpendAlert(day: string, thresholdPercent: number): Promise<void>;
}

export function decideReservation(
  after: { install: number; global: number; minute: number },
  limits: QuotaLimits,
): ReserveOutcome {
  const values = { installMicros: after.install, globalMicros: after.global };
  if (after.install > limits.installMicros) return { ok: false, reason: "allowance", ...values };
  if (after.global > limits.globalMicros) return { ok: false, reason: "budget", ...values };
  if (after.minute > limits.perMinute) return { ok: false, reason: "rate_limited", ...values };
  return { ok: true, ...values };
}

/** Per-process store for tests and local development. Never used on Vercel production. */
export class MemoryUsageStore implements UsageStore {
  readonly kind = "memory" as const;
  private installs = new Map<string, InstallRecord>();
  private counters = new Map<string, number>();
  private spendAlerts = new Map<string, SpendAlertClaim>();

  private add(key: string, amount: number) {
    const value = (this.counters.get(key) ?? 0) + amount;
    this.counters.set(key, value);
    return value;
  }

  async createInstall(record: InstallRecord, ipKey: string, day: string, ipLimit: number) {
    if (this.add(`ip:${ipKey}:${day}`, 1) > ipLimit) {
      this.add(`ip:${ipKey}:${day}`, -1);
      return false;
    }
    this.installs.set(record.installId, { ...record });
    return true;
  }

  async getInstall(installId: string) {
    const record = this.installs.get(installId);
    return record ? { ...record } : null;
  }

  async linkInstall(installId: string, uid: string) {
    const record = this.installs.get(installId);
    if (!record) return false;
    record.linkedUid = uid;
    return true;
  }

  async usage(installId: string, day: string) {
    return {
      installMicros: this.counters.get(`install:${installId}:${day}`) ?? 0,
      globalMicros: this.counters.get(`global:${day}`) ?? 0,
      calls: this.counters.get(`calls:${installId}:${day}`) ?? 0,
    };
  }

  async reserve(installId: string, day: string, minute: string, amountMicros: number, limits: QuotaLimits) {
    const after = {
      install: this.add(`install:${installId}:${day}`, amountMicros),
      global: this.add(`global:${day}`, amountMicros),
      minute: this.add(`minute:${installId}:${minute}`, 1),
    };
    const outcome = decideReservation(after, limits);
    if (!outcome.ok) {
      this.add(`install:${installId}:${day}`, -amountMicros);
      this.add(`global:${day}`, -amountMicros);
      this.add(`minute:${installId}:${minute}`, -1);
    }
    return outcome;
  }

  async settle(installId: string, day: string, reservedMicros: number, usage: SettledUsage) {
    const delta = usage.costMicros - reservedMicros;
    this.add(`install:${installId}:${day}`, delta);
    this.add(`global:${day}`, delta);
    if (usage.costMicros > 0) this.add(`calls:${installId}:${day}`, 1);
    return { globalSpentMicros: this.add(`spent:${day}`, Math.max(0, usage.costMicros)) };
  }

  async claimSpendAlert(day: string, thresholdPercent: number, claim: SpendAlertClaim) {
    const key = `${day}_${thresholdPercent}`;
    if (this.spendAlerts.has(key)) return false;
    this.spendAlerts.set(key, { ...claim });
    return true;
  }

  async releaseSpendAlert(day: string, thresholdPercent: number) {
    this.spendAlerts.delete(`${day}_${thresholdPercent}`);
  }

  /** Test helper: pretend part of today's allowance is already spent. */
  seedSpend(installId: string, day: string, micros: number, global = micros) {
    this.add(`install:${installId}:${day}`, micros);
    this.add(`global:${day}`, global);
    this.add(`spent:${day}`, global);
  }
}
