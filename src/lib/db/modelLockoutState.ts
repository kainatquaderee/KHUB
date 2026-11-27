/**
 * db/modelLockoutState.ts — sole SQL owner of `model_resilience_state`.
 *
 * Rows hold absolute epoch-ms deadlines only. Hydration never re-applies caps
 * or duration math; every write is monotonic for lock deadline and failure count.
 */

import { getDbInstance } from "./core";
import {
  isRepresentableEpochMs,
  sanitizeReasonCode,
  type PersistedModelResilienceRow,
} from "../resilience/persistedResilienceCodec";

export const MODEL_RESILIENCE_SOFT_CAP = 1000;

interface StatementLike<TRow = unknown> {
  all: (...params: unknown[]) => TRow[];
  get: (...params: unknown[]) => TRow | undefined;
  run: (...params: unknown[]) => { changes?: number };
}
interface DbLike {
  prepare: <TRow = unknown>(sql: string) => StatementLike<TRow>;
  transaction: <TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn
  ) => (...args: TArgs) => TReturn;
}

interface RawRow {
  state_key: string;
  provider: string;
  connection_id: string;
  scope: string;
  model_scope: string;
  reason_code: string;
  lock_until_ms: number | null;
  locked_at_ms: number;
  failure_count: number;
  last_failure_at_ms: number;
  reset_after_ms: number;
  last_cooldown_ms: number | null;
  created_at: string;
  updated_at: string;
}

const UPSERT_SQL = `
  INSERT INTO model_resilience_state (
    state_key, provider, connection_id, scope, model_scope, reason_code,
    lock_until_ms, locked_at_ms, failure_count, last_failure_at_ms,
    reset_after_ms, last_cooldown_ms, created_at, updated_at
  ) VALUES (
    @stateKey, @provider, @connectionId, @scope, @modelScope, @reasonCode,
    @lockUntilMs, @lockedAtMs, @failureCount, @lastFailureAtMs,
    @resetAfterMs, @lastCooldownMs, @createdAt, @updatedAt
  )
  ON CONFLICT(state_key) DO UPDATE SET
    lock_until_ms = CASE
      WHEN model_resilience_state.lock_until_ms IS NULL THEN excluded.lock_until_ms
      WHEN excluded.lock_until_ms IS NULL THEN model_resilience_state.lock_until_ms
      ELSE MAX(model_resilience_state.lock_until_ms, excluded.lock_until_ms)
    END,
    failure_count = MAX(model_resilience_state.failure_count, excluded.failure_count),
    provider = CASE WHEN excluded.lock_until_ms >= model_resilience_state.lock_until_ms THEN excluded.provider ELSE model_resilience_state.provider END,
    connection_id = CASE WHEN excluded.lock_until_ms >= model_resilience_state.lock_until_ms THEN excluded.connection_id ELSE model_resilience_state.connection_id END,
    scope = CASE WHEN excluded.lock_until_ms >= model_resilience_state.lock_until_ms THEN excluded.scope ELSE model_resilience_state.scope END,
    model_scope = CASE WHEN excluded.lock_until_ms >= model_resilience_state.lock_until_ms THEN excluded.model_scope ELSE model_resilience_state.model_scope END,
    reason_code = CASE WHEN excluded.lock_until_ms >= model_resilience_state.lock_until_ms THEN excluded.reason_code ELSE model_resilience_state.reason_code END,
    locked_at_ms = CASE WHEN excluded.lock_until_ms >= model_resilience_state.lock_until_ms THEN excluded.locked_at_ms ELSE model_resilience_state.locked_at_ms END,
    last_failure_at_ms = CASE WHEN excluded.lock_until_ms >= model_resilience_state.lock_until_ms THEN excluded.last_failure_at_ms ELSE model_resilience_state.last_failure_at_ms END,
    reset_after_ms = CASE WHEN excluded.lock_until_ms >= model_resilience_state.lock_until_ms THEN excluded.reset_after_ms ELSE model_resilience_state.reset_after_ms END,
    last_cooldown_ms = CASE WHEN excluded.lock_until_ms >= model_resilience_state.lock_until_ms THEN excluded.last_cooldown_ms ELSE model_resilience_state.last_cooldown_ms END,
    updated_at = excluded.updated_at
`;

function assertValidRow(row: PersistedModelResilienceRow): void {
  if (
    typeof row.stateKey !== "string" ||
    row.stateKey.length === 0 ||
    typeof row.provider !== "string" ||
    row.provider.length === 0 ||
    typeof row.connectionId !== "string" ||
    row.connectionId.length === 0 ||
    (row.scope !== "exact" && row.scope !== "quota_family") ||
    typeof row.modelScope !== "string" ||
    row.modelScope.length === 0 ||
    !isRepresentableEpochMs(row.lockedAtMs) ||
    !isRepresentableEpochMs(row.lastFailureAtMs) ||
    !isRepresentableEpochMs(row.resetAfterMs) ||
    row.resetAfterMs < 0 ||
    !Number.isInteger(row.failureCount) ||
    row.failureCount < 0 ||
    (row.lockUntilMs !== null && !isRepresentableEpochMs(row.lockUntilMs)) ||
    (row.lastCooldownMs !== null && !isRepresentableEpochMs(row.lastCooldownMs))
  ) {
    throw new Error("Invalid model resilience state row");
  }
}

