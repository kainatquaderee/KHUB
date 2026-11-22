/**
 * AC8–AC10 — every Cooldown Manager verdict must fall into exactly one visible
 * bucket on the two connection surfaces.
 *
 * The `cooldownStatus` change made `getEffectiveProviderConnectionStatus` return
 * the Cooldown Manager's own verdict for any non-"healthy" status, but the error
 * set still only knew the legacy statuses. A `terminal` account (banned / expired
 * / credits-exhausted) was therefore neither connected nor errored: the providers
 * list card computed connected=0/error=0/warning=0 and fell through to
 * `noConnections`, and the home topology drew a grey "idle" node. `rate_limited`
 * / `model_locked` were dropped the same way.
 *
 * These tests pin the exact COUNT INPUTS both surfaces compute before they render
 * a status — `providers/page.tsx:getProviderStats` and
 * `HomePageClient.tsx:providerStats` — using the same predicates those call sites
 * use. `getStatusDisplay` / the topology's active|error|idle choice are pure given
 * these counts, so the counts are the thing that was wrong.
 */
import test from "node:test";
import assert from "node:assert/strict";

const {
  countLimitedAccounts,
  isProviderConnectionConnected,
  isProviderConnectionErrored,
  isProviderConnectionWarned,
} = await import("../../src/shared/utils/providerConnectionStatus.ts");

interface Conn {
  isActive: boolean;
  testStatus: string;
  cooldownStatus?: string | null;
  prefixShadowed?: { code: "prefix_shadowed"; message: string } | null;
}

/** The counts `getProviderStats` / `providerStats` feed their status rendering. */
function statusCounts(connections: Conn[]) {
  return {
    total: connections.length,
    connected: connections.filter(isProviderConnectionConnected).length,
    error: connections.filter(isProviderConnectionErrored).length,
    warned: countLimitedAccounts(connections),
  };
}

const LIMITED_VERDICTS = ["rate_limited", "model_locked", "cooling_down"] as const;

// ---------------------------------------------------------------------------
// AC8 — terminal is errored; limited / healthy are not
// ---------------------------------------------------------------------------

test("AC8: a terminal verdict is errored, never connected or limited", () => {
  const connection: Conn = {
    isActive: true,
    testStatus: "active",
    cooldownStatus: "terminal",
  };
  assert.equal(isProviderConnectionErrored(connection), true);
  assert.equal(isProviderConnectionConnected(connection), false);
  assert.equal(isProviderConnectionWarned(connection), false);
});

test("AC8: limited and healthy verdicts are never errored", () => {
  for (const cooldownStatus of LIMITED_VERDICTS) {
    // A limited account may still carry a stale "error" testStatus; the Cooldown
    // Manager's verdict wins and must not be reported as a hard error.
    const connection: Conn = { isActive: true, testStatus: "error", cooldownStatus };
    assert.equal(isProviderConnectionErrored(connection), false, cooldownStatus);
    assert.equal(isProviderConnectionConnected(connection), false, cooldownStatus);
    assert.equal(isProviderConnectionWarned(connection), true, cooldownStatus);
  }

  const healthy: Conn = { isActive: true, testStatus: "active", cooldownStatus: "healthy" };
  assert.equal(isProviderConnectionErrored(healthy), false);
  assert.equal(isProviderConnectionWarned(healthy), false);
});

// ---------------------------------------------------------------------------
// AC9 — an all-terminal provider is errored on both surfaces, never "no connections"
// ---------------------------------------------------------------------------

test("AC9: a provider whose accounts are all terminal yields error > 0, not noConnections", () => {
  const connections: Conn[] = [
    { isActive: true, testStatus: "active", cooldownStatus: "terminal" },
    { isActive: true, testStatus: "active", cooldownStatus: "terminal" },
  ];
  const counts = statusCounts(connections);
  assert.equal(counts.connected, 0);
  assert.ok(counts.error > 0, "terminal accounts must count as errored");
  assert.equal(counts.warned, 0);
  // getStatusDisplay renders `noConnections` only when connected + warning + error
  // are all zero; the topology picks "idle" only when errors + warned are zero.
  assert.notEqual(counts.connected + counts.error + counts.warned, 0);
});

// ---------------------------------------------------------------------------
// AC10 — limited accounts are limited/warning, never silent
// ---------------------------------------------------------------------------

test("AC10: a provider whose accounts are all limited yields warning, not error/silence", () => {
  for (const cooldownStatus of LIMITED_VERDICTS) {
    const connections: Conn[] = [
      { isActive: true, testStatus: "active", cooldownStatus },
      { isActive: true, testStatus: "active", cooldownStatus },
    ];
    const counts = statusCounts(connections);
    assert.equal(counts.connected, 0, cooldownStatus);
    assert.equal(counts.error, 0, cooldownStatus);
    assert.ok(counts.warned > 0, `${cooldownStatus} must surface in the warning bucket`);
    assert.notEqual(counts.connected + counts.error + counts.warned, 0);
  }
});

// ---------------------------------------------------------------------------
// Guard rails on the limited-count helper
// ---------------------------------------------------------------------------

test("countLimitedAccounts ignores disabled and prefix-shadowed connections", () => {
  const disabled: Conn[] = [
    { isActive: false, testStatus: "active", cooldownStatus: "rate_limited" },
  ];
  assert.equal(countLimitedAccounts(disabled), 0);

  // A prefix-shadowed connection is errored; it must not also count as limited.
  const shadowed: Conn = {
    isActive: true,
    testStatus: "active",
    cooldownStatus: "rate_limited",
    prefixShadowed: { code: "prefix_shadowed", message: "prefix routes to builtin" },
  };
  assert.equal(isProviderConnectionWarned(shadowed), false);
  assert.equal(isProviderConnectionErrored(shadowed), true);
});

test("countLimitedAccounts counts only the limited connections in a mixed provider", () => {
  const connections: Conn[] = [
    { isActive: true, testStatus: "active", cooldownStatus: "healthy" },
    { isActive: true, testStatus: "active", cooldownStatus: "rate_limited" },
    { isActive: true, testStatus: "active", cooldownStatus: "terminal" },
    { isActive: true, testStatus: "active", cooldownStatus: "model_locked" },
    { isActive: true, testStatus: "active", cooldownStatus: "cooling_down" },
  ];
  assert.equal(countLimitedAccounts(connections), 3);
});
