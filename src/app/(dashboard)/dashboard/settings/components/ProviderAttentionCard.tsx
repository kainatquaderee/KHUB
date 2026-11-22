"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Field } from "@omniroute/ui-kit/field";
import { Button, Card, Input } from "@/shared/components";
import Icon from "@/shared/components/Icon";
import { Spinner } from "@/shared/components/Loading";
import { useNotificationStore } from "@/store/notificationStore";
import {
  DEFAULT_PROVIDER_ATTENTION_THRESHOLD,
  MAX_PROVIDER_ATTENTION_THRESHOLD,
} from "@/shared/constants/providerAttention";
import { resolveProviderAttentionThreshold } from "@/lib/resilience/attentionThresholdSettings";

/**
 * Single-number policy: how many healthy accounts a provider may have before the
 * dashboard raises an in-app "attention needed" warning. Mirrors ModelLockoutCard
 * for load/save/validation behaviour; there is deliberately no upper policy
 * bound — only the representable-integer overflow guard.
 */
export default function ProviderAttentionCard() {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const notify = useNotificationStore();

  const [value, setValue] = useState(DEFAULT_PROVIDER_ATTENTION_THRESHOLD);
  const [saved, setSaved] = useState(DEFAULT_PROVIDER_ATTENTION_THRESHOLD);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [input, setInput] = useState(String(DEFAULT_PROVIDER_ATTENTION_THRESHOLD));

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const res = await fetch("/api/settings", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!mounted) return;
        const resolved = resolveProviderAttentionThreshold(json);
        setValue(resolved);
        setSaved(resolved);
        setInput(String(resolved));
      } catch (error) {
        notify.error(error instanceof Error ? error.message : t("providerAttentionLoadFailed"));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [notify, t]);

  const hasChanges = value !== saved;

  const handleChange = (raw: string) => {
    setInput(raw);
    const parsed = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(parsed)) return;
    setValue(Math.trunc(parsed));
  };

  const handleSave = async () => {
    if (!Number.isFinite(value) || value < 0 || value > MAX_PROVIDER_ATTENTION_THRESHOLD) {
      notify.error(t("providerAttentionRangeError"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAttentionThreshold: value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        const issues = err?.error?.issues ?? err?.error?.details;
        if (Array.isArray(issues) && issues.length > 0) {
          const msg = issues
            .map((d: { message?: string }) => d.message)
            .filter(Boolean)
            .join("\n");
          if (msg) throw new Error(msg);
        }
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }
      const json = await res.json();
      const resolved = resolveProviderAttentionThreshold(json);
      setValue(resolved);
      setSaved(resolved);
      setInput(String(resolved));
      notify.success(t("providerAttentionSaved"));
    } catch (error) {
      notify.error(error instanceof Error ? error.message : t("providerAttentionSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div role="status" className="flex items-center gap-2 text-sm text-text-muted">
          <Spinner decorative size="sm" />
          {t("loading")}
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Icon name="notification_important" size={20} className="text-primary" />
            <h2 className="text-lg font-bold">{t("providerAttentionTitle")}</h2>
          </div>
          <p className="text-sm text-text-muted">{t("providerAttentionDescription")}</p>
        </div>
        {hasChanges ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setValue(saved);
                setInput(String(saved));
              }}
            >
              {tc("cancel")}
            </Button>
            <Button size="sm" variant="primary" icon="save" onClick={handleSave} disabled={saving}>
              {saving ? tc("saving") : tc("save")}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-bg-subtle p-4">
        <Field label={t("providerAttentionField")} hint={t("providerAttentionHint")}>
          <Input
            type="number"
            min={0}
            step={1}
            value={input}
            onChange={(event) => handleChange(event.target.value)}
            aria-label={t("providerAttentionField")}
            className="max-w-[12rem]"
          />
        </Field>
      </div>
    </Card>
  );
}
