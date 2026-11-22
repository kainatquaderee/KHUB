// The Cooldown Manager / usage surfaces must be able to show a provider-stated
// multi-day quota reset ("comes back on 25 Nov 2026 at 08:59 UTC") without
// degrading into "5831m 31s".
import test from "node:test";
import assert from "node:assert/strict";

const { formatRemaining } = await import("../../src/shared/utils/formatRemaining.ts");

test("formatRemaining keeps the seconds/minutes tiers unchanged", () => {
  assert.equal(formatRemaining(0), "0m 0s");
  assert.equal(formatRemaining(5_000), "0m 5s");
  assert.equal(formatRemaining(65_000), "1m 5s");
});

test("formatRemaining switches to hours above an hour", () => {
  assert.equal(formatRemaining(5_400_000), "1h 30m");
});

test("formatRemaining switches to days for a multi-day reset", () => {
  assert.equal(formatRemaining(97 * 3_600_000), "4d 1h");
  assert.equal(formatRemaining(24 * 3_600_000), "1d 0h");
});
