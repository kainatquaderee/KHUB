/**
 * Shared rate-limit error vocabulary.
 *
 * Two surfaces need to agree on what "this account is rate limited" means: the
 * provider page's account-health card (`dashboard/providers/[id]`) and the
 * Cooldown Manager (`lib/resilience/cooldownManager`). Providers such as Token
 * Harbor answer with a 429 "free allowance used" and record `error_code` /
 * `last_error_type` *without* setting a connection cooldown, so a rule based on
 * `rate_limited_until` alone would keep calling those accounts usable.
 */

/** `last_error_type` values the SSE layer persists for limit-class failures. */
export const LIMIT_ERROR_TYPES: ReadonlySet<string> = new Set([
  "rate_limited",
  "rate_limit_exceeded",
  "quota_exhausted",
  "upstream_rate_limited",
  "credits_exhausted",
]);

/** The two persisted fields a limit-class failure is recorded in. */
export interface LimitErrorFields {
  errorCode?: string | number | null;
  lastErrorType?: string | null;
}

/**
 * True when the last recorded failure was a rate-limit/quota-class error that no
 * later success has cleared (a successful test or health check resets
 * `lastErrorType`/`errorCode`).
 */
export function hasUnrecoveredLimitError(connection: LimitErrorFields): boolean {
  const errorType = connection.lastErrorType?.toLowerCase();
  if (errorType && LIMIT_ERROR_TYPES.has(errorType)) return true;
  return Number(connection.errorCode) === 429;
}
