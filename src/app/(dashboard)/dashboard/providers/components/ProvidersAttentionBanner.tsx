"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import Icon from "@/shared/components/Icon";

export interface AttentionProviderSummary {
  id: string;
  name: string;
  healthy: number;
  total: number;
}

const MAX_LISTED = 5;

/**
 * Persistent roll-up banner on the providers list. Rendered only when at least
 * one provider is in alert; the individual providers also carry a badge, so the
 * banner never needs to enumerate everything.
 */
export default function ProvidersAttentionBanner({
  providers,
}: {
  providers: readonly AttentionProviderSummary[];
}) {
  const t = useTranslations("providers");
  if (providers.length === 0) return null;

  const listed = providers.slice(0, MAX_LISTED);
  const remaining = providers.length - listed.length;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
    >
      <Icon name="notification_important" size={18} className="mt-0.5 shrink-0 text-warning" />
      <div className="space-y-1">
        <p className="font-semibold text-text">
          {t("attention.listTitle", { count: providers.length })}
        </p>
        <p className="text-text-muted">{t("attention.listBody")}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-text-muted">
          {listed.map((provider) => (
            <Link
              key={provider.id}
              href={`/dashboard/providers/${provider.id}`}
              className="underline decoration-dotted underline-offset-2 hover:text-text"
            >
              {provider.name} ({provider.healthy}/{provider.total})
            </Link>
          ))}
          {remaining > 0 && <span>{t("attention.listMore", { count: remaining })}</span>}
        </p>
      </div>
    </div>
  );
}
