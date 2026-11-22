/**
 * QA (cycle-2, WP2) — independent branch-order tests for the resilience explainer.
 *
 * Documented contract after the fix:
 *   live cooldown  → `connection_cooldown`
 *   terminal status → `connection_terminal_status`
 *   unrecovered limit error (no live cooldown) → `connection_limit_error`
 *   healthy → not skipped
 *
 * The overlap case (`credits_exhausted` also matching a limit class) exercised a
 * real pre-fix bug; these tests derive the expected code from the documented
 * order, not from the implementation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { inspectTargetResilience } from "../../src/lib/usage/resilienceExplain.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const FUTURE = new Date(NOW + 60_000).toISOString();
const PAST = new Date(NOW - 60_000).toISOString();

function inspect(connection: Record<string, unknown>) {
  return inspectTargetResilience({
    provider: "tokenharbor",
    model: "some-model",
    now: NOW,
    providerConnections: [{ id: "conn-1", provider: "tokenharbor", ...connection }],
  });
}

function codes(explanation: Awaited<ReturnType<typeof inspect>>): string[] {
  return explanation.skipReasons.map((r) => r.code);
}

test("WP2: a live rateLimitedUntil yields connection_cooldown (with retryAfterMs)", async () => {
  const e = await inspect({ testStatus: "active", rateLimitedUntil: FUTURE });
  assert.deepEqual(codes(e), ["connection_cooldown"]);
  const r = e.skipReasons[0];
  assert.equal(r.connectionId, "conn-1");
  assert.ok((r.retryAfterMs ?? 0) > 0, "retryAfterMs must be positive");
  assert.equal(e.targetState, "skipped");
  assert.equal(e.accounts[0]?.reasonCode, "connection_cooldown");
});

test("WP2: terminal credits_exhausted yields connection_terminal_status, even when the error also matches a limit class", async () => {
  const e = await inspect({
    testStatus: "credits_exhausted",
    rateLimitedUntil: null,
    lastErrorType: "credits_exhausted",
    errorCode: 429,
  });
  assert.deepEqual(
    codes(e),
    ["connection_terminal_status"],
    "terminal wins over the limit-error branch"
  );
  assert.equal(e.accounts[0]?.reasonCode, "connection_terminal_status");
});

test("WP2: terminal banned / expired also yield connection_terminal_status", async () => {
  for (const status of ["banned", "expired"]) {
    const e = await inspect({ testStatus: status, rateLimitedUntil: null, errorCode: 429 });
    assert.deepEqual(codes(e), ["connection_terminal_status"], status);
  }
});

test("WP2: active testStatus + untimed 429 yields connection_limit_error", async () => {
  const e = await inspect({
    testStatus: "active",
    rateLimitedUntil: null,
    errorCode: 429,
    lastErrorType: "rate_limited",
    backoffLevel: 3,
  });
  assert.deepEqual(codes(e), ["connection_limit_error"]);
  const r = e.skipReasons[0];
  assert.equal(r.connectionId, "conn-1");
  assert.equal(r.evidence?.lastErrorType, "rate_limited");
  assert.equal(r.evidence?.errorCode, 429);
  assert.equal(r.evidence?.backoffLevel, 3);
  assert.equal(r.evidence?.rateLimitedUntil, null);
  assert.equal(e.targetState, "skipped");
  assert.equal(e.accounts[0]?.reasonCode, "connection_limit_error");
});

test("WP2: a limit-class lastErrorType alone (no errorCode) yields connection_limit_error", async () => {
  const e = await inspect({
    testStatus: "active",
    rateLimitedUntil: null,
    errorCode: null,
    lastErrorType: "quota_exhausted",
  });
  assert.deepEqual(codes(e), ["connection_limit_error"]);
});

test("WP2: a limit error with an EXPIRED timer still yields connection_limit_error, not cooldown", async () => {
  const e = await inspect({ testStatus: "active", rateLimitedUntil: PAST, errorCode: 429 });
  assert.deepEqual(codes(e), ["connection_limit_error"]);
});

test("WP2: a healthy connection is not skipped", async () => {
  const e = await inspect({
    testStatus: "active",
    rateLimitedUntil: null,
    lastErrorType: null,
    errorCode: null,
  });
  assert.deepEqual(codes(e), []);
  assert.equal(e.targetState, "eligible");
  assert.equal(e.accounts[0]?.reasonCode, null);
  assert.equal(e.accounts[0]?.state, "eligible");
});

test("WP2: an unknown lastErrorType is NOT skipped (no over-trigger in the explainer)", async () => {
  const e = await inspect({
    testStatus: "active",
    rateLimitedUntil: null,
    lastErrorType: "timeout",
    errorCode: null,
  });
  assert.deepEqual(codes(e), []);
  assert.equal(e.targetState, "eligible");
});

test("WP2: non-limit errorCode (503) stays eligible", async () => {
  const e = await inspect({ testStatus: "active", rateLimitedUntil: null, errorCode: 503 });
  assert.deepEqual(codes(e), []);
});

// ── documented precedence probe: live cooldown + terminal status ──

test("WP2 precedence: live cooldown + terminal status → connection_cooldown (cooldown is checked first)", async () => {
  const e = await inspect({
    testStatus: "credits_exhausted",
    rateLimitedUntil: FUTURE,
    errorCode: 429,
  });
  // The cooldown branch precedes the terminal-status branch in accountReason().
  // Observed: cooldown wins. This ordering is PRE-EXISTING (the cycle-2 diff only
  // inserted the limit-error branch after the terminal branch).
  assert.deepEqual(codes(e), ["connection_cooldown"]);
});

test("WP2: multiple connections each get their own verdict", async () => {
  const e = await inspectTargetResilience({
    provider: "tokenharbor",
    model: "some-model",
    now: NOW,
    providerConnections: [
      { id: "clean", provider: "tokenharbor", testStatus: "active", rateLimitedUntil: null },
      {
        id: "limited",
        provider: "tokenharbor",
        testStatus: "active",
        rateLimitedUntil: null,
        errorCode: 429,
      },
      { id: "down", provider: "tokenharbor", testStatus: "banned", rateLimitedUntil: null },
    ],
  });
  const byId = new Map(e.accounts.map((a) => [a.connectionId, a]));
  assert.equal(byId.get("clean")?.reasonCode, null);
  assert.equal(byId.get("clean")?.state, "eligible");
  assert.equal(byId.get("limited")?.reasonCode, "connection_limit_error");
  assert.equal(byId.get("down")?.reasonCode, "connection_terminal_status");
  // The target stays eligible: a usable sibling exists. targetState is driven by
  // whether ANY account is usable, not by the mere presence of skip reasons.
  assert.equal(e.targetState, "eligible");
});

test("WP2: target is skipped only when no account is usable", async () => {
  const e = await inspectTargetResilience({
    provider: "tokenharbor",
    model: "some-model",
    now: NOW,
    providerConnections: [
      {
        id: "a",
        provider: "tokenharbor",
        testStatus: "active",
        rateLimitedUntil: null,
        errorCode: 429,
      },
      { id: "b", provider: "tokenharbor", testStatus: "banned", rateLimitedUntil: null },
    ],
  });
  assert.equal(e.targetState, "skipped");
  assert.deepEqual(e.skipReasons.map((r) => r.code).sort(), [
    "connection_limit_error",
    "connection_terminal_status",
  ]);
});
