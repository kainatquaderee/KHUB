/**
 * QA (cycle-2, WP1) — independent boundary tests for the shared limit-error
 * status rule as it lands in the Free Provider Rankings surface.
 *
 * The public contract under test:
 *   - a connection is `degraded` while its `rateLimitedUntil` timer is live OR it
 *     carries an unrecovered rate-limit/quota error (`hasUnrecoveredLimitError`);
 *   - terminal statuses (`credits_exhausted` / `banned` / `expired`) are `down`;
 *   - a clean (or success-cleared) connection is `healthy`;
 *   - `filterFreeProviderRankings({availableOnly})` drops providers with no usable
 *     connection and keeps providers with at least one.
 *
 * Expected values are derived from the documented contract, not from the
 * implementation's own arithmetic. `classifyConnection` is module-private, so its
 * verdict is observed through `attachProviderReliability` (which exposes one
 * `state` per connection) — a contract-shaped public surface.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isProviderUsable,
  filterFreeProviderRankings,
  attachProviderReliability,
  type ConnectionState,
  type FreeProviderRanking,
} from "../../src/lib/freeProviderRankings.ts";
import { hasUnrecoveredLimitError } from "../../src/lib/resilience/limitErrorState.ts";

const FIXED_NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const future = () => new Date(FIXED_NOW + 60_000).toISOString();
const past = () => new Date(FIXED_NOW - 60_000).toISOString();

function ranking(id: string): FreeProviderRanking {
  return {
    id,
    name: id,
    icon: "",
    color: "#000",
    category: "apikey",
    topModel: null,
    averageScore: 0.5,
    modelCount: 1,
  };
}

function conn(provider: string, extra: Partial<ConnectionState> = {}): ConnectionState {
  return { provider, testStatus: "active", rateLimitedUntil: null, ...extra };
}

/** classifyConnection's verdict for a single connection, observed publicly. */
function stateOf(connection: ConnectionState): string {
  const out = attachProviderReliability([ranking(connection.provider)], [connection], FIXED_NOW);
  const reliability = out[0].reliability;
  assert.ok(reliability, "reliability must be attached");
  return reliability.connections[0].state;
}

// ─────────────────────────── predicate itself ───────────────────────────

test("predicate: untimed 429 (errorCode only) is a limit error", () => {
  assert.equal(hasUnrecoveredLimitError({ errorCode: 429, lastErrorType: null }), true);
});

test("predicate: every documented limit lastErrorType is recognised", () => {
  for (const t of [
    "rate_limited",
    "rate_limit_exceeded",
    "quota_exhausted",
    "upstream_rate_limited",
    "credits_exhausted",
  ]) {
    assert.equal(
      hasUnrecoveredLimitError({ lastErrorType: t, errorCode: null }),
      true,
      `${t} must be a limit error`
    );
  }
});

test("predicate: an unknown lastErrorType is NOT a limit error (no over-trigger)", () => {
  for (const t of ["timeout", "server_error", "model_capacity", "auth_error", "forbidden", ""]) {
    assert.equal(
      hasUnrecoveredLimitError({ lastErrorType: t, errorCode: null }),
      false,
      `${JSON.stringify(t)} must not trigger`
    );
  }
});

test("predicate: errorCode 0 / null / NaN are NOT a limit error", () => {
  assert.equal(hasUnrecoveredLimitError({ errorCode: 0 }), false);
  assert.equal(hasUnrecoveredLimitError({ errorCode: null }), false);
  assert.equal(hasUnrecoveredLimitError({ errorCode: "not-a-number" }), false);
});

test("predicate: errorCode 429 as a string triggers (Number coercion)", () => {
  assert.equal(hasUnrecoveredLimitError({ errorCode: "429" }), true);
});

test("predicate: uppercase lastErrorType triggers; whitespace-padded does not (observed)", () => {
  // Case-insensitivity is a documented convenience. Whitespace is NOT trimmed by
  // the shared predicate today; record the observed behaviour so a future change
  // is intentional. (No producer writes a padded value — see QA report.)
  assert.equal(hasUnrecoveredLimitError({ lastErrorType: "RATE_LIMITED" }), true);
  assert.equal(hasUnrecoveredLimitError({ lastErrorType: " rate_limited " }), false);
});

// ─────────────────── classifyConnection via public surface ───────────────────

test("classify: untimed 429 + active testStatus is degraded (not healthy)", () => {
  assert.equal(stateOf(conn("glm", { errorCode: 429 })), "degraded");
});

test("classify: limit-class lastErrorType alone is degraded", () => {
  assert.equal(
    stateOf(conn("glm", { lastErrorType: "rate_limited", errorCode: null })),
    "degraded"
  );
});

test("classify: a fully clean row is healthy", () => {
  assert.equal(stateOf(conn("glm", { lastErrorType: null, errorCode: null })), "healthy");
});

test("classify: a success-cleared row recovers to healthy (limit error null, timer past)", () => {
  assert.equal(
    stateOf(
      conn("glm", {
        lastErrorType: null,
        errorCode: null,
        rateLimitedUntil: past(),
      })
    ),
    "healthy"
  );
});

test("classify: a recorded limit error survives an expired timer", () => {
  assert.equal(stateOf(conn("glm", { errorCode: 429, rateLimitedUntil: past() })), "degraded");
});

