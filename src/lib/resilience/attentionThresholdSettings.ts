import {
  DEFAULT_PROVIDER_ATTENTION_THRESHOLD,
  MAX_PROVIDER_ATTENTION_THRESHOLD,
} from "@/shared/constants/providerAttention";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};

/**
 * Resolve the stored "attention needed" threshold to a usable integer.
 *
 * Missing, non-numeric, `NaN` and `Infinity` fall back to the default (10).
 * A finite negative value (reachable only by a manual DB edit — the settings
 * schema rejects it on write) clamps to 0. Numeric strings are accepted because
 * settings blobs sometimes round-trip through JSON as strings.
 */
export function resolveProviderAttentionThreshold(settings: unknown): number {
  const raw = asRecord(settings).providerAttentionThreshold;
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_PROVIDER_ATTENTION_THRESHOLD;
  return Math.max(0, Math.min(MAX_PROVIDER_ATTENTION_THRESHOLD, Math.trunc(parsed)));
}
