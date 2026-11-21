/**
 * Provider Quota Endpoints
 *
 * Per-provider "custom usage link". An operator points a provider id at an HTTP
 * endpoint that reports the account's allowance (e.g. Token Harbor's
 * `GET https://tokenharbor.ai/api/cli/free-tier`), and OmniRoute reads the
 * remaining quota / credits from it so exhausted connections are skipped before
 * a request is ever routed to them.
 *
 * The endpoint description is the same declarative shape a connection declares
 * in `providerSpecificData.quotaEndpoint` (see
 * `open-sse/services/usage/openaiCompatible.ts`): a URL plus dot-paths that map
 * the response onto quota windows. A connection-level `quotaEndpoint` always
 * wins over the provider-level one, so this is a fallback, not an override.
 *
 * Configuration sources, settings win over environment:
 *   - settings: `resilience.providerQuotaEndpoints` (PATCH /api/resilience)
 *   - env:      PROVIDER_QUOTA_ENDPOINTS = JSON object of the same shape
 *
 * STATE SHARING: the Next.js standalone build splits this module across several
 * webpack chunks, so a plain module-local `let` would leave the settings applier
 * and the request-time quota reader looking at different maps (the same class of
 * defect previously fixed with globalThis in runtimeSettings.ts). The store is
 * therefore backed by `globalThis`.
 */

import type { OpenAiCompatibleQuotaEndpoint } from "../services/usage/openaiCompatible.ts";

const STORE_KEY = Symbol.for("omniroute.providerQuotaEndpoints");
const SIGNATURE_KEY = Symbol.for("omniroute.providerQuotaEndpoints.signature");

const MAX_URL_LENGTH = 2000;
const MAX_PATH_LENGTH = 200;
const MAX_HEADERS = 20;
const MAX_HEADER_NAME_LENGTH = 100;
const MAX_HEADER_VALUE_LENGTH = 2000;
const MAX_QUOTA_WINDOWS = 20;
const MAX_WINDOW_NAME_LENGTH = 100;
const ALLOWED_METHODS = new Set(["GET", "POST"]);
const ALLOWED_AUTH = new Set(["bearer", "x-api-key", "none"]);
const MAPPING_KEYS = ["used", "total", "remaining", "resetAt", "currency", "displayName"] as const;

type Store = Map<string, OpenAiCompatibleQuotaEndpoint>;

function getStore(): Store {
  const g = globalThis as unknown as Record<symbol, unknown>;
  let store = g[STORE_KEY] as Store | undefined;
  if (!store) {
    store = new Map<string, OpenAiCompatibleQuotaEndpoint>();
    g[STORE_KEY] = store;
  }
  return store;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isDotPath(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.trim().length <= MAX_PATH_LENGTH
  );
}

function normalizeMapping(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const mapping: Record<string, string> = {};
  for (const key of MAPPING_KEYS) {
    if (isDotPath(raw[key])) mapping[key] = raw[key].trim();
  }
  // A mapping with no usable dot-path carries no information.
  if (Object.keys(mapping).length === 0) return null;
  return mapping;
}

/**
 * Validate an operator-supplied endpoint description. Invalid entries are
 * dropped (the caller keeps the rest of the map), so one bad provider row can
 * never disable quota checking for every provider.
 */