test("classify: terminal statuses are down, never degraded — even with a limit signal", () => {
  for (const status of ["credits_exhausted", "banned", "expired"]) {
    assert.equal(stateOf(conn("glm", { testStatus: status })), "down", status);
    assert.equal(
      stateOf(
        conn("glm", {
          testStatus: status,
          errorCode: 429,
          lastErrorType: "credits_exhausted",
        })
      ),
      "down",
      `${status} + limit signal must stay down`
    );
  }
});

test("classify: a live timer is degraded; terminal beats a live timer", () => {
  assert.equal(stateOf(conn("glm", { rateLimitedUntil: future() })), "degraded");
  assert.equal(stateOf(conn("glm", { testStatus: "banned", rateLimitedUntil: future() })), "down");
});

test("classify: an unknown lastErrorType stays healthy (no over-trigger)", () => {
  assert.equal(stateOf(conn("glm", { lastErrorType: "timeout", errorCode: null })), "healthy");
});

test("classify: errorCode 0 stays healthy; string '429' is degraded", () => {
  assert.equal(stateOf(conn("glm", { errorCode: 0 })), "healthy");
  assert.equal(stateOf(conn("glm", { errorCode: "429" })), "degraded");
});

// ─────────────────────────── isProviderUsable ───────────────────────────

test("usable: untimed 429 only → provider not usable", () => {
  assert.equal(isProviderUsable([conn("glm", { errorCode: 429 })], FIXED_NOW), false);
});

test("usable: limit-class lastErrorType only → not usable", () => {
  assert.equal(
    isProviderUsable(
      [conn("glm", { lastErrorType: "credits_exhausted", errorCode: null })],
      FIXED_NOW
    ),
    false
  );
});

test("usable: clean row → usable", () => {
  assert.equal(isProviderUsable([conn("glm")], FIXED_NOW), true);
});

test("usable: unknown lastErrorType → usable", () => {
  assert.equal(isProviderUsable([conn("glm", { lastErrorType: "timeout" })], FIXED_NOW), true);
});

test("usable: one limited + one clean → provider usable (aggregate rule)", () => {
  const conns = [
    conn("glm", { errorCode: 429 }),
    conn("glm", { testStatus: "active", lastErrorType: null, errorCode: null }),
  ];
  assert.equal(isProviderUsable(conns, FIXED_NOW), true);
});

// ───────────────── filterFreeProviderRankings({availableOnly}) ─────────────────

const RANKINGS = [ranking("glm"), ranking("groq")];

test("filter: availableOnly drops a provider limited only by an untimed 429", () => {
  const out = filterFreeProviderRankings(
    RANKINGS,
    [conn("glm", { errorCode: 429 })],
    { availableOnly: true },
    FIXED_NOW
  );
  assert.deepEqual(
    out.map((r) => r.id),
    []
  );
});

test("filter: availableOnly keeps a provider with one usable sibling", () => {
  const out = filterFreeProviderRankings(
    RANKINGS,
    [conn("glm", { errorCode: 429 }), conn("glm")],
    { availableOnly: true },
    FIXED_NOW
  );
  assert.deepEqual(
    out.map((r) => r.id),
    ["glm"]
  );
});

test("filter: availableOnly keeps a success-cleared provider", () => {
  const out = filterFreeProviderRankings(
    RANKINGS,
    [conn("glm", { lastErrorType: null, errorCode: null, rateLimitedUntil: past() })],
    { availableOnly: true },
    FIXED_NOW
  );
  assert.deepEqual(
    out.map((r) => r.id),
    ["glm"]
  );
});

test("filter: availableOnly drops a terminal provider", () => {
  const out = filterFreeProviderRankings(
    RANKINGS,
    [conn("glm", { testStatus: "banned" })],
    { availableOnly: true },
    FIXED_NOW
  );
  assert.deepEqual(
    out.map((r) => r.id),
    []
  );
});

// ───────────────────── per-connection granularity + aggregate ─────────────────

test("aggregate: one 429 + one clean exposes per-connection states and a degraded provider", () => {
  const out = attachProviderReliability(
    [ranking("alpha")],
    [
      conn("alpha", { errorCode: 429, lastErrorType: "rate_limited" }),
      conn("alpha", { testStatus: "active", lastErrorType: null, errorCode: null }),
    ],
    FIXED_NOW
  );
  const reliability = out[0].reliability;
  assert.ok(reliability);
  assert.deepEqual(
    reliability.connections.map((c) => c.state),
    ["degraded", "healthy"],
    "one state per connection, in order"
  );
  assert.equal(reliability.connections[0].lastErrorType, "rate_limited", "signal echoed raw");
  assert.equal(reliability.state, "degraded", "provider follows the existing aggregate rule");
});

test("aggregate: all connections down → provider down", () => {
  const out = attachProviderReliability(
    [ranking("alpha")],
    [conn("alpha", { testStatus: "banned" }), conn("alpha", { testStatus: "expired" })],
    FIXED_NOW
  );
  assert.equal(out[0].reliability?.state, "down");
});

test("aggregate: an unrelated unknown errorType keeps the provider healthy", () => {
  const out = attachProviderReliability(
    [ranking("alpha")],
    [conn("alpha", { lastErrorType: "server_error", errorCode: 503 })],
    FIXED_NOW
  );
  assert.equal(out[0].reliability?.state, "healthy");
  assert.equal(out[0].reliability?.connections[0].state, "healthy");
});
