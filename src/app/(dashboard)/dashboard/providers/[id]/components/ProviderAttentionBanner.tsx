"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import Icon from "@/shared/components/Icon";

/**
 * Persistent per-provider banner on the detail page. Hidden unless this provider
 * is in alert, so the page looks unchanged for healthy providers.
 */
export default function ProviderAttentionBanner({
  attentionNeeded,
  healthy,
  total,
  threshold,
}: {
  attentionNeeded: boolean;
  healthy: number;
  total: number;
  threshold: number;
}) {
  const t = useTranslations("providers");
  if (!attentionNeeded) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm"
    >
      <Icon name="notification_important" size={18} className="mt-0.5 shrink-0 text-warning" />
      <div className="space-y-1">
        <p className="font-semibold text-text">{t("attention.bannerTitle")}</p>
        <p className="text-text-muted">
          {t("attention.bannerBody", { healthy, total, threshold })}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/resilience/cooldowns"
            className="underline decoration-dotted underline-offset-2 hover:text-text"
          >
            {t("attention.viewProvider")}
          </Link>
          <Link
            href="/dashboard/settings?tab=resilience"
            className="underline decoration-dotted underline-offset-2 hover:text-text"
          >
            {t("attention.adjustThreshold")}
          </Link>
        </div>
      </div>
    </div>
  );
}
