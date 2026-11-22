/**
 * WP2 guard: an untimed limit failure must be explained as skipped.
 *
 * Providers such as Token Harbor record a 429 "free allowance used" as
 * `errorCode`/`lastErrorType` without ever setting `rateLimitedUntil`. The
 * Cooldown Manager reads that via `hasUnrecoveredLimitError`; the resilience
 * explainer must reach the same verdict (`connection_limit_error`) instead of
 * falling through to "eligible".
 */
import assert from "node:assert/strict";
import test from "node:test";

import { inspectTargetResilience } from "../../src/lib/usage/resilienceExplain.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);

function inspect(connection: Record<string, unknown>) {
  return inspectTargetResilience({
    provider: "tokenharbor",
    model: "some-model",
    now: NOW,
    providerConnections: [{ id: "conn-1", provider: "tokenharbor", ...connection }],
  });
}

test("untimed 429 is skipped with connection_limit_error", async () => {
  const explanation = await inspect({
    testStatus: "active",
    rateLimitedUntil: null,
    errorCode: 429,
    lastErrorType: "rate_limited",
    backoffLevel: 2,
  });

  assert.equal(explanation.targetState, "skipped");
  const reason = explanation.skipReasons.find((r) => r.code === "connection_limit_error");
  assert.ok(reason, "must emit connection_limit_error");
  assert.equal(reason.connectionId, "conn-1");
  assert.equal(reason.evidence?.lastErrorType, "rate_limited");
  assert.equal(reason.evidence?.errorCode, 429);
  assert.equal(reason.evidence?.backoffLevel, 2);
  assert.equal(
    explanation.accounts[0]?.reasonCode,
    "connection_limit_error",
    "account explanation carries the new code"
  );
});

test("a limit-class lastErrorType alone is enough (no errorCode)", async () => {
  const explanation = await inspect({
    testStatus: "active",
    rateLimitedUntil: null,
    errorCode: null,
    lastErrorType: "quota_exhausted",
  });

  assert.ok(
    explanation.skipReasons.some((r) => r.code === "connection_limit_error"),
    "quota_exhausted alone must be explained"
  );
});

test("terminal status wins over the limit-error branch (credits_exhausted overlap)", async () => {
  // `credits_exhausted` is BOTH a terminal status and a `LIMIT_ERROR_TYPES`
  // member. Terminal means "will not self-recover" and must win.
  const explanation = await inspect({
    testStatus: "credits_exhausted",
    rateLimitedUntil: null,
    errorCode: 429,
    lastErrorType: "credits_exhausted",
  });

  assert.equal(
    explanation.skipReasons.some((r) => r.code === "connection_terminal_status"),
    true,
    "terminal status must be the verdict"
  );
  assert.equal(
    explanation.skipReasons.some((r) => r.code === "connection_limit_error"),
    false,
    "the softer limit-error verdict must not shadow terminal"
  );
});

test("a live cooldown still reports connection_cooldown, not connection_limit_error", async () => {
  const explanation = await inspect({
    testStatus: "active",
    rateLimitedUntil: new Date(NOW + 60_000).toISOString(),
    errorCode: 429,
    lastErrorType: "rate_limited",
  });

  assert.ok(
    explanation.skipReasons.some((r) => r.code === "connection_cooldown"),
    "live cooldown keeps its own code"
  );
  assert.equal(
    explanation.skipReasons.some((r) => r.code === "connection_limit_error"),
    false,
    "the limit-error branch must not double-report"
  );
});

test("a healthy connection is untouched", async () => {
  const explanation = await inspect({
    testStatus: "active",
    rateLimitedUntil: null,
    errorCode: null,
    lastErrorType: null,
  });

  assert.equal(
    explanation.skipReasons.some(
      (r) => r.code === "connection_limit_error" || r.code === "connection_cooldown"
    ),
    false
  );
  assert.equal(explanation.accounts[0]?.state, "eligible");
});
