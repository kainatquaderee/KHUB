"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import Badge from "@/shared/components/Badge";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import type { ConnectionState } from "@/types/resilience";
import { formatRemaining } from "@/shared/utils/formatRemaining";

interface ConnectionDetailProps {
  connection: ConnectionState | undefined; // undefined when connection deleted
  receivedAt: number; // client fetch receive time (immune to clock skew)
  onClose: () => void;
}

/** One label/value row of the detail panel. */
function DetailRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-sm">
      <dt className="text-text-muted">{label}:</dt>
      <dd className="min-w-0 break-all text-text-main">{children}</dd>
    </div>
  );
}

/** "<ISO time> · <from> (<reason>)" for the breaker's last close, like lastErrorAt's ISO time. */
function formatLastClose(
  breaker: ConnectionState["breaker"],
  never: string,
  t: DetailTranslator
): string | null {
  if (!breaker) return null;
  const lastClose = breaker.lastClose ?? null;
  if (!lastClose) return never;
  const at = Number.isFinite(lastClose.at) ? new Date(lastClose.at).toISOString() : never;
  return `${at} · ${breakerStateLabel(t, lastClose.from)} (${lastClose.reason ?? never})`;
}

type DetailTranslator = {
  (key: string): string;
  has: (key: string) => boolean;
};

/**
 * The breaker exposes raw `CircuitState` tokens (`CLOSED`/`DEGRADED`/`OPEN`/
 * `HALF_OPEN`); `resilienceConnections.timeline.state.*` already owns their
 * labels. Fall back to the raw token when a catalog lacks the key.
 */
function breakerStateLabel(t: DetailTranslator, state: string): string {
  const path = `timeline.state.${state.toLowerCase()}`;
  return t.has(path) ? t(path) : state;
}

/** Coarse failure kinds recorded by the breaker (see `classify429`). */
const FAILURE_KIND_KEYS: Record<string, string> = {
  rate_limit: "failureKind.rateLimit",
  quota_exhausted: "failureKind.quotaExhausted",
  transient: "failureKind.transient",
};

function failureKindLabel(t: DetailTranslator, kind: string): string {
  const key = FAILURE_KIND_KEYS[kind];
  return key && t.has(key) ? t(key) : kind;
}

export default function ConnectionDetail({
  connection,
  receivedAt,
  onClose,
}: ConnectionDetailProps) {
  const t = useTranslations("resilienceConnections");
  const [tick, setTick] = useState(0); // force re-render for live countdown
  useEffect(() => {
    if (!connection?.isCoolingDown) return;
    // Reset tick baseline when the connection changes so the countdown restarts from
    // the fresh cooldownRemainingMs. setTick(0) is a re-sync, not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTick(0);
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [connection?.isCoolingDown, connection?.id]);

  if (!connection) return null; // Guard: connection deleted while panel open
  const elapsedMs = tick * 1000;
  const adjustedCooldown = Math.max(0, connection.cooldownRemainingMs - elapsedMs);
  const breakerVariant = (state: string) =>
    state === "OPEN"
      ? "error"
      : state === "HALF_OPEN" || state === "DEGRADED"
        ? "warning"
        : "success";
  return (
    <Card
      title={t("detail.title")}
      action={
        <Button variant="outline" size="sm" icon="close" onClick={onClose}>
          {t("detail.close")}
        </Button>
      }
    >
      <dl className="flex flex-col gap-1">
        <DetailRow label={t("detail.provider")}>{connection.provider}</DetailRow>
        <DetailRow label={t("detail.id")}>{connection.id}</DetailRow>
        <DetailRow label={t("detail.authType")}>{connection.authType}</DetailRow>
        <DetailRow label={t("detail.priority")}>{connection.priority}</DetailRow>
        <DetailRow label={t("detail.isActive")}>
          {connection.isActive ? t("detail.yes") : t("detail.no")}
        </DetailRow>
        <DetailRow label={t("detail.errorCode")}>
          {connection.errorCode ?? t("detail.never")}
        </DetailRow>
        <DetailRow label={t("detail.lastErrorAt")}>
          {connection.lastErrorAt ?? t("detail.never")}
        </DetailRow>
      </dl>

      <h3 className="ci-heading mt-4 mb-2 border-t border-border pt-4 text-sm">
        {t("detail.cooldown")}
      </h3>
      <dl className="flex flex-col gap-1">
        <DetailRow label={t("detail.rateLimitedUntil")}>
          {connection.rateLimitedUntil ?? t("detail.never")}
        </DetailRow>
        <DetailRow label={t("detail.backoffLevel")}>{connection.backoffLevel}</DetailRow>
        <DetailRow label={t("detail.remaining")}>
          {connection.isCoolingDown ? formatRemaining(adjustedCooldown) : t("detail.never")}
        </DetailRow>
      </dl>

      <h3 className="ci-heading mt-4 mb-2 border-t border-border pt-4 text-sm">
        {t("detail.breaker")}
      </h3>
      {connection.breaker ? (
        <div className="flex flex-col gap-2">
          <div>
            <Badge variant={breakerVariant(connection.breaker.state)} size="sm">
              <span title={connection.breaker.state}>
                {breakerStateLabel(t, connection.breaker.state)}
              </span>
            </Badge>
          </div>
          <dl className="flex flex-col gap-1">
            <DetailRow label={t("detail.failureCount")}>
              {connection.breaker.failureCount}
            </DetailRow>
            <DetailRow label={t("detail.retryAfterMs")}>
              {connection.breaker.retryAfterMs}
            </DetailRow>
            <DetailRow label={t("detail.lastFailureKind")}>
              {connection.breaker.lastFailureKind ? (
                <span title={connection.breaker.lastFailureKind}>
                  {failureKindLabel(t, connection.breaker.lastFailureKind)}
                </span>
              ) : (
                t("detail.never")
              )}
            </DetailRow>
            <DetailRow label={t("detail.lastClose")}>
              {formatLastClose(connection.breaker, t("detail.never"), t)}
            </DetailRow>
          </dl>
        </div>
      ) : (
        <p className="text-sm text-text-muted">{t("detail.never")}</p>
      )}

      <h3 className="ci-heading mt-4 mb-2 border-t border-border pt-4 text-sm">
        {t("detail.lockouts")}
      </h3>
      {connection.lockouts.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {connection.lockouts.map((l, i) => (
            <li key={i}>
              {l.model}: {l.reason} ({formatRemaining(Math.max(0, l.remainingMs - elapsedMs))})
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">{t("detail.noLockouts")}</p>
      )}
    </Card>
  );
}