export function upsertModelResilienceState(row: PersistedModelResilienceRow): void {
  assertValidRow(row);
  const now = new Date().toISOString();
  const db = getDbInstance() as unknown as DbLike;
  db.prepare(UPSERT_SQL).run({
    stateKey: row.stateKey,
    provider: row.provider,
    connectionId: row.connectionId,
    scope: row.scope,
    modelScope: row.modelScope,
    reasonCode: sanitizeReasonCode(row.reasonCode),
    lockUntilMs: row.lockUntilMs,
    lockedAtMs: row.lockedAtMs,
    failureCount: row.failureCount,
    lastFailureAtMs: row.lastFailureAtMs,
    resetAfterMs: row.resetAfterMs,
    lastCooldownMs: row.lastCooldownMs,
    createdAt: now,
    updatedAt: now,
  });
}

export function readAllModelResilienceState(): PersistedModelResilienceRow[] {
  const db = getDbInstance() as unknown as DbLike;
  const rows = db
    .prepare(
      `SELECT state_key, provider, connection_id, scope, model_scope, reason_code,
              lock_until_ms, locked_at_ms, failure_count, last_failure_at_ms,
              reset_after_ms, last_cooldown_ms, created_at, updated_at
       FROM model_resilience_state`
    )
    .all() as RawRow[];
  return rows.map((row) => ({
    stateKey: row.state_key,
    provider: row.provider,
    connectionId: row.connection_id,
    scope: row.scope === "exact" ? "exact" : "quota_family",
    modelScope: row.model_scope,
    reasonCode: row.reason_code,
    lockUntilMs: typeof row.lock_until_ms === "number" ? row.lock_until_ms : null,
    lockedAtMs: row.locked_at_ms,
    failureCount: row.failure_count,
    lastFailureAtMs: row.last_failure_at_ms,
    resetAfterMs: row.reset_after_ms,
    lastCooldownMs: typeof row.last_cooldown_ms === "number" ? row.last_cooldown_ms : null,
  }));
}

export function deleteModelResilienceState(keys: string[]): void {
  if (keys.length === 0) return;
  const db = getDbInstance() as unknown as DbLike;
  const stmt = db.prepare("DELETE FROM model_resilience_state WHERE state_key = ?");
  const runAll = db.transaction((allKeys: string[]) => {
    for (const key of allKeys) stmt.run(key);
  });
  runAll(keys);
}

export function clearAllModelResilienceState(): void {
  const db = getDbInstance() as unknown as DbLike;
  db.prepare("DELETE FROM model_resilience_state").run();
}

/** Clear only the deadline; failure/escalation columns stay until their window ends. */
export function markModelLockClearedInDb(stateKey: string, nowMs: number): void {
  if (!stateKey || !isRepresentableEpochMs(nowMs)) return;
  const db = getDbInstance() as unknown as DbLike;
  db.prepare(
    "UPDATE model_resilience_state SET lock_until_ms = NULL, updated_at = ? WHERE state_key = ?"
  ).run(new Date(nowMs).toISOString(), stateKey);
}

/**
 * Remove stale/invalid rows without ever evicting an active lockout for the cap.
 * A soft cap overflow is reported as a count-only warning.
 */
export function purgeExpiredModelResilienceState(
  nowMs: number,
  cap: number = MODEL_RESILIENCE_SOFT_CAP
): { deleted: number; active: number; warning?: string } {
  if (!isRepresentableEpochMs(nowMs)) return { deleted: 0, active: 0 };
  const rows = readAllModelResilienceState();
  const staleKeys: string[] = [];
  let active = 0;
  for (const row of rows) {
    const valid =
      row.stateKey.length > 0 &&
      row.provider.length > 0 &&
      row.connectionId.length > 0 &&
      (row.scope === "exact" || row.scope === "quota_family") &&
      row.modelScope.length > 0 &&
      isRepresentableEpochMs(row.lockedAtMs) &&
      isRepresentableEpochMs(row.lastFailureAtMs) &&
      isRepresentableEpochMs(row.resetAfterMs) &&
      row.resetAfterMs >= 0 &&
      Number.isInteger(row.failureCount) &&
      row.failureCount >= 0 &&
      (row.lockUntilMs === null || isRepresentableEpochMs(row.lockUntilMs)) &&
      (row.lastCooldownMs === null || isRepresentableEpochMs(row.lastCooldownMs));
    const lockActive = row.lockUntilMs !== null && row.lockUntilMs > nowMs;
    const escalationEndsAt = row.lastFailureAtMs + row.resetAfterMs + (row.lastCooldownMs ?? 0);
    if (!valid || (!lockActive && escalationEndsAt <= nowMs)) {
      staleKeys.push(row.stateKey);
      continue;
    }
    if (lockActive) active += 1;
  }
  deleteModelResilienceState(staleKeys);
  const result: { deleted: number; active: number; warning?: string } = {
    deleted: staleKeys.length,
    active,
  };
  if (active > cap) {
    result.warning = `model resilience active rows ${active} exceed soft cap ${cap}; active rows retained`;
  }
  return result;
}
