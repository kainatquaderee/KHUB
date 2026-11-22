/**
 * AC4 — a provider-page connection row whose Cooldown Manager status is
 * `rate_limited`/`model_locked` must show a warning instead of "Connected", and
 * must reuse the already-translated `errorTypeRateLimited` label (design: reuse
 * `ERROR_TYPE_LABELS.upstream_rate_limited.labelKey`; no new i18n keys).
 *
 * The row's own `effectiveStatus` is still `active` for these accounts (their
 * last test succeeded), which is why the Cooldown Manager's verdict has to be
 * consulted before the "Connected" short-circuit.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { getStatusPresentation } =
  await import("../../src/app/(dashboard)/dashboard/providers/[id]/components/connectionRowStatus.ts");

function spyT() {
  const calls: string[] = [];
  const t = (key: string, values?: Record<string, unknown>) => {
    calls.push(key);
    return values ? `${key}:${JSON.stringify(values)}` : `[${key}]`;
  };
  return { t, calls };
}

test("AC4: a rate-limited row shows the Rate limited warning, not Connected", () => {
  const { t, calls } = spyT();
  const presentation = getStatusPresentation(
    { isActive: true, testStatus: "active", cooldownStatus: "rate_limited" },
    "active",
    false,
    t
  );
  assert.equal(presentation.statusVariant, "warning");
  assert.equal(presentation.statusLabel, "[errorTypeRateLimited]");
  assert.ok(calls.includes("errorTypeRateLimited"), "must reuse the existing translated key");
  assert.ok(!calls.includes("statusConnected"), "must not render the Connected label");
});

test("AC4: a model-locked row also shows the Rate limited warning", () => {
  const { t } = spyT();
  const presentation = getStatusPresentation(
    { isActive: true, testStatus: "active", cooldownStatus: "model_locked" },
    "active",
    false,
    t
  );
  assert.equal(presentation.statusVariant, "warning");
  assert.equal(presentation.statusLabel, "[errorTypeRateLimited]");
});

test("AC5: a healthy verdict still renders Connected", () => {
  const { t, calls } = spyT();
  const presentation = getStatusPresentation(
    { isActive: true, testStatus: "active", cooldownStatus: "healthy" },
    "active",
    false,
    t
  );
  assert.equal(presentation.statusVariant, "success");
  assert.equal(presentation.statusLabel, "[statusConnected]");
  assert.ok(!calls.includes("errorTypeRateLimited"));
});

test("AC5: an absent cooldownStatus still renders Connected (older payloads)", () => {
  const { t } = spyT();
  const presentation = getStatusPresentation(
    { isActive: true, testStatus: "active" },
    "active",
    false,
    t
  );
  assert.equal(presentation.statusVariant, "success");
  assert.equal(presentation.statusLabel, "[statusConnected]");
});

test("AC4: a disabled account still reads Disabled even when the verdict is rate_limited", () => {
  const { t } = spyT();
  const presentation = getStatusPresentation(
    { isActive: false, testStatus: "active", cooldownStatus: "rate_limited" },
    "active",
    false,
    t
  );
  assert.equal(presentation.statusLabel, "[statusDisabled]");
});
