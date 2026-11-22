"use client";

import { useEffect, useState } from "react";
import { resolveProviderAttentionThreshold } from "@/lib/resilience/attentionThresholdSettings";
import { DEFAULT_PROVIDER_ATTENTION_THRESHOLD } from "@/shared/constants/providerAttention";

let cached: Promise<number> | null = null;

/**
 * Resolve the operator's attention threshold from the settings API.
 *
 * The providers list page already receives settings with its page payload, so it
 * never needs this hook; the detail page uses it. The request is module-cached so
 * several settings consumers on one page share a single `GET /api/settings`.
 */
export function useProviderAttentionThreshold(): number {
  const [threshold, setThreshold] = useState(DEFAULT_PROVIDER_ATTENTION_THRESHOLD);

  useEffect(() => {
    let mounted = true;
    if (!cached) {
      cached = fetch("/api/settings", { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return resolveProviderAttentionThreshold(await res.json());
        })
        .catch(() => {
          // A failed read keeps the default; the warning still works.
          cached = null;
          return DEFAULT_PROVIDER_ATTENTION_THRESHOLD;
        });
    }
    void cached.then((value) => {
      if (mounted) setThreshold(value);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return threshold;
}

/** Test seam: forget the cached settings read. */
export function resetProviderAttentionThresholdCache(): void {
  cached = null;
}
