/**
 * Provider attention threshold — settings resolution and write validation.
 *
 * Default is 10. Missing/invalid stored values fall back to the default, a
 * manually-edited negative clamps to 0, and there is deliberately no upper
 * policy bound — only the representable-integer overflow guard.
 */
import test from "node:test";
import assert from "node:assert/strict";

const { resolveProviderAttentionThreshold } =
  await import("../../src/lib/resilience/attentionThresholdSettings.ts");
const { DEFAULT_PROVIDER_ATTENTION_THRESHOLD, MAX_PROVIDER_ATTENTION_THRESHOLD } =
  await import("../../src/shared/constants/providerAttention.ts");
const { updateSettingsSchema } = await import("../../src/shared/validation/settingsSchemas.ts");

test("missing or invalid values resolve to the default", () => {
  assert.equal(DEFAULT_PROVIDER_ATTENTION_THRESHOLD, 10);
  assert.equal(resolveProviderAttentionThreshold({}), 10);
  assert.equal(resolveProviderAttentionThreshold(null), 10);
  assert.equal(resolveProviderAttentionThreshold({ providerAttentionThreshold: "abc" }), 10);
  assert.equal(resolveProviderAttentionThreshold({ providerAttentionThreshold: NaN }), 10);
  assert.equal(resolveProviderAttentionThreshold({ providerAttentionThreshold: Infinity }), 10);
});

test("numeric strings and truncation are accepted", () => {
  assert.equal(resolveProviderAttentionThreshold({ providerAttentionThreshold: "10" }), 10);
  assert.equal(resolveProviderAttentionThreshold({ providerAttentionThreshold: 12.9 }), 12);
});

test("a negative stored value clamps to zero; the large bound is representable", () => {
  assert.equal(resolveProviderAttentionThreshold({ providerAttentionThreshold: -5 }), 0);
  assert.equal(
    resolveProviderAttentionThreshold({
      providerAttentionThreshold: MAX_PROVIDER_ATTENTION_THRESHOLD,
    }),
    MAX_PROVIDER_ATTENTION_THRESHOLD
  );
});

test("the settings schema accepts 0 and positive integers, rejects negatives", () => {
  assert.equal(updateSettingsSchema.safeParse({ providerAttentionThreshold: 0 }).success, true);
  assert.equal(updateSettingsSchema.safeParse({ providerAttentionThreshold: 10 }).success, true);
  assert.equal(updateSettingsSchema.safeParse({ providerAttentionThreshold: -1 }).success, false);
  assert.equal(updateSettingsSchema.safeParse({ providerAttentionThreshold: 1.5 }).success, false);
});
