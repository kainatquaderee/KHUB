// Token Harbor free-allowance 429s state an absolute reset in prose while the same
// response also carries a generic `Retry-After: 3600`:
//
//   "Your free allowance for ':free' models is used up. It comes back on
//    23 Nov 2026 at 06:05 UTC. Your account is not limited: remove ':free' ..."
//   "You've used this period's free allowance. Your next rolling 7-day period
//    starts on 25 Nov 2026 at 08:59 UTC. Use the paid model 'mimo-v2.5' ..."
//
// Before this shape was parsed, the model was parked for one hour and re-probed
// into the identical wall every hour until the real reset days later.
import test from "node:test";
import assert from "node:assert/strict";
import type { ProviderProfile } from "../../open-sse/services/accountFallback.ts";

const {
  checkFallbackError,
  recordModelLockoutFailure,
  retryHintBypassesMaxCooldownMs,
  parseRetryFromErrorText,
} = await import("../../open-sse/services/accountFallback.ts");
const { parseProseAbsoluteDateResetMs } =
  await import("../../open-sse/services/quotaResetParsing.ts");

const MSG_COMES_BACK =
  "[429]: Your free allowance for ':free' models is used up. It comes back on 23 Nov 2026 at 06:05 UTC. Your account is not limited: remove ':free' from the model name (use 'deepseek-v4.1-flash') to run this request on your plan or balance.";
const MSG_ROLLING_7D =
  "[429]: You've used this period's free allowance. Your next rolling 7-day period starts on 25 Nov 2026 at 08:59 UTC. Use the paid model 'mimo-v2.5' to keep going, or subscribe to a Token Harbor Pass.";

const MAX_COOLDOWN_MS = 3_600_000; // operator's Model Lockout "Max Cooldown (ms)"
const HOUR_MS = 3_600_000;

/** Build a full ProviderProfile from partial overrides (mirrors account-fallback-service.test.ts). */
function makeProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    baseCooldownMs: 60_000,
    useUpstreamRetryHints: true,
    maxBackoffSteps: 10,
    failureThreshold: 60,
    resetTimeoutMs: 5_000,
    transientCooldown: 60_000,
    rateLimitCooldown: 60_000,
    maxBackoffLevel: 10,
    maxCooldownMs: MAX_COOLDOWN_MS,
    ...overrides,
  } as ProviderProfile;
}

const utcMs = (y: number, m: number, d: number, h: number, min: number) =>
  Date.UTC(y, m - 1, d, h, min, 0);

test("parseProseAbsoluteDateResetMs reads 'comes back on <D> <Mon> <YYYY> at <HH>:<MM> UTC'", () => {
  const now = Date.now();
  const waitMs = parseProseAbsoluteDateResetMs(
    MSG_COMES_BACK,
    Number.MAX_SAFE_INTEGER,
    now,
    "tokenharbor"
  );
  assert.ok(waitMs !== null, "expected a parsed wait, got null");
  const expected = utcMs(2026, 11, 23, 6, 5) - now;
  assert.ok(
    Math.abs((waitMs as number) - expected) < 2_000,
    `expected ~${expected}ms, got ${waitMs}`
  );
});

test("parseProseAbsoluteDateResetMs reads '... period starts on <D> <Mon> <YYYY> at <HH>:<MM> UTC'", () => {
  const now = Date.now();
  const waitMs = parseProseAbsoluteDateResetMs(
    MSG_ROLLING_7D,
    Number.MAX_SAFE_INTEGER,
    now,
    "tokenharbor"
  );
  assert.ok(waitMs !== null, "expected a parsed wait, got null");
  const expected = utcMs(2026, 11, 25, 8, 59) - now;
  assert.ok(
    Math.abs((waitMs as number) - expected) < 2_000,
    `expected ~${expected}ms, got ${waitMs}`
  );
});

test("parseProseAbsoluteDateResetMs ignores a stated instant that already passed", () => {
  const now = utcMs(2026, 11, 21, 12, 0);
  assert.equal(
    parseProseAbsoluteDateResetMs(
      "It comes back on 1 Nov 2026 at 06:05 UTC.",
      Number.MAX_SAFE_INTEGER,
      now
    ),
    null
  );
});

