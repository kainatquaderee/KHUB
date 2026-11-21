/**
 * Shared parser for operator-entered cooldown durations.
 *
 * The provider detail page's retry-delay selector ("Custom…") and the
 * `omniroute resilience cooldown` CLI both accept the same compact strings so a
 * duration typed in the dashboard round-trips through the CLI and the API:
 *
 *   7d  ·  12h  ·  30m  ·  90s  ·  500ms  ·  2w        (case-insensitive units)
 *   300  ·  604800                                     (bare number = seconds)
 *
 * Units compose additively ("1h30m"). The result is clamped to
 * MAX_PROVIDER_COOLDOWN_MS (30 days) so a typo cannot park a provider for
 * months, and anything unparseable — or a bare sub-second value — returns null.
 *
 * Kept free of app/server imports so the dashboard, the CLI (tsx) and open-sse
 * can all share one implementation.
 */

/** 30 days — the ceiling a single operator cooldown override may reach. */
export const MAX_PROVIDER_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
/** The same ceiling expressed in whole seconds (the unit settings persist). */
export const MAX_PROVIDER_COOLDOWN_SECONDS = MAX_PROVIDER_COOLDOWN_MS / 1000;

const COMPACT_NUMBER_RE = /^\d+(?:\.\d+)?$/;
const DURATION_SEGMENT_RE = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)/g;

const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Parse a duration string into milliseconds, or null when invalid.
 *
 * A bare number (no unit) is interpreted as SECONDS — matching the "Retry
 * delay" preset list, which is expressed in seconds. Rounds to the nearest
 * millisecond and clamps to MAX_PROVIDER_COOLDOWN_MS.
 */
export function parseDurationMs(value: string | number): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.min(Math.round(value * 1000), MAX_PROVIDER_COOLDOWN_MS);
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  // Bare number → seconds.
  if (COMPACT_NUMBER_RE.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return Math.min(Math.round(seconds * 1000), MAX_PROVIDER_COOLDOWN_MS);
  }

  // Compact duration with units: ms, s, m, h, d, w. A zero/negative segment
  // invalidates the whole string (rejects "0s", "-5m").
  DURATION_SEGMENT_RE.lastIndex = 0;
  let total = 0;
  let matched = false;
  let segment: RegExpExecArray | null;
  while ((segment = DURATION_SEGMENT_RE.exec(trimmed)) !== null) {
    matched = true;
    const amount = Number.parseFloat(segment[1]);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    total += amount * UNIT_TO_MS[segment[2]];
  }
  // The whole input must be consumed, so "7 days ago" is rejected.
  const leftover = trimmed.replace(DURATION_SEGMENT_RE, "").trim();
  if (!matched || leftover.length > 0 || total <= 0) return null;
  return Math.min(Math.round(total), MAX_PROVIDER_COOLDOWN_MS);
}

/**
 * Parse a duration into whole seconds, or null when invalid or below one
 * second. This is the value settings persist (`rateLimitCooldownSeconds`).
 */
export function parseCooldownSeconds(value: string | number): number | null {
  const ms = parseDurationMs(value);
  if (ms === null) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 1) return null;
  return Math.min(seconds, MAX_PROVIDER_COOLDOWN_SECONDS);
}

/** Human label for a stored override ("7d", "12h", "30m", "45s"), else null. */
export function formatCooldownSeconds(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  const whole = Math.trunc(seconds);
  if (whole % (7 * 24 * 60 * 60) === 0) return `${whole / (7 * 24 * 60 * 60)}w`;
  if (whole % (24 * 60 * 60) === 0) return `${whole / (24 * 60 * 60)}d`;
  if (whole % (60 * 60) === 0) return `${whole / (60 * 60)}h`;
  if (whole % 60 === 0) return `${whole / 60}m`;
  return `${whole}s`;
}
