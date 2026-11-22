/**
 * WP4 guard: the localized status enums must live in the namespace their
 * consumer actually reads.
 *
 * Regression guard, same failure mode as `provider-attention-i18n-namespace`:
 * `check:ui-icu` compiles every catalog, so it happily accepts a key that no
 * consumer reads. A status badge that renders `t("modelStatus.degraded")` from
 * a component that declares `useTranslations("analytics")` compiles fine and
 * still ships the raw key to the UI. The namespace is therefore pinned by
 * reading each consumer's own `useTranslations(...)` call.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const catalogs = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/i18n/messages/en.json"), "utf8")
) as Record<string, Record<string, unknown>>;

/** namespace -> consumer file -> the key paths that must resolve there. */
const CASES: Array<{
  file: string;
  namespace: string;
  keys: string[];
}> = [
  {
    file: "src/app/(dashboard)/dashboard/health/ProviderHealthMatrixCard.tsx",
    namespace: "health",
    keys: [
      "healthy",
      "degraded",
      "down",
      "modelStatus.healthy",
      "modelStatus.degraded",
      "modelStatus.error",
      "modelStatus.locked",
      "modelStatus.idle",
      "circuitBreaker.open",
      "circuitBreaker.halfOpen",
      "circuitBreaker.closed",
      "circuitBreaker.unknown",
    ],
  },
  {
    file: "src/app/(dashboard)/dashboard/analytics/ComboHealthTab.tsx",
    namespace: "analytics",
    keys: [
      "comboHealthStatus.healthy",
      "comboHealthStatus.warning",
      "comboHealthStatus.critical",
      "comboHealthSeverity.info",
      "comboHealthSeverity.warning",
      "comboHealthSeverity.critical",
      "comboHealthIssueCombo",
    ],
  },
  {
    file: "src/app/(dashboard)/dashboard/resilience/connections/components/ConnectionDetail.tsx",
    namespace: "resilienceConnections",
    keys: [
      "timeline.state.open",
      "timeline.state.half_open",
      "timeline.state.closed",
      "timeline.state.degraded",
      "failureKind.rateLimit",
      "failureKind.quotaExhausted",
      "failureKind.transient",
    ],
  },
  {
    file: "src/app/(dashboard)/dashboard/resilience/connections/components/ConnectionsTable.tsx",
    namespace: "resilienceConnections",
    keys: [
      "availability.available",
      "availability.noCredential",
      "availability.authExpired",
      "availability.quotaExhausted",
      "availability.quotaExhaustedRecheck",
      "availability.disabled",
      "availability.staleTerminal",
      "availability.unhealthy",
      "availability.unhealthyRetryable",
    ],
  },
];

function readAt<S>(root: Record<string, unknown>, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[part];
    return undefined;
  }, root);
}

for (const { file, namespace, keys } of CASES) {
  test(`${file} reads namespace "${namespace}" and every key resolves`, () => {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(
      source,
      new RegExp(`useTranslations\\("${namespace}"\\)`),
      `${file} must declare useTranslations("${namespace}")`
    );

    const root = catalogs[namespace];
    assert.ok(root, `${namespace} namespace is missing`);
    for (const key of keys) {
      const value = readAt(root, key);
      assert.ok(
        typeof value === "string" && value.length > 0,
        `${namespace}.${key} is missing or empty`
      );
    }
  });
}
