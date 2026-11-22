// The operator's Max Cooldown must not be capped at 1h. Two independent paths
// need multi-day waits: a provider-stated reset (`body_absolute`, e.g. Token
// Harbor's "comes back on 23 Nov 2026 at 06:05 UTC") and the plain exponential
// backoff ladder when the body says nothing usable.
import test from "node:test";
import assert from "node:assert/strict";
import type { ProviderProfile } from "../../open-sse/services/accountFallback.ts";

const { resolveModelLockoutSettings } =
  await import("../../src/lib/resilience/modelLockoutSettings.ts");
const { recordModelLockoutFailure } = await import("../../open-sse/services/accountFallback.ts");

const WEEK_MS = 604_800_000;
const DATE_RANGE_MS = 8_640_000_000_000;

function makeProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    baseCooldownMs: 600_000,
    useUpstreamRetryHints: true,
    maxBackoffSteps: 10,
    failureThreshold: 60,
    resetTimeoutMs: 5_000,
    transientCooldown: 60_000,
    rateLimitCooldown: 60_000,
    maxBackoffLevel: 10,
    maxCooldownMs: WEEK_MS,
    ...overrides,
  } as ProviderProfile;
}

test("a week-long Max Cooldown survives the settings resolver (no 1h clamp)", () => {
  const settings = resolveModelLockoutSettings({
    modelLockout: { baseCooldownMs: 600_000, maxCooldownMs: WEEK_MS },
  });
  assert.equal(settings.maxCooldownMs, WEEK_MS);
  assert.equal(settings.baseCooldownMs, 600_000);
});

test("the resolver keeps a typo out of Date's overflow range", () => {
  const settings = resolveModelLockoutSettings({ modelLockout: { maxCooldownMs: 1e18 } });
  assert.ok(Number.isFinite(settings.maxCooldownMs));
  assert.ok(
    settings.maxCooldownMs <= DATE_RANGE_MS,
    `expected <= ${DATE_RANGE_MS}, got ${settings.maxCooldownMs}`
  );
});

test("the settings API schema accepts a week and rejects only Date-overflow", async () => {
  const { updateSettingsSchema } = await import("../../src/shared/validation/settingsSchemas.ts");
  const week = updateSettingsSchema.safeParse({ modelLockout: { maxCooldownMs: WEEK_MS } });
  assert.equal(week.success, true, "a 7-day Max Cooldown must survive the save schema");
  const overflow = updateSettingsSchema.safeParse({ modelLockout: { maxCooldownMs: 1e18 } });
  assert.equal(overflow.success, false, "an unrepresentable duration must be rejected");
});

test("with the cap raised, the plain backoff ladder reaches a week", () => {
  const profile = makeProfile();
  let last = 0;
  for (let attempt = 1; attempt <= 12; attempt++) {
    last = recordModelLockoutFailure(
      "tokenharbor",
      "conn-weekly-ladder",
      "deepseek-v4.1-flash:free",
      "rate_limited",
      429,
      600_000,
      profile,
      { maxCooldownMs: WEEK_MS }
    ).cooldownMs;
  }
  assert.ok(last > WEEK_MS / 2, `expected a multi-day ladder, got ${last}ms`);
  assert.ok(last <= WEEK_MS, `expected the week cap to hold, got ${last}ms`);
});
