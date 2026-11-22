"use client";

// Per-provider "custom usage link". Stored in resilience settings as
// `providerQuotaEndpoints[providerId]` and read by
// open-sse/config/providerQuotaEndpoints.ts::getProviderQuotaEndpoint as a
// fallback when a connection declares no `providerSpecificData.quotaEndpoint` of
// its own. "Enabled" == an entry is present for this provider id.

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { providerText } from "../providerPageHelpers";

export type ProviderQuotaEndpointEntry = Record<string, unknown> & { url?: string };
export type ProviderQuotaEndpoints = Record<string, ProviderQuotaEndpointEntry>;

/** Shape returned by POST /api/resilience/usage-link/test. */
export interface UsageLinkTestResult {
  ok?: boolean;
  status?: number;
  /** Whether the probe could attach one of the provider's own credentials. */
  authenticated?: boolean;
  blocked?: boolean;
  contentType?: string | null;
  preview?: string;
  error?: string;
}

/**
 * Returns the full `providerQuotaEndpoints` map to PATCH (the route replaces the
 * whole map), setting `url` for `providerId` when a non-empty value is given and
 * removing the provider's entry otherwise. Every other provider and every other
 * field on this provider's entry is preserved.
 */
export function computeUsageLinkEndpoints(
  current: ProviderQuotaEndpoints | null | undefined,
  providerId: string,
  url: string | null
): ProviderQuotaEndpoints {
  const next: ProviderQuotaEndpoints = { ...(current || {}) };
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (!trimmed) {
    delete next[providerId];
    return next;
  }
  next[providerId] = { ...(next[providerId] || {}), url: trimmed };
  return next;
}

function patchErrorMessage(data: unknown, fallback: string): string {
  const error = (data as { error?: unknown } | null)?.error;
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === "string" && message) return message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

/** Loads `providerQuotaEndpoints` once and PATCHes the whole map on save (rolls back on failure). */
function useProviderQuotaEndpoints(providerId: string) {
  const t = useTranslations("providers");
  const notify = useNotificationStore();
  const [endpoints, setEndpoints] = useState<ProviderQuotaEndpoints>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/resilience", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && data?.providerQuotaEndpoints) {
          setEndpoints(data.providerQuotaEndpoints as ProviderQuotaEndpoints);
        }
      } catch (error) {
        console.error("Failed to load resilience settings:", error);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = useCallback(
    async (url: string | null) => {
      const previous = endpoints;
      const failedText = providerText(
        t,
        "usageLinkUpdateFailed",
        "Failed to update custom usage link"
      );
      const next = computeUsageLinkEndpoints(previous, providerId, url);
      setEndpoints(next);
      setSaving(true);
      try {
        const response = await fetch("/api/resilience", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerQuotaEndpoints: next }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(patchErrorMessage(data, failedText));
        if (data?.providerQuotaEndpoints) {
          setEndpoints(data.providerQuotaEndpoints as ProviderQuotaEndpoints);
        }
        notify.success(providerText(t, "usageLinkSaved", "Custom usage link saved"));
      } catch (error) {
        setEndpoints(previous);
        notify.error(error instanceof Error ? error.message : failedText);
      } finally {
        setSaving(false);
      }
    },
    [endpoints, notify, providerId, t]
  );

  return { endpoints, loaded, saving, handleSave };
}

function isValidUsageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

interface ProviderUsageLinkCardProps {
  providerId: string;
}

