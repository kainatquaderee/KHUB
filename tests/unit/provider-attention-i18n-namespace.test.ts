/**
 * The `attention.*` keys must live in the `providers` namespace.
 *
 * Regression guard: the first cut of this feature added the keys under `settings`
 * while every consumer (provider card badge, list banner, detail banner, toast
 * hook) reads `useTranslations("providers")`. `check:ui-icu` compiles every
 * catalog and therefore cannot see that — the messages are valid ICU, they are
 * simply in the file no consumer reads. That shipped as raw-key fallbacks in the
 * UI, so the namespace is pinned here by reading the consumers' own source.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const catalogs = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/i18n/messages/en.json"), "utf8")
) as Record<string, Record<string, unknown>>;

/** Consumers that read `providers.attention.*` directly (no `t.has` fallback). */
const CONSUMERS = [
  "src/app/(dashboard)/dashboard/providers/components/ProviderCard.tsx",
  "src/app/(dashboard)/dashboard/providers/components/ProvidersAttentionBanner.tsx",
  "src/app/(dashboard)/dashboard/providers/[id]/components/ProviderAttentionBanner.tsx",
  "src/app/(dashboard)/dashboard/providers/hooks/useProviderAttention.ts",
];

const attention = (catalogs.providers?.attention ?? {}) as Record<string, string>;

test("providers.attention exists and is not in the settings namespace", () => {
  assert.ok(Object.keys(attention).length > 0, "providers.attention must exist");
  assert.equal(catalogs.settings?.attention, undefined, "attention must not live under settings");
});

test("every attention.* key a consumer references resolves in providers.attention", () => {
  const referenced = new Set<string>();
  for (const rel of CONSUMERS) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.match(
      source,
      /useTranslations\("providers"\)/,
      `${rel} must read the providers namespace`
    );
    for (const [, key] of source.matchAll(/"attention\.([A-Za-z0-9_]+)"/g)) referenced.add(key);
  }
  assert.ok(referenced.size >= 6, `expected several attention.* refs, saw ${referenced.size}`);
  for (const key of referenced) {
    assert.ok(
      typeof attention[key] === "string" && attention[key].length > 0,
      `providers.attention.${key} is missing or empty`
    );
  }
});

test("the settings-card keys live in the settings namespace", () => {
  for (const key of [
    "providerAttentionTitle",
    "providerAttentionDescription",
    "providerAttentionField",
    "providerAttentionSaved",
    "providerAttentionLoadFailed",
    "providerAttentionSaveFailed",
    "providerAttentionRangeError",
    "providerAttentionHint",
  ]) {
    assert.equal(typeof catalogs.settings?.[key], "string", `settings.${key} is missing`);
  }
});