test("parseProseAbsoluteDateResetMs honors a UTC offset and the maxMs cap", () => {
  const now = utcMs(2026, 11, 21, 12, 0);
  // 16:00+02:00 == 14:00Z, so two hours after `now`.
  const waitMs = parseProseAbsoluteDateResetMs(
    "The period starts on 21 Nov 2026 at 16:00 +02:00.",
    Number.MAX_SAFE_INTEGER,
    now
  );
  assert.ok(waitMs !== null);
  assert.ok(Math.abs((waitMs as number) - 2 * HOUR_MS) < 2_000, `got ${waitMs}`);

  assert.equal(
    parseProseAbsoluteDateResetMs("The period starts on 21 Nov 2026 at 18:00 UTC.", HOUR_MS, now),
    HOUR_MS
  );
});

test("parseRetryFromErrorText picks up the prose reset with no other hint shape", () => {
  const waitMs = parseRetryFromErrorText(MSG_ROLLING_7D, "tokenharbor");
  assert.ok(waitMs !== null);
  assert.ok((waitMs as number) > 24 * HOUR_MS, `expected a multi-day wait, got ${waitMs}`);
});

test("a stated calendar instant bypasses maxCooldownMs, a vague prose duration does not", () => {
  assert.equal(retryHintBypassesMaxCooldownMs("body_absolute"), true);
  assert.equal(retryHintBypassesMaxCooldownMs("body"), false);
});

for (const [label, msg, expectedUtc] of [
  ["comes back on 23 Nov 2026 at 06:05 UTC", MSG_COMES_BACK, utcMs(2026, 11, 23, 6, 5)],
  [
    "rolling 7-day period starts on 25 Nov 2026 at 08:59 UTC",
    MSG_ROLLING_7D,
    utcMs(2026, 11, 25, 8, 59),
  ],
] as const) {
  test(`model lockout waits for the stated reset, not the generic Retry-After:3600 (${label})`, () => {
    const fallback = checkFallbackError(
      429,
      msg,
      0,
      "deepseek-v4.1-flash:free",
      "tokenharbor",
      new Headers({ "retry-after": "3600" }),
      makeProfile()
    );
    assert.ok(fallback, "expected a fallback classification");
    assert.equal(fallback.usedUpstreamRetryHint, true);
    assert.equal(fallback.retryHintSource, "body_absolute");

    const lockout = recordModelLockoutFailure(
      "tokenharbor",
      "conn-lockout-test",
      "deepseek-v4.1-flash:free",
      fallback.reason,
      429,
      fallback.baseCooldownMs ?? 0,
      makeProfile(),
      {
        exactCooldownMs: fallback.cooldownMs,
        maxCooldownMs: MAX_COOLDOWN_MS,
        exactCooldownIsUpstreamReset: retryHintBypassesMaxCooldownMs(fallback.retryHintSource),
      }
    );

    const expected = expectedUtc - Date.now();
    assert.ok(
      Math.abs(lockout.cooldownMs - expected) < 2_000,
      `expected the lockout to wait ~${expected}ms for the stated reset, got ${lockout.cooldownMs}`
    );
    assert.ok(
      lockout.cooldownMs > MAX_COOLDOWN_MS,
      "a stated reset must not be clamped to the operator's Max Cooldown (1h)"
    );
  });
}

test("a vague prose duration stays operator-capped at Max Cooldown", () => {
  const fallback = checkFallbackError(
    429,
    "[429]: Too many requests. Please resets after 48h before retrying.",
    0,
    "deepseek-v4.1-flash:free",
    "tokenharbor",
    null,
    makeProfile()
  );
  assert.ok(fallback, "expected a fallback classification");
  assert.equal(fallback.retryHintSource, "body");

  const lockout = recordModelLockoutFailure(
    "tokenharbor",
    "conn-lockout-test-2",
    "deepseek-v4.1-flash:free",
    fallback.reason,
    429,
    fallback.baseCooldownMs ?? 0,
    makeProfile(),
    {
      exactCooldownMs: fallback.cooldownMs,
      maxCooldownMs: MAX_COOLDOWN_MS,
      exactCooldownIsUpstreamReset: retryHintBypassesMaxCooldownMs(fallback.retryHintSource),
    }
  );
  assert.equal(lockout.cooldownMs, MAX_COOLDOWN_MS);
});
