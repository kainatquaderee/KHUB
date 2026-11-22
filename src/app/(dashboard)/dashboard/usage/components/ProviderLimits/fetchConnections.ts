import { fetchWithTimeout } from "@/shared/utils/fetchTimeout";
import { isCooldownStatus } from "@/lib/resilience/cooldownStatuses";

/** Thrown when the dashboard cannot list connections because the caller is not authenticated. */
export class ConnectionsAuthError extends Error {
  status: number;
  constructor(status: number) {
    super(`Authentication required (HTTP ${status})`);
    this.name = "ConnectionsAuthError";
    this.status = status;
  }
}

const isAuthStatus = (status: number) => status === 401 || status === 403;

/**
 * Drops a `cooldownStatus` this build does not understand instead of trusting it.
 *
 * The field comes from `/api/providers|client`, where a Cooldown Manager read can
 * legitimately fail. Absence already means "no verdict" downstream, so an
 * unrecognised value must behave the same rather than being treated as non-healthy.
 */
function sanitizeCooldownStatus<T>(connection: T): T {
  if (!connection || typeof connection !== "object") return connection;
  const record = connection as Record<string, unknown>;
  if (!("cooldownStatus" in record) || isCooldownStatus(record.cooldownStatus)) return connection;
  const { cooldownStatus: _invalid, ...valid } = record;
  return valid as T;
}

/**
 * Lists provider connections for the quota UIs.
 *
 * `/api/providers/client` is hard-gated (always requires a session) even when
 * `requireLogin=false`, so installs without login (desktop app, Docker/HTTPS) get a
 * 401 there. On 401/403 we retry once against `/api/providers`, which returns a
 * masked payload and is reachable when login is disabled (#17262, #17877).
 * A 401/403 on both throws `ConnectionsAuthError` instead of looking like "no connections".
 */
export async function fetchDashboardConnections<T = Record<string, unknown>>(
  timeoutMs?: number,
  init: Pick<RequestInit, "method" | "cache" | "signal"> = {}
): Promise<T[]> {
  let response = await fetchWithTimeout("/api/providers/client", { ...init, timeoutMs });
  if (isAuthStatus(response.status)) {
    response = await fetchWithTimeout("/api/providers", { ...init, timeoutMs });
    if (isAuthStatus(response.status)) throw new ConnectionsAuthError(response.status);
  }
  if (!response.ok) throw new Error("Failed");
  const data = await response.json();
  return ((data?.connections || []) as T[]).map(sanitizeCooldownStatus);
}

/** i18n keys (usage namespace) for the empty quota card: auth-required vs. truly no connections. */
export function emptyQuotaCardKeys(authRequired: boolean) {
  return authRequired
    ? { title: "quotaAuthRequired", hint: "quotaAuthRequiredHint" }
    : { title: "noProviders", hint: "connectProvidersForQuota" };
}
