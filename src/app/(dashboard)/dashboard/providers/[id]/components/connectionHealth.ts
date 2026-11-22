import { hasUnrecoveredLimitError } from "@/lib/resilience/limitErrorState";

import type { ConnectionRowConnection } from "./connectionRowTypes";

// Re-exported so the provider page keeps importing its account-health predicates
// from here; the 429 vocabulary itself lives in lib/resilience/limitErrorState so
// the Cooldown Manager reads the same state.
export { hasUnrecoveredLimitError };

/**
 * Account-health predicates for the provider page.
 *
 * The Provider Limits page deliberately tracks quota for a fixed set of
 * providers; for everything else the useful per-provider signal is simply how
 * many accounts are *usable right now* — enabled, not prefix-shadowed, not
 * sitting in a 429 cooldown, not in an exhausted/banned/error status, and not
 * carrying an unrecovered rate-limit/quota error (providers such as Token Harbor
 * record a 429 without ever setting a cooldown). The "Multi-account routing"
 * card surfaces that as `healthy / total`.
 */

/** Test statuses that mean the last recorded state was fine. */
const HEALTHY_TEST_STATUSES = new Set(["active", "success"]);

/**
 * True while a connection's persisted 429 cooldown is still running. Mirrors the
 * filter `CoolingConnectionsPanel` applies, so the panel's list and the route
 * card's count can never disagree about who is cooling.
 */
export function isCoolingNow(connection: ConnectionRowConnection, now: number): boolean {
  if (!connection.rateLimitedUntil) return false;
  const until = new Date(connection.rateLimitedUntil).getTime();
  return Number.isFinite(until) && until > now;
}

/**
 * An account routing can use right now: not disabled, not prefix-shadowed, not
 * cooling down, not parked in an exhausted/banned/error status, and not carrying
 * an unrecovered rate-limit/quota error.
 *
 * The Cooldown Manager's `cooldownStatus` is authoritative when it reports
 * anything other than `"healthy"`: it sees recorded 429s (e.g. Token Harbor's
 * "free allowance used") that never set `rateLimitedUntil`, which the local
 * signals alone would miss. An absent status (older payloads/caches) keeps the
 * pre-change behaviour, and a `"healthy"` verdict still has to clear the local
 * signals so this never over-counts a cooling or errored account.
 */
export function isHealthyAccount(connection: ConnectionRowConnection, now: number): boolean {
  if (connection.cooldownStatus && connection.cooldownStatus !== "healthy") return false;
  const status = connection.testStatus;
  return (
    connection.isActive !== false &&
    !connection.prefixShadowed &&
    (!status || HEALTHY_TEST_STATUSES.has(status)) &&
    !isCoolingNow(connection, now) &&
    !hasUnrecoveredLimitError(connection)
  );
}

/** `healthy / total` account counts for one provider. */
export function countHealthyAccounts(
  connections: readonly ConnectionRowConnection[],
  now: number = Date.now()
): { healthy: number; total: number } {
  let healthy = 0;
  for (const connection of connections) {
    if (isHealthyAccount(connection, now)) healthy += 1;
  }
  return { healthy, total: connections.length };
}
