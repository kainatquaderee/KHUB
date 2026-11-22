"use client";

import { useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { useNotificationStore } from "@/store/notificationStore";
import { applyAttentionTransitions, type AttentionState } from "@/lib/providers/attentionThreshold";

const STORAGE_KEY = "omniroute.providerAttention.v1";

/** Module-level mirror of the persisted baseline: the first line of defence against React strict-mode double-firing. */
const memoryBaseline = new Map<string, "alert" | "ok">();

function readBaseline(): AttentionState {
  const state: AttentionState = {};
  for (const [id, value] of memoryBaseline) state[id] = value;
  if (typeof window === "undefined") return state;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return state;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [id, value] of Object.entries(parsed)) {
      if (value === "alert" || value === "ok") state[id] = value;
    }
  } catch {
    // A corrupted or unavailable baseline only means a possible extra toast.
  }
  return state;
}

function writeBaseline(next: AttentionState): void {
  memoryBaseline.clear();
  for (const [id, value] of Object.entries(next)) memoryBaseline.set(id, value);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota/private-mode failures are non-fatal: the in-memory map still dedupes.
  }
}

export interface AttentionSubject {
  id: string;
  name: string;
  healthy: number;
  total: number;
  attentionNeeded: boolean;
}

/**
 * Fire one in-app toast when a provider *first* crosses into "attention needed".
 *
 * Mount exactly one instance per page (the providers list and the provider detail
 * page are separate routes, so at most one is mounted). Banners and badges never
 * toast — they receive `attentionNeeded` as data.
 */
export function useProviderAttention(
  subjects: readonly AttentionSubject[],
  threshold: number
): void {
  const t = useTranslations("providers");
  const addNotification = useNotificationStore((state) => state.addNotification);
  const fired = useRef<Set<string>>(new Set());

  const signature = useMemo(
    () =>
      subjects
        .map((s) => `${s.id}:${s.attentionNeeded ? 1 : 0}`)
        .sort()
        .join("|"),
    [subjects]
  );

  useEffect(() => {
    const current: Record<string, boolean> = {};
    for (const subject of subjects) current[subject.id] = subject.attentionNeeded;

    const { toasts, next } = applyAttentionTransitions(readBaseline(), current);
    // Persist before toasting so a strict-mode second pass sees `alert`.
    writeBaseline(next);

    const crossed = toasts.filter((id) => !fired.current.has(id));
    if (crossed.length === 0) return;
    for (const id of crossed) fired.current.add(id);

    const byId = new Map(subjects.map((subject) => [subject.id, subject]));
    if (crossed.length > 3) {
      addNotification({
        type: "warning",
        title: t("attention.toastTitle"),
        message: t("attention.toastSummary", { count: crossed.length }),
        duration: 10_000,
        dismissible: true,
      });
      return;
    }
    for (const id of crossed) {
      const subject = byId.get(id);
      if (!subject) continue;
      addNotification({
        type: "warning",
        title: t("attention.toastTitle"),
        message: t("attention.toastMessage", {
          provider: subject.name,
          healthy: subject.healthy,
          total: subject.total,
          threshold,
        }),
        duration: 10_000,
        dismissible: true,
      });
    }
    // `signature` is the trigger; the payload itself is read fresh on each run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}

/** Test seam: clear the in-memory + persisted baseline. */
export function resetProviderAttentionBaseline(): void {
  memoryBaseline.clear();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