export default function ProviderUsageLinkCard({ providerId }: ProviderUsageLinkCardProps) {
  const t = useTranslations("providers");
  const { endpoints, loaded, saving, handleSave } = useProviderQuotaEndpoints(providerId);

  const storedUrl = endpoints[providerId]?.url ?? "";
  const storedEnabled = typeof endpoints[providerId]?.url === "string" && storedUrl.length > 0;

  // Local edits overlay the loaded value: `null` means "show what is stored".
  const [draft, setDraft] = useState<{ enabled: boolean; url: string } | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<UsageLinkTestResult | null>(null);

  const enabled = draft?.enabled ?? storedEnabled;
  const urlValue = draft?.url ?? storedUrl;

  const title = providerText(t, "usageLinkTitle", "Custom usage link");

  const submit = useCallback(() => {
    if (!isValidUsageUrl(urlValue)) {
      setDraftError(providerText(t, "usageLinkInvalidUrl", "Enter a full http(s) URL"));
      return;
    }
    setDraftError(null);
    void handleSave(urlValue);
  }, [handleSave, t, urlValue]);

  const runTest = useCallback(async () => {
    if (!isValidUsageUrl(urlValue)) {
      setDraftError(providerText(t, "usageLinkInvalidUrl", "Enter a full http(s) URL"));
      return;
    }
    setDraftError(null);
    setTesting(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/resilience/usage-link/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlValue, providerId }),
      });
      const data = (await response.json().catch(() => ({}))) as UsageLinkTestResult;
      setTestResult(data);
    } catch {
      setTestResult({ ok: false, error: providerText(t, "usageLinkTestFailed", "Test failed") });
    } finally {
      setTesting(false);
    }
  }, [providerId, t, urlValue]);

  const onToggle = useCallback(
    (next: boolean) => {
      setDraftError(null);
      setDraft({ enabled: next, url: urlValue });
      // Turning off removes the entry entirely, which is what disables the link.
      if (!next && storedEnabled) void handleSave(null);
    },
    [handleSave, storedEnabled, urlValue]
  );

  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="inline-flex shrink-0 items-center justify-center w-10 h-10 rounded-full bg-info/10 text-info">
          <ChartIcon />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm">{title}</h2>
          <p className="text-sm text-text-muted">
            {providerText(
              t,
              "usageLinkDesc",
              "Read this provider's remaining quota from an endpoint of your own. A connection can still override it with its own quota endpoint."
            )}
          </p>
        </div>
        <Toggle
          checked={enabled}
          ariaLabel={title}
          disabled={!loaded || saving}
          onChange={onToggle}
        />
      </div>
      {enabled ? (
        <div className="mt-3 flex items-center gap-2">
          <input
            type="url"
            value={urlValue}
            placeholder={providerText(t, "usageLinkPlaceholder", "https://example.com/api/quota")}
            disabled={!loaded || saving}
            onChange={(event) => {
              setTestResult(null);
              setDraft({ enabled: true, url: event.target.value });
            }}
            className="flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={!loaded || testing}
            onClick={() => void runTest()}
            className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-50"
          >
            {testing
              ? providerText(t, "usageLinkTesting", "Testing…")
              : providerText(t, "usageLinkTest", "Test")}
          </button>
          <button
            type="button"
            disabled={!loaded || saving}
            onClick={submit}
            className="rounded-md border border-border px-3 py-1 text-sm disabled:opacity-50"
          >
            {providerText(t, "usageLinkSave", "Save")}
          </button>
        </div>
      ) : null}
      {enabled && draftError ? <p className="mt-1 text-xs text-danger">{draftError}</p> : null}
      {enabled && testResult ? (
        <p className={`mt-1 text-xs ${testResult.ok ? "text-success" : "text-danger"}`}>
          {testResult.ok
            ? providerText(t, "usageLinkTestOk", "Link works — the endpoint answered.")
            : testResult.blocked
              ? (testResult.error ??
                providerText(t, "usageLinkTestBlocked", "Blocked by outbound URL policy"))
              : testResult.status
                ? `HTTP ${testResult.status} — ${
                    testResult.authenticated === false
                      ? providerText(
                          t,
                          "usageLinkTestNoCredential",
                          "no provider credential was available to send"
                        )
                      : providerText(
                          t,
                          "usageLinkTestRejected",
                          "the endpoint rejected the request"
                        )
                  }`
                : (testResult.error ?? providerText(t, "usageLinkTestFailed", "Link unreachable"))}
        </p>
      ) : null}
      {enabled && testResult?.ok && testResult.preview ? (
        <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border/50 bg-surface-2 p-2 text-[11px] text-text-muted">
          {testResult.preview}
        </pre>
      ) : null}
    </Card>
  );
}

function ChartIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 16l3.5-5 3 3L20 7" />
    </svg>
  );
}
