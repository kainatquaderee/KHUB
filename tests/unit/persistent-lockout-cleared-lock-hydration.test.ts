/**
 * AC-10 / AC-17 — hydration separates the lock deadline from the escalation
 * window: a cleared lock with live failure state escalates the next failure,
 * while a NULL deadline with no recorded cooldown carries no state to recover.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyHydratedModelLockouts,
  clearAllModelLockouts,
  isModelLocked,
  recordModelLockoutFailure,
} from "../../open-sse/services/accountFallback.ts";
import type { PersistedModelResilienceRow } from "../../src/lib/resilience/persistedResilienceCodec.ts";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const PROVIDER = "codex";
const CONNECTION = "cleared-lock-hydration-connection";
const MODEL = "gpt-5.6-cleared-lock";
const STATE_KEY = `${PROVIDER}:${CONNECTION}:exact:${MODEL}`;

function row(overrides: Partial<PersistedModelResilienceRow> = {}): PersistedModelResilienceRow {
  const now = Date.now();
  return {
    stateKey: STATE_KEY,
    provider: PROVIDER,
    connectionId: CONNECTION,
    scope: "exact",
    modelScope: MODEL,
    reasonCode: "rate_limited",
    lockUntilMs: null,
    lockedAtMs: now - 2 * MINUTE,
    failureCount: 1,
    lastFailureAtMs: now - 2 * MINUTE,
    resetAfterMs: 30 * MINUTE,
    lastCooldownMs: MINUTE,
    ...overrides,
  };
}

function recordFailure() {
  return recordModelLockoutFailure(PROVIDER, CONNECTION, MODEL, "rate_limited", 429, MINUTE, null, {
    scope: "exact",
    maxCooldownMs: HOUR,
  });
}

test("AC-10: a cleared lock with a live escalation window escalates the next failure", () => {
  clearAllModelLockouts({ persist: false });
  try {
    const at = Date.now();
    assert.deepEqual(applyHydratedModelLockouts([row()], { nowMs: at, replace: true }), {
      restored: 1,
      skipped: 0,
    });
    assert.equal(
      isModelLocked(PROVIDER, CONNECTION, MODEL),
      false,
      "a cleared deadline must not restore an active lock"
    );
    const second = recordFailure();
    assert.equal(second.failureCount, 2);
    assert.equal(second.cooldownMs, 2 * MINUTE);
  } finally {
    clearAllModelLockouts({ persist: false });
  }
});

test("AC-17: a NULL deadline without a recorded cooldown carries no escalation state", () => {
  clearAllModelLockouts({ persist: false });
  try {
    const at = Date.now();
    assert.deepEqual(
      applyHydratedModelLockouts([row({ lastCooldownMs: null })], { nowMs: at, replace: true }),
      { restored: 0, skipped: 1 }
    );
    const first = recordFailure();
    assert.equal(first.failureCount, 1, "malformed deadline must not seed a failure count");
    assert.equal(first.cooldownMs, MINUTE);
  } finally {
    clearAllModelLockouts({ persist: false });
  }
});
