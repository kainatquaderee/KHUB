/**
 * AC-12/AC-17 — every cooldown reader shares one canonical timestamp parser.
 *
 * The persisted shape may be ISO UTC (current writer), numeric epoch ms, or the
 * SQLite REAL→TEXT form (`...110.0`) written by older processes. Invalid and
 * out-of-range values must be rejected rather than becoming a live cooldown.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  cooldownUntilMs,
  isRepresentableEpochMs,
  parseCooldownUntilMs,
} from "../../src/lib/resilience/persistedResilienceCodec.ts";

const DEADLINE = Date.UTC(2026, 10, 27, 6, 1, 14, 810);

test("canonical parser accepts ISO, numeric, REAL→TEXT and Date inputs", () => {
  const iso = new Date(DEADLINE).toISOString();
  assert.equal(parseCooldownUntilMs(iso), DEADLINE);
  assert.equal(parseCooldownUntilMs(String(DEADLINE)), DEADLINE);
  assert.equal(parseCooldownUntilMs(`${DEADLINE}.0`), DEADLINE);
  assert.equal(parseCooldownUntilMs(DEADLINE), DEADLINE);
  assert.equal(parseCooldownUntilMs(new Date(DEADLINE)), DEADLINE);
  assert.equal(parseCooldownUntilMs(`  ${iso}  `), DEADLINE);
});

test("canonical parser rejects absent, malformed and unrepresentable values", () => {
  for (const value of [null, undefined, "", "   ", "not-a-date", Number.NaN, Infinity]) {
    assert.equal(parseCooldownUntilMs(value), null, `unexpectedly parsed ${String(value)}`);
  }
  assert.equal(parseCooldownUntilMs(8.64e15 + 1), null, "beyond JS Date range");
  assert.equal(parseCooldownUntilMs("9007199254740993"), null);
  assert.equal(isRepresentableEpochMs(DEADLINE), true);
  assert.equal(isRepresentableEpochMs("1795759274810"), false);
});

test("legacy accountFallback wrapper keeps NaN for invalid values", () => {
  assert.equal(cooldownUntilMs(`${DEADLINE}.0`), DEADLINE);
  assert.ok(Number.isNaN(cooldownUntilMs("garbage")));
  assert.ok(Number.isNaN(cooldownUntilMs(null)));
});
