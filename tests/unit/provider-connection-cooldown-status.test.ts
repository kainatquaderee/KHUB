/**
 * The provider page's account health and the shared connection-status helper
 * must agree with the Cooldown Manager.
 *
 * Bug: GET /api/providers never sent a per-connection verdict, so the client had
 * to re-derive health from `testStatus`/`rateLimitedUntil`/`lastErrorType`. Token
 * Harbor records a 429 with no connection cooldown, so every account counted
 * healthy and the badge read `total / total` while the Cooldown Manager listed
 * the same accounts as `Rate limited`.
 *
 * Fix: the API now sends `cooldownStatus` (the Cooldown Manager's own status) and
 * these two client surfaces read it. AC2 and AC3 below pin that contract, and
 * AC5 pins that an absent/healthy status changes nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { countHealthyAccounts, isHealthyAccount } =
  await import("../../src/app/(dashboard)/dashboard/providers/[id]/components/connectionHealth.ts");
const {
  getEffectiveProviderConnectionStatus,
  isProviderConnectionConnected,
  isProviderConnectionErrored,
} = await import("../../src/shared/utils/providerConnectionStatus.ts");

const NOW = Date.parse("2026-07-17T00:00:00.000Z");

const COOLDOWN_STATUSES = [
  "rate_limited",
  "model_locked",
  "cooling_down",
  "terminal",
  "unavailable",
] as const;

// ---------------------------------------------------------------------------
// AC2 — healthy = total − (Cooldown Manager statuses that are not healthy)
// ---------------------------------------------------------------------------

test("AC2: healthy = total − (Cooldown Manager statuses that are not healthy)", () => {
  // Every row passes the local signals on its own, so the only thing that can
  // push a row out of the healthy count is the Cooldown Manager's verdict. That
  // makes the identity below an exact one, not an example.
  const connections = [
    { name: "ok", isActive: true, testStatus: "active", cooldownStatus: "healthy" },
    { name: "limited", isActive: true, testStatus: "active", cooldownStatus: "rate_limited" },
    { name: "locked", isActive: true, testStatus: "active", cooldownStatus: "model_locked" },
    { name: "cooling", isActive: true, testStatus: "active", cooldownStatus: "cooling_down" },
    { name: "terminal", isActive: true, testStatus: "active", cooldownStatus: "terminal" },
    { name: "unavailable", isActive: true, testStatus: "active", cooldownStatus: "unavailable" },
  ] as const;

  const result = countHealthyAccounts(connections, NOW);
  const notHealthy = connections.filter((c) => c.cooldownStatus !== "healthy").length;

  assert.equal(result.total, connections.length);
  assert.equal(result.healthy, result.total - notHealthy);
  assert.equal(result.healthy, 1);
});

test("AC2: each non-healthy Cooldown Manager status removes its account from the count", () => {
  for (const cooldownStatus of COOLDOWN_STATUSES) {
    const connection = { isActive: true, testStatus: "active", cooldownStatus };
    assert.equal(isHealthyAccount(connection, NOW), false, `${cooldownStatus} must not be healthy`);
  }
  assert.equal(
    isHealthyAccount({ isActive: true, testStatus: "active", cooldownStatus: "healthy" }, NOW),
    true
  );
});

test("AC5: absent cooldownStatus leaves the pre-change healthy count untouched", () => {
  const connections = [
    { isActive: true, testStatus: "active" },
    { isActive: true, testStatus: "banned" },
    { isActive: true, testStatus: "unavailable", rateLimitedUntil: "2026-07-17T00:05:00.000Z" },
    { isActive: true, testStatus: "active", errorCode: 429, lastErrorType: "rate_limited" },
    { isActive: false, testStatus: "active" },
  ];
  // active + (cooling already expired? no) + the 429 error row excluded locally.
  assert.deepEqual(countHealthyAccounts(connections, NOW), { healthy: 1, total: 5 });
});

test("AC5: a stale 'healthy' verdict still cannot over-count a cooling account", () => {
  const connection = {
    isActive: true,
    testStatus: "unavailable",
    rateLimitedUntil: "2026-07-17T00:05:00.000Z",
    cooldownStatus: "healthy",
  };
  assert.equal(isHealthyAccount(connection, NOW), false);
});

// ---------------------------------------------------------------------------
// AC3 — the shared status helper defers to the Cooldown Manager verdict
// ---------------------------------------------------------------------------

test("AC3: a rate-limited/locked account is no longer 'connected'", () => {
  for (const cooldownStatus of COOLDOWN_STATUSES) {
    const connection = { isActive: true, testStatus: "active", cooldownStatus };
    assert.equal(
      getEffectiveProviderConnectionStatus(connection, NOW),
      cooldownStatus,
      `effective status must be the Cooldown Manager's ${cooldownStatus}`
    );
    assert.equal(
      isProviderConnectionConnected(connection, NOW),
      false,
      `${cooldownStatus} must not count as connected`
    );
  }
});

test("AC3: a healthy verdict or a missing field keeps the previous connected/errored result", () => {
  const healthy = { isActive: true, testStatus: "active", cooldownStatus: "healthy" };
  assert.equal(getEffectiveProviderConnectionStatus(healthy, NOW), "active");
  assert.equal(isProviderConnectionConnected(healthy, NOW), true);
  assert.equal(isProviderConnectionErrored(healthy, NOW), false);

  const absent = { isActive: true, testStatus: "active" };
  assert.equal(getEffectiveProviderConnectionStatus(absent, NOW), "active");
  assert.equal(isProviderConnectionConnected(absent, NOW), true);
});

test("AC3: unavailable + expired cooldown still restores to active when the verdict is healthy", () => {
  const connection = {
    isActive: true,
    testStatus: "unavailable",
    rateLimitedUntil: "2026-07-16T23:59:59.000Z",
    cooldownStatus: "healthy",
  };
  assert.equal(getEffectiveProviderConnectionStatus(connection, NOW), "active");
  assert.equal(isProviderConnectionConnected(connection, NOW), true);
});