function normalizeEndpoint(value: unknown): OpenAiCompatibleQuotaEndpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!isHttpUrl(raw.url)) return null;

  const endpoint: OpenAiCompatibleQuotaEndpoint = { url: raw.url.trim() };

  if (typeof raw.method === "string") {
    const method = raw.method.trim().toUpperCase();
    if (!ALLOWED_METHODS.has(method)) return null;
    endpoint.method = method;
  }
  if (typeof raw.auth === "string") {
    const auth = raw.auth.trim().toLowerCase();
    if (!ALLOWED_AUTH.has(auth)) return null;
    endpoint.auth = auth as OpenAiCompatibleQuotaEndpoint["auth"];
  }
  if (isDotPath(raw.plan)) endpoint.plan = raw.plan.trim();

  if (raw.headers && typeof raw.headers === "object" && !Array.isArray(raw.headers)) {
    const headers: Record<string, string> = {};
    let count = 0;
    for (const [name, headerValue] of Object.entries(raw.headers as Record<string, unknown>)) {
      if (count >= MAX_HEADERS) break;
      if (
        typeof headerValue !== "string" ||
        name.trim().length === 0 ||
        name.trim().length > MAX_HEADER_NAME_LENGTH ||
        headerValue.length > MAX_HEADER_VALUE_LENGTH
      ) {
        continue;
      }
      headers[name.trim()] = headerValue;
      count += 1;
    }
    if (Object.keys(headers).length > 0) endpoint.headers = headers;
  }

  // Window mappings are optional: a bare URL still registers the link (the
  // dashboard "custom usage link" toggle) and the quota reader in
  // usage/openaiCompatible.ts falls back to a generic mapping when none are
  // given. When mappings ARE present they must yield at least one usable window,
  // otherwise the entry is rejected rather than silently ignored.
  if (raw.quotas !== undefined) {
    if (typeof raw.quotas !== "object" || Array.isArray(raw.quotas)) return null;
    const quotas: NonNullable<OpenAiCompatibleQuotaEndpoint["quotas"]> = {};
    let windowCount = 0;
    for (const [name, mapping] of Object.entries(raw.quotas as Record<string, unknown>)) {
      if (windowCount >= MAX_QUOTA_WINDOWS) break;
      const windowName = name.trim();
      if (windowName.length === 0 || windowName.length > MAX_WINDOW_NAME_LENGTH) continue;
      const normalized = normalizeMapping(mapping);
      if (!normalized) continue;
      quotas[windowName] = normalized;
      windowCount += 1;
    }
    if (Object.keys(quotas).length === 0) return null;
    endpoint.quotas = quotas;
  }

  return endpoint;
}

function normalizeEndpoints(
  raw: Record<string, unknown> | null | undefined
): Record<string, OpenAiCompatibleQuotaEndpoint> {
  const out: Record<string, OpenAiCompatibleQuotaEndpoint> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [provider, value] of Object.entries(raw)) {
    const key = provider.trim().toLowerCase();
    if (key.length === 0) continue;
    const endpoint = normalizeEndpoint(value);
    if (endpoint) out[key] = endpoint;
  }
  return out;
}

function parseEnvEndpoints(): Record<string, OpenAiCompatibleQuotaEndpoint> {
  const raw = process.env.PROVIDER_QUOTA_ENDPOINTS;
  if (!raw || raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return normalizeEndpoints(
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null
    );
  } catch {
    // A malformed env blob must not crash boot; settings can still apply later.
    return {};
  }
}

/**
 * Replace the provider quota endpoints from settings and environment. Called at
 * startup and on every settings reload. Settings win over environment, and an
 * invalid entry is dropped rather than rejected wholesale.
 */
export function initProviderQuotaEndpoints(
  settingsEndpoints?: Record<string, unknown> | null
): void {
  const store = getStore();
  const next: Record<string, OpenAiCompatibleQuotaEndpoint> = parseEnvEndpoints();
  for (const [provider, endpoint] of Object.entries(normalizeEndpoints(settingsEndpoints))) {
    next[provider] = endpoint;
  }

  store.clear();
  for (const [provider, endpoint] of Object.entries(next)) {
    store.set(provider, endpoint);
  }

  // Log once per distinct configuration, not once per webpack chunk.
  const g = globalThis as unknown as Record<symbol, unknown>;
  const summary = Array.from(store.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, endpoint]) => `${provider}=${endpoint.url}`)
    .join(", ");
  if (g[SIGNATURE_KEY] !== summary) {
    g[SIGNATURE_KEY] = summary;
    console.log(
      summary
        ? `[providerQuota] active custom usage links: ${summary}`
        : "[providerQuota] no provider custom usage links configured"
    );
  }
}

/** Get the provider-level custom usage link, or null when none is configured. */
export function getProviderQuotaEndpoint(
  provider: string | null | undefined
): OpenAiCompatibleQuotaEndpoint | null {
  if (typeof provider !== "string") return null;
  return getStore().get(provider.trim().toLowerCase()) ?? null;
}

/** True when a provider has a configured custom usage link. */
export function hasProviderQuotaEndpoint(provider: string | null | undefined): boolean {
  return getProviderQuotaEndpoint(provider) !== null;
}

/** All configured provider quota endpoints (for status/inspection surfaces). */
export function getAllProviderQuotaEndpoints(): Array<{
  provider: string;
  endpoint: OpenAiCompatibleQuotaEndpoint;
}> {
  return Array.from(getStore().entries()).map(([provider, endpoint]) => ({ provider, endpoint }));
}

/** Clear all provider quota endpoints (for testing). */
export function clearProviderQuotaEndpoints(): void {
  getStore().clear();
}

// Initialize from environment at module load so cold-boot quota checks (before
// settings hydrate) already see the endpoint. settings applied later overwrite.
initProviderQuotaEndpoints();
