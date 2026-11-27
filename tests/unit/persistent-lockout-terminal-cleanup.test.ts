/**
 * AC-6/AC-10 — cleanup removes only stale model-resilience rows; it never
 * resurrects or clears terminal connection states, which require operator
 * action rather than a timer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-terminal-cleanup-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const {
  upsertModelResilienceState,
  purgeExpiredModelResilienceState,
  readAllModelResilienceState,
} = await import("../../src/lib/db/modelLockoutState.ts");

const HOUR = 3_600_000;

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function row(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    stateKey: "codex:conn-1:exact:model-a",
    provider: "codex",
    connectionId: "conn-1",
    scope: "exact" as const,
    modelScope: "model-a",
    reasonCode: "rate_limit",
    lockUntilMs: now + HOUR,
    lockedAtMs: now,
    failureCount: 1,
    lastFailureAtMs: now,
    resetAfterMs: 30 * 60_000,
    lastCooldownMs: HOUR,
    ...overrides,
  };
}

test("AC-10: stale rows are purged while active lockouts and live escalation windows remain", () => {
  const now = Date.now();
  upsertModelResilienceState(
    row({
      stateKey: "codex:stale:exact:old-model",
      connectionId: "stale",
      lockUntilMs: now - HOUR,
      lockedAtMs: now - 4 * HOUR,
      lastFailureAtMs: now - 4 * HOUR,
      lastCooldownMs: 0,
    })
  );
  upsertModelResilienceState(
    row({ stateKey: "codex:active:exact:model-b", connectionId: "active" })
  );
  // Lock expired, but its escalation window is still live: the row must stay.
  upsertModelResilienceState(
    row({
      stateKey: "codex:escalating:exact:model-c",
      connectionId: "escalating",
      lockUntilMs: now - 60_000,
      lastFailureAtMs: now - 60_000,
    })
  );

  const result = purgeExpiredModelResilienceState(now);
  assert.equal(result.deleted, 1);
  const remaining = readAllModelResilienceState()
    .map((entry) => entry.stateKey)
    .sort();
  assert.deepEqual(remaining, ["codex:active:exact:model-b", "codex:escalating:exact:model-c"]);
});

test("AC-6: terminal connections keep their past cooldown through crash cleanup", async () => {
  const past = new Date(Date.now() - HOUR).toISOString();
  const terminal = await providersDb.createProviderConnection({
    provider: "codex",
    authType: "apikey",
    apiKey: "sk-terminal-cleanup-test",
    testStatus: "banned",
    rateLimitedUntil: past,
    isActive: true,
  });
  const transient = await providersDb.createProviderConnection({
    provider: "codex",
    authType: "apikey",
    apiKey: "sk-transient-cleanup-test",
    testStatus: "unavailable",
    rateLimitedUntil: past,
    isActive: true,
  });

  const { cleared } = providersDb.clearStaleCrashCooldowns();
  assert.equal(cleared, 1, "only the non-terminal transient cooldown is cleared");

  const rows = await providersDb.getRawProviderConnections({ provider: "codex" });
  const byId = new Map(rows.map((entry) => [String(entry.id), entry]));
  assert.equal(byId.get(terminal.id)?.testStatus, "banned");
  assert.equal(byId.get(terminal.id)?.rateLimitedUntil, past);
  assert.equal(byId.get(transient.id)?.testStatus, "active");
  // getRawProviderConnections() runs every row through cleanNulls(), which omits
  // null fields. The SQL UPDATE still writes NULL; assert the row shape and the
  // behavioural reader instead of expecting a `null` property that cannot exist.
  assert.equal("rateLimitedUntil" in (byId.get(transient.id) ?? {}), false);
  assert.equal(providersDb.isConnectionRateLimited(transient.id), false);
});
