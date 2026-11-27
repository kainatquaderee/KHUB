/**
 * DB-free injectable seam between in-memory model lockout maps and SQLite.
 * No adapter is installed by default, so existing pure callers stay DB-free.
 * Every adapter call is best-effort: chat/SSE never observes a persistence error.
 */

import { logger } from "@/shared/utils/logger";
import {
  sanitizeReasonCode,
  type PersistedModelResilienceRow,
} from "@/lib/resilience/persistedResilienceCodec";
import { parseModelLockKey } from "./exactModelLock.ts";
import type { ModelFailureState, ModelLockoutEntry } from "../accountFallback.ts";

export interface ModelLockoutPersistenceAdapter {
  upsert(row: PersistedModelResilienceRow): void;
  deleteKeys(keys: string[]): void;
  clearAll(): void;
  markLockCleared(stateKey: string, nowMs: number): void;
}

const log = logger.child({ module: "model-lockout-persistence" });
let adapter: ModelLockoutPersistenceAdapter | null = null;

export function setModelLockoutPersistenceAdapter(
  next: ModelLockoutPersistenceAdapter | null
): void {
  adapter = next;
}

function reportFailure(operation: string, err: unknown): void {
  // Adapter errors can contain upstream bodies or connection metadata. Log only
  // the failure class, never the message, so a degraded DB cannot leak secrets.
  const errorType = err instanceof Error ? err.name : typeof err;
  log.warn({ operation, errorType }, "model lockout persistence failed");
}

function safeCall(operation: string, fn: () => void): void {
  if (!adapter) return;
  try {
    fn();
  } catch (err) {
    reportFailure(operation, err);
  }
}

export function persistUpsert(
  key: string,
  entry: ModelLockoutEntry | undefined,
  failure: ModelFailureState | undefined
): void {
  if (!adapter || (!entry && !failure)) return;
  const parsed = parseModelLockKey(key);
  const row: PersistedModelResilienceRow = {
    stateKey: key,
    provider: parsed.provider,
    connectionId: parsed.connectionId,
    scope: parsed.scope,
    modelScope: parsed.model,
    reasonCode: sanitizeReasonCode(entry?.reason ?? "unknown"),
    lockUntilMs: entry?.until ?? null,
    lockedAtMs: entry?.lockedAt ?? failure?.lastFailureAt ?? Date.now(),
    failureCount: entry?.failureCount ?? failure?.failureCount ?? 1,
    lastFailureAtMs: failure?.lastFailureAt ?? entry?.lastFailureAt ?? Date.now(),
    resetAfterMs: failure?.resetAfterMs ?? entry?.resetAfterMs ?? 0,
    lastCooldownMs: failure?.lastCooldownMs ?? null,
  };
  safeCall("upsert", () => adapter!.upsert(row));
}

export function persistDeletes(keys: string[]): void {
  if (keys.length === 0) return;
  safeCall("deleteKeys", () => adapter!.deleteKeys(keys));
}

export function persistClearAll(): void {
  safeCall("clearAll", () => adapter!.clearAll());
}

export function persistLockCleared(stateKey: string, nowMs: number): void {
  safeCall("markLockCleared", () => adapter!.markLockCleared(stateKey, nowMs));
}
