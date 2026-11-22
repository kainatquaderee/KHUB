/**
 * The connection states the cooldown manager reports (see `CooldownStatus` in
 * `cooldownManager.ts`).
 *
 * This list lives in its own client-safe module because the Provider Limits
 * availability hook validates every row it receives: one unknown status makes
 * its `.every(validCooldown)` check fail and the whole summary is discarded.
 * Deriving the server-side union from here keeps the two from drifting.
 */
export const COOLDOWN_STATUSES = [
  "terminal",
  "cooling_down",
  "rate_limited",
  "model_locked",
  "unavailable",
  "healthy",
] as const;

export type CooldownStatusValue = (typeof COOLDOWN_STATUSES)[number];

/** True when `value` is a cooldown status this app knows how to render. */
export function isCooldownStatus(value: unknown): value is CooldownStatusValue {
  return typeof value === "string" && (COOLDOWN_STATUSES as readonly string[]).includes(value);
}
