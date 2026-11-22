"use client";

import { useState, useEffect, useMemo, memo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Badge from "@/shared/components/Badge";
import DataTable from "@/shared/components/DataTable";
import type { DataTableColumn, DataTableRow } from "@/shared/components/DataTable";
import type { ConnectionState } from "@/types/resilience";
import {
  describeProviderAvailability,
  type ProviderAvailability,
} from "@/lib/providerAvailability";
import { formatRemaining } from "@/shared/utils/formatRemaining";
import ConnectionDetail from "./ConnectionDetail";

interface ConnectionsTableProps {
  connections: ConnectionState[];
  receivedAt: number; // client fetch receive time (immune to clock skew)
  degraded: string[]; // meta.degraded from API (to show "Unknown" when breaker data absent)
}

/** Translated labels for the API's coarse `errorCode` category (never a raw upstream code). */
const ERROR_CODE_LABELS: Record<string, string> = {
  rate_limit: "table.errorRateLimit",
  auth: "table.errorAuth",
  server: "table.errorServer",
  not_found: "table.errorNotFound",
  other: "table.errorOther",
};

type TableTranslator = {
  (key: string, values?: Record<string, string>): string;
  has: (key: string) => boolean;
};

/**
 * Localized one-line label for a `ProviderAvailability`. Keys live in the
 * `resilienceConnections.availability.*` block; when a catalog has not
 * translated the key yet we fall back to `describeProviderAvailability` (the
 * canonical English form, also used by the API).
 */
function availabilityLabel(t: TableTranslator, a: ProviderAvailability): string {
  let key: string | null = null;
  let values: Record<string, string> | undefined;
  switch (a.state) {
    case "AVAILABLE":
      key = "availability.available";
      break;
    case "NO_CREDENTIAL":
      key = "availability.noCredential";
      break;
    case "AUTH_EXPIRED":
      key = "availability.authExpired";
      break;
    case "QUOTA_EXHAUSTED":
      if (a.nextEligibleRecheckAt) {
        key = "availability.quotaExhaustedRecheck";
        values = { at: a.nextEligibleRecheckAt };
      } else {
        key = "availability.quotaExhausted";
      }
      break;
    case "DISABLED":
      key = "availability.disabled";
      break;
    case "STALE_TERMINAL":
      key = "availability.staleTerminal";
      values = { previousState: a.previousState };
      break;
    case "UNHEALTHY":
      key = a.retryable ? "availability.unhealthyRetryable" : "availability.unhealthy";
      break;
  }
  return key && t.has(key) ? t(key, values) : describeProviderAvailability(a);
}

// Module-scoped memoized countdown cell: hoisted to avoid remount on every poll
// (useMemo with receivedAt dependency would create new type each poll -> unmount/remount)
// Ponytail: elapsed derived from tick count (pure -- no Date.now() in render), self-corrects
// on each poll when receivedAt changes and the effect resets the tick baseline.
function StatusWithAvailability({
  badge,
  connection,
}: {
  badge: ReactNode;
  connection: ConnectionState;
}) {
  const t = useTranslations("resilienceConnections");
  return (
    <div className="flex flex-col gap-1">
      {badge}
      <span className="text-xs text-text-muted">
        {availabilityLabel(t, connection.availability)}
      </span>
    </div>
  );
}

const CountdownCell = memo(function CountdownCell({
  connection,
  receivedAt,
}: {
  connection: ConnectionState;
  receivedAt: number;
}) {
  const [tick, setTick] = useState(0); // force re-render for live countdown
  useEffect(() => {
    if (!connection.isCoolingDown) return;
    // Reset tick baseline when new data arrives so the countdown restarts from the
    // fresh cooldownRemainingMs. setTick(0) is a re-sync, not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTick(0);
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [connection.isCoolingDown, receivedAt]);
  if (!connection.isCoolingDown) return <span>-</span>;
  const elapsedMs = tick * 1000;
  return <span>{formatRemaining(Math.max(0, connection.cooldownRemainingMs - elapsedMs))}</span>;
});

export default function ConnectionsTable({
  connections,
  receivedAt,
  degraded,
}: ConnectionsTableProps) {
  const t = useTranslations("resilienceConnections");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Derive the effective selected id during render (closes detail when connection disappears)
  const effectiveSelectedId =
    selectedId && connections.some((c) => c.id === selectedId) ? selectedId : null;

  const columns: DataTableColumn[] = [
    { key: "status", label: t("table.status") },
    { key: "provider", label: t("table.provider") },
    { key: "id", label: t("table.connectionId") },
    { key: "authType", label: t("table.authType") },
    { key: "backoffLevel", label: t("table.backoffLevel") },
    { key: "cooldown", label: t("table.cooldown") },
    { key: "lastError", label: t("table.lastError") },
    { key: "lockouts", label: t("table.lockouts") },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={connections as unknown as DataTableRow[]}
        selectedId={effectiveSelectedId ?? undefined}
        onRowClick={(row) => setSelectedId(String(row.id))}
        renderCell={(row: DataTableRow, col: DataTableColumn) => {
          const r = row as unknown as ConnectionState;
          switch (col.key) {
            case "status": {
              let badge: ReactNode;
              switch (r.connectionStatus) {
                case "rate_limited":
                  badge = (
                    <Badge variant="error" size="sm">
                      {t("table.rateLimited")}
                    </Badge>
                  );
                  break;
                case "cooling_down":
                  badge = (
                    <Badge variant="warning" size="sm">
                      {t("table.coolingDown")}
                    </Badge>
                  );
                  break;
                case "circuit_open":
                  badge = (
                    <Badge variant="error" size="sm">
                      {t("table.circuitOpen")}
                    </Badge>
                  );
                  break;
                case "terminal":
                  badge = (
                    <Badge variant="error" size="sm">
                      {t("table.terminal")}
                    </Badge>
                  );
                  break;
                case "healthy":
                  // When breaker data is absent (degraded source), show "Unknown" not "Healthy"
                  if (degraded.includes("circuitBreaker") && !r.breaker) {
                    badge = (
                      <Badge variant="info" size="sm">
                        {t("table.unknown")}
                      </Badge>
                    );
                  } else if (r.breaker?.state === "HALF_OPEN") {
                    badge = (
                      <Badge variant="warning" size="sm">
                        {t("table.recovering")}
                      </Badge>
                    );
                  } else if (r.breaker?.state === "DEGRADED") {
                    badge = (
                      <Badge variant="warning" size="sm">
                        {t("table.degraded")}
                      </Badge>
                    );
                  } else {
                    badge = (
                      <Badge variant="success" size="sm">
                        {t("table.healthy")}
                      </Badge>
                    );
                  }
                  break;
                default:
                  // A status this build does not know yet must still read as a
                  // translated label, never as a raw machine string.
                  badge = (
                    <Badge variant="info" size="sm">
                      {t("table.unknown")}
                    </Badge>
                  );
              }
              return <StatusWithAvailability badge={badge} connection={r} />;
            }
            case "id":
              return <span>{r.id.length > 8 ? `${r.id.slice(0, 8)}...` : r.id}</span>;
            case "cooldown":
              // memoized: isolates the 1s tick to a single cell
              return <CountdownCell connection={r} receivedAt={receivedAt} />;
            case "lastError":
              // `errorCode` is already a coarse category (rate_limit/auth/...), never
              // the raw upstream code; `lastErrorType` is a machine string, so it is
              // never rendered as-is.
              return (
                <span>
                  {r.errorCode
                    ? t(ERROR_CODE_LABELS[r.errorCode] ?? "table.errorOther")
                    : r.lastErrorType
                      ? t("table.unknown")
                      : t("table.never")}
                </span>
              );
            case "lockouts":
              return <span>{r.lockouts.length}</span>;
            case "provider":
              return <span>{r.provider}</span>;
            case "authType":
              return <span>{r.authType}</span>;
            case "backoffLevel":
              return <span>{r.backoffLevel}</span>;
            default:
              return null;
          }
        }}
      />
      {effectiveSelectedId && (
        <ConnectionDetail
          connection={connections.find((c) => c.id === effectiveSelectedId) ?? undefined}
          receivedAt={receivedAt}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}
