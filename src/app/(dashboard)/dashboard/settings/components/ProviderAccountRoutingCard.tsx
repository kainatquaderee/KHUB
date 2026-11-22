"use client";

import { useCallback, useEffect, useState } from "react";
import { Input, Select } from "@/shared/components";
import { useTranslations } from "next-intl";
import { ACCOUNT_FALLBACK_STRATEGY_VALUES } from "@/shared/constants/routingStrategies";

type ProviderStrategyOverride = {
  fallbackStrategy?: string;
  stickyRoundRobinLimit?: number;
  planWeights?: Record<string, number>;
};

type Props = {
  providerKey: string;
  /** Total accounts on the provider. */
  connectionCount: number;
  /**
   * Accounts routing can use right now (enabled, not cooling, not exhausted).
   * Omit to hide the readout — the provider page passes it from the live
   * connection list via `countHealthyAccounts`.
   */
  healthyCount?: number;
};

const STRATEGY_OPTIONS = ACCOUNT_FALLBACK_STRATEGY_VALUES.filter((v) =>
  ["fill-first", "round-robin", "priority", "p2c", "random", "least-used", "expiry-first"].includes(
    v
  )
);

function clampProviderStickyLimit(raw: string): number {
  const val = parseInt(raw, 10);
  return Math.min(1000, Math.max(1, Number.isNaN(val) ? 3 : val));
}

async function fetchProviderOverride(
  providerKey: string
): Promise<{ override: ProviderStrategyOverride | undefined } | null> {
  const res = await fetch("/api/settings", { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  return {
    override: ((data?.providerStrategies || {}) as Record<string, ProviderStrategyOverride>)[
      providerKey
    ],
  };
}

/** Loads/saves the per-provider account-routing override. Extracted out of the
 * component body to keep ProviderAccountRoutingCard's own render function small. */
function useProviderAccountRoutingState(providerKey: string) {
  const [strategy, setStrategy] = useState<string>("");
  const [stickyLimit, setStickyLimit] = useState("3");
  const [busy, setBusy] = useState(false);

  const applyOverride = useCallback((override: ProviderStrategyOverride | undefined) => {
    setStrategy(override?.fallbackStrategy || "");
    setStickyLimit(
      override?.stickyRoundRobinLimit != null ? String(override.stickyRoundRobinLimit) : ""
    );
  }, []);

  const load = useCallback(async () => {
    const result = await fetchProviderOverride(providerKey);
    if (result) applyOverride(result.override);
  }, [applyOverride, providerKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchProviderOverride(providerKey);
      if (!cancelled && result) applyOverride(result.override);
    })().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [applyOverride, providerKey]);

  const save = useCallback(
    async (nextStrategy: string, nextSticky: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch current settings");
        const data = await res.json();
        const revision = typeof data.settingsRevision === "number" ? data.settingsRevision : 0;
        const current = (data?.providerStrategies || {}) as Record<
          string,
          ProviderStrategyOverride
        >;
        const override: ProviderStrategyOverride = {};
        if (nextStrategy) override.fallbackStrategy = nextStrategy;
        if (nextStrategy === "round-robin" && nextSticky !== "") {
          override.stickyRoundRobinLimit = clampProviderStickyLimit(nextSticky);
        }
        if (current[providerKey]?.planWeights)
          override.planWeights = current[providerKey].planWeights;
        const updated = { ...current };
        if (Object.keys(override).length === 0) delete updated[providerKey];
        else updated[providerKey] = override;
        const patchRes = await fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerStrategies: updated, expectedRevision: revision }),
        });
        if (patchRes.status === 409) {
          await load();
          throw new Error("Settings conflict — refreshed from server");
        }
        if (!patchRes.ok) throw new Error("Failed to save provider routing settings");
      } catch (e) {
        console.error(e);
      } finally {
        setBusy(false);
      }
    },
    [load, providerKey]
  );

  return { strategy, setStrategy, stickyLimit, setStickyLimit, busy, save };
}

export default function ProviderAccountRoutingCard({
  providerKey,
  connectionCount,
  healthyCount,
}: Props) {
  const t = useTranslations("settings");
  const { strategy, setStrategy, stickyLimit, setStickyLimit, busy, save } =
    useProviderAccountRoutingState(providerKey);

  if (connectionCount < 2) return null;

  // `healthy / total`: how many accounts routing can actually use right now —
  // not cooling off (no live `rateLimitedUntil`), not exhausted/banned, and not
  // carrying an unrecovered rate-limit/quota error.
  const healthy = typeof healthyCount === "number" ? healthyCount : null;
  const healthyTone =
    healthy === null
      ? ""
      : healthy >= connectionCount
        ? "border-success/30 bg-success/10 text-success"
        : healthy > 0
          ? "border-warning/30 bg-warning/10 text-warning"
          : "border-error/30 bg-error/10 text-error";
  const healthyHint =
    typeof t.has === "function" && t.has("providerAccountHealthyHint")
      ? t("providerAccountHealthyHint")
      : "Accounts routable now (enabled, not cooling, no unrecovered rate-limit/quota error) out of total accounts";

  return (
    <div className="mb-4 rounded-lg border border-border bg-bg-subtle p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{t("providerAccountRoutingTitle")}</p>
          <p className="text-xs text-text-muted">{t("providerAccountRoutingDesc")}</p>
        </div>
        {healthy !== null && (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${healthyTone}`}
            title={healthyHint}
            aria-label={healthyHint}
          >
            {healthy}
            <span className="opacity-60">/</span>
            {connectionCount}
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select
          compact
          label={t("providerRoutingStrategy")}
          disabled={busy}
          value={strategy}
          onChange={(e) => {
            const v = e.target.value;
            setStrategy(v);
            save(v, stickyLimit).catch(console.error);
          }}
          options={[
            { value: "", label: t("providerRoutingInheritGlobal") },
            ...STRATEGY_OPTIONS.map((opt) => ({ value: opt, label: opt })),
          ]}
        />
        {strategy === "round-robin" && (
          <Input
            label={t("stickyLimit")}
            type="number"
            min={1}
            max={1000}
            disabled={busy}
            value={stickyLimit || "3"}
            onChange={(e) => setStickyLimit(e.target.value)}
            onBlur={() => save(strategy, stickyLimit).catch(console.error)}
          />
        )}
      </div>
    </div>
  );
}
