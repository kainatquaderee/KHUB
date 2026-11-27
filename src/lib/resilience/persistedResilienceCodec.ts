/**
 * One canonical boundary for persisted cooldown timestamps and reason codes.
 * Pure module: no DB, platform, network or logger imports (safe on hot paths).
 */

const MAX_DATE_MS = 8.64e15;
const REASON_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

/**
 * Parse any supported cooldown representation to epoch ms.
 * Numeric strings include SQLite's REAL→TEXT form (`1781696905131.0`).
 * Returns null for absent, non-finite, out-of-Date-range and unparseable values.
 */
export function parseCooldownUntilMs(
  value: string | number | Date | null | undefined
): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return isRepresentableEpochMs(value.getTime()) ? value.getTime() : null;
  }
  if (typeof value === "number") {
    return isRepresentableEpochMs(value) ? value : null;
  }
  const raw = String(value).trim();
  if (raw === "") return null;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    return isRepresentableEpochMs(numeric) ? numeric : null;
  }
  const parsed = Date.parse(raw);
  return isRepresentableEpochMs(parsed) ? parsed : null;
}

/** Legacy wrapper: invalid values stay NaN so existing comparisons remain falsy. */
export function cooldownUntilMs(value: string | number | Date | null | undefined): number {
  return parseCooldownUntilMs(value) ?? Number.NaN;
}

/** Finite epoch-ms within the range JavaScript Dates can represent. */
export function isRepresentableEpochMs(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= MAX_DATE_MS;
}

/** Persist only enumerated/safe reason identifiers — never upstream text. */
export function sanitizeReasonCode(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim();
  return REASON_CODE_RE.test(trimmed) ? trimmed : "unknown";
}

export interface PersistedModelResilienceRow {
  stateKey: string;
  provider: string;
  connectionId: string;
  scope: "exact" | "quota_family";
  modelScope: string;
  reasonCode: string;
  lockUntilMs: number | null;
  lockedAtMs: number;
  failureCount: number;
  lastFailureAtMs: number;
  resetAfterMs: number;
  lastCooldownMs: number | null;
}
