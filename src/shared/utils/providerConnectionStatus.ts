export interface PrefixShadowedDiagnostic {
  code: "prefix_shadowed";
  message: string;
  prefix?: string;
  builtinProvider?: string;
}

export interface ProviderConnectionStatusLike {
  prefixShadowed?: PrefixShadowedDiagnostic | null;
  isActive?: boolean | null;
  testStatus?: string | null;
  rateLimitedUntil?: string | number | Date | null;
  /**
   * The Cooldown Manager's verdict, sent by GET /api/providers. Absent on older
   * payloads/caches, in which case the local signals below decide as before.
   */
  cooldownStatus?: string | null;
}

const CONNECTED_STATUSES = new Set(["active", "success", "unknown"]);
// `terminal` is the Cooldown Manager's verdict for a banned / expired /
// credits-exhausted account. It is a needs-attention state — never connected —
// and must stay in the error bucket so the providers list card and the home
// topology render an error state instead of falling through to "no connections"
// / grey "idle".
const ERROR_STATUSES = new Set(["error", "expired", "unavailable", "prefix_shadowed", "terminal"]);
// Cooldown Manager verdicts that mean "not usable right now, but not a hard
// failure": rate limited, model locked, cooling down. They are neither connected
// nor errored, so the providers-list card routes them to its warning (limited)
// badge via `isProviderConnectionWarned` — they must never disappear from both
// the connected and error/warning counts.
const LIMITED_COOLDOWN_STATUSES = new Set(["rate_limited", "model_locked", "cooling_down"]);

export function getEffectiveProviderConnectionStatus(
  connection: ProviderConnectionStatusLike,
  now = Date.now()
): string {
  if (connection.prefixShadowed?.code === "prefix_shadowed") return "prefix_shadowed";
  // The Cooldown Manager's verdict wins whenever it is not "healthy". Its
  // verdicts classify as: `terminal` → errored (it is in ERROR_STATUSES);
  // `rate_limited` / `model_locked` / `cooling_down` → limited/warning (see
  // `isProviderConnectionWarned`); `unavailable` → errored. None are connected,
  // so a rate-limited account stops counting as connected on the providers list
  // and the home dashboard. "healthy" (or absent, on older payloads/caches)
  // falls through to the local signals, which keeps prior behaviour intact.
  const cooldownStatus = connection.cooldownStatus;
  if (cooldownStatus && cooldownStatus !== "healthy") return cooldownStatus;
  const status = connection.testStatus || "unknown";
  if (status !== "unavailable") return status;

  const rawCooldownUntil = connection.rateLimitedUntil;
  const cooldownUntil =
    rawCooldownUntil instanceof Date
      ? rawCooldownUntil.getTime()
      : typeof rawCooldownUntil === "string" || typeof rawCooldownUntil === "number"
        ? new Date(rawCooldownUntil).getTime()
        : Number.NaN;
  const isCoolingDown = Number.isFinite(cooldownUntil) && cooldownUntil > now;
  return isCoolingDown ? status : "active";
}

export function isProviderConnectionConnected(
  connection: ProviderConnectionStatusLike,
  now = Date.now()
): boolean {
  return (
    connection.isActive !== false &&
    CONNECTED_STATUSES.has(getEffectiveProviderConnectionStatus(connection, now))
  );
}

export function isProviderConnectionErrored(
  connection: ProviderConnectionStatusLike,
  now = Date.now()
): boolean {
  return (
    connection.isActive !== false &&
    ERROR_STATUSES.has(getEffectiveProviderConnectionStatus(connection, now))
  );
}

/**
 * True when the Cooldown Manager reports a *limited* state — rate limited,
 * model locked, or cooling down — that is neither connected nor a hard error.
 *
 * The providers-list card has no error/warning-free slot for these accounts, so
 * its warning (limited) badge counts them via this predicate; without it they
 * would render badge-less even though the Cooldown Manager flags them. The
 * verdict stays out of `ERROR_STATUSES` deliberately: `terminal` is a hard
 * failure, but a temporary cooldown is not.
 */
export function isProviderConnectionWarned(connection: ProviderConnectionStatusLike): boolean {
  if (connection.isActive === false) return false;
  if (connection.prefixShadowed?.code === "prefix_shadowed") return false;
  return (
    typeof connection.cooldownStatus === "string" &&
    LIMITED_COOLDOWN_STATUSES.has(connection.cooldownStatus)
  );
}

/**
 * Counts the connections the Cooldown Manager reports as limited — rate limited,
 * model locked, or cooling down (see `isProviderConnectionWarned`). The providers
 * list card and the home topology count these so such accounts land in the warning
 * bucket instead of vanishing from both the connected and error counts.
 */
export function countLimitedAccounts(connections: ProviderConnectionStatusLike[]): number {
  let count = 0;
  for (const connection of connections) {
    if (isProviderConnectionWarned(connection)) count += 1;
  }
  return count;
}
