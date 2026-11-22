/**
 * QA (cycle-2, WP3) — does an untimed 429 make `/api/search/providers` report the
 * provider as `"configured"`?
 *
 * Seeds a real connection row (no mocks) for a search provider and invokes the
 * real route handler. `resolveProviderStatus` is not exported, so the route is the
 * unit of test.
 *
 * A search account whose only failure is a 429 recorded WITHOUT a `rateLimitedUntil`
 * timer (Token Harbor style) is what the cycle-2 defect class is about. Expected
 * values are derived from the route's documented status contract:
 *   configured  — at least one usable key exists
 *   rate_limited — keys exist but every one is currently rate limited
 *   missing     — no keys
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-qa-wp3-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const auth = await import("../../src/sse/services/auth.ts");
const route = await import("../../src/app/api/search/providers/route.ts");
const { isAllRateLimitedCredentials } = await import("../../src/app/api/v1/_shared/rateLimit.ts");

const SEARCH_PROVIDER = "tavily-search";

async function resetStorage() {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
}

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function seedConnection(extra: Record<string, unknown> = {}) {
  return providersDb.createProviderConnection({
    provider: SEARCH_PROVIDER,
    authType: "apikey",
    apiKey: "[REDACTED:auth_header]",
    isActive: true,
    testStatus: "active",
    ...extra,
  });
}

function makeRequest() {
  return new Request("http://127.0.0.1/api/search/providers", { method: "GET" });
}

async function statusFor(providerId: string): Promise<string | undefined> {
  const res = await route.GET(makeRequest());
  assert.equal(res.status, 200, `route must answer 200, got ${res.status}`);
  const body = (await res.json()) as {
    providers: Array<{ id: string; status: string }>;
  };
  return body.providers.find((p) => p.id === providerId)?.status;
}

test("WP3: no connection → missing", async () => {
  await resetStorage();
  assert.equal(await statusFor(SEARCH_PROVIDER), "missing");
});

test("WP3: clean connection → configured", async () => {
  await resetStorage();
  await seedConnection();
  assert.equal(await statusFor(SEARCH_PROVIDER), "configured");
});

test("WP3: live rateLimitedUntil → rate_limited (control)", async () => {
  await resetStorage();
  await seedConnection({ rateLimitedUntil: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(await statusFor(SEARCH_PROVIDER), "rate_limited");
});

test("WP3: untimed 429 (errorCode 429, no timer) → OBSERVED status", async () => {
  await resetStorage();
  await seedConnection({ rateLimitedUntil: null, errorCode: 429, lastErrorType: "rate_limited" });
  const status = await statusFor(SEARCH_PROVIDER);
  console.log(`[WP3-MEASUREMENT] untimed 429 → ${status}`);
  assert.equal(status, "configured", "developer's claim: untimed 429 reports configured");
});

test("WP3: terminal credits_exhausted → OBSERVED status", async () => {
  await resetStorage();
  await seedConnection({ testStatus: "credits_exhausted", rateLimitedUntil: null, errorCode: 429 });
  const status = await statusFor(SEARCH_PROVIDER);
  console.log(`[WP3-MEASUREMENT] terminal credits_exhausted → ${status}`);
  assert.equal(status, "configured");
});

// ── mechanism probes: what does the routing selector hand back? ──

test("WP3 mechanism: untimed 429 is SELECTED as a usable credential (not allRateLimited)", async () => {
  await resetStorage();
  await seedConnection({ rateLimitedUntil: null, errorCode: 429, lastErrorType: "rate_limited" });
  const creds = await auth.getProviderCredentials(SEARCH_PROVIDER);
  assert.ok(creds, "a credential object is returned");
  assert.equal(isAllRateLimitedCredentials(creds), false, "not flagged allRateLimited");
  assert.ok(!("allExpired" in creds), "not flagged allExpired");
});

test("WP3 mechanism: a live timer returns allRateLimited", async () => {
  await resetStorage();
  await seedConnection({ rateLimitedUntil: new Date(Date.now() + 60_000).toISOString() });
  const creds = await auth.getProviderCredentials(SEARCH_PROVIDER);
  assert.equal(isAllRateLimitedCredentials(creds), true);
});

test("WP3 mechanism: terminal returns allExpired, which resolveProviderStatus does NOT treat as unusable", async () => {
  await resetStorage();
  await seedConnection({ testStatus: "credits_exhausted", rateLimitedUntil: null, errorCode: 429 });
  const creds = await auth.getProviderCredentials(SEARCH_PROVIDER);
  assert.ok(creds, "getProviderCredentials returns the allExpired sentinel, not null");
  assert.equal(isAllRateLimitedCredentials(creds), false, "allExpired is NOT allRateLimited");
  assert.equal((creds as Record<string, unknown>).allExpired, true, "terminal means allExpired");
  // resolveProviderStatus therefore falls into the first branch (non-null && !allRateLimited)
  // and reports "configured" — see the route assertion above.
});
