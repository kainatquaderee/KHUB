/**
 * AC-17 — an empty persisted table preserves today's behavior; malformed,
 * null and non-finite persisted timestamps cannot boot into an infinite lock.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-invalid-boot-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const accountFallback = await import("../../open-sse/services/accountFallback.ts");
const { installAndHydrateModelLockoutPersistence } =
  await import("../../src/lib/resilience/modelLockoutHydration.ts");
const { readAllModelResilienceState } = await import("../../src/lib/db/modelLockoutState.ts");

const HOUR = 3_600_000;
const PROVIDER = "codex";
const CONNECTION = "invalid-boot-connection";

test.after(() => {
  accountFallback.clearAllModelLockouts({ persist: false });
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("AC-17: empty persisted state boots cleanly and leaves normal lock behavior intact", () => {
  const hydration = installAndHydrateModelLockoutPersistence();
  assert.deepEqual(
    { restored: hydration.restored, skipped: hydration.skipped, purged: hydration.purged },
    { restored: 0, skipped: 0, purged: 0 }
  );
  assert.deepEqual(readAllModelResilienceState(), []);
  assert.equal(accountFallback.isModelLocked(PROVIDER, CONNECTION, "fresh-model"), false);

  accountFallback.lockModel(PROVIDER, CONNECTION, "fresh-model", "quota_exhausted", HOUR, {
    failureCount: 1,
  });
  const info = accountFallback.getModelLockoutInfo(PROVIDER, CONNECTION, "fresh-model");
  assert.ok(info, "a normal lock must still work after an empty boot");
  assert.ok(info!.remainingMs > 0 && info!.remainingMs <= HOUR);
  accountFallback.clearAllModelLockouts();
});

test("AC-17: malformed/null/non-finite timestamps are ignored or purged without an infinite lock", () => {
  accountFallback.clearAllModelLockouts({ persist: false });
  const now = Date.now();
  const db = core.getDbInstance() as unknown as {
    prepare: (sql: string) => { run: (...params: unknown[]) => unknown };
  };
  const insert = db.prepare(
    `INSERT INTO model_resilience_state (
       state_key, provider, connection_id, scope, model_scope, reason_code,
       lock_until_ms, locked_at_ms, failure_count, last_failure_at_ms,
       reset_after_ms, last_cooldown_ms, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const base = {
    provider: PROVIDER,
    connectionId: CONNECTION,
    scope: "exact",
    reasonCode: "quota_exhausted",
    failureCount: 1,
    resetAfterMs: 30 * 60_000,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
  const fixtures = [
    { model: "bad-until-text", lockUntil: "not-a-date", lockedAt: now, lastFailure: now },
    { model: "bad-until-infinity", lockUntil: "Infinity", lockedAt: now, lastFailure: now },
    { model: "bad-until-overflow", lockUntil: 8.64e15 + 1, lockedAt: now, lastFailure: now },
    { model: "bad-locked-at", lockUntil: now + HOUR, lockedAt: "not-a-date", lastFailure: now },
    {
      model: "null-until-with-invalid-locked-at",
      lockUntil: null,
      lockedAt: "null",
      lastFailure: now,
    },
    { model: "bad-last-failure", lockUntil: now + HOUR, lockedAt: now, lastFailure: "not-a-date" },
    {
      model: "negative-window",
      lockUntil: now + HOUR,
      lockedAt: now,
      lastFailure: now,
      resetAfterMs: -1,
    },
  ];
  for (const fixture of fixtures) {
    insert.run(
      `${PROVIDER}:${CONNECTION}:exact:${fixture.model}`,
      base.provider,
      base.connectionId,
      base.scope,
      fixture.model,
      base.reasonCode,
      fixture.lockUntil,
      fixture.lockedAt,
      base.failureCount,
      fixture.lastFailure,
      fixture.resetAfterMs ?? base.resetAfterMs,
      null,
      base.createdAt,
      base.updatedAt
    );
  }

  let hydration: { restored: number; purged: number; skipped: number };
  assert.doesNotThrow(() => {
    hydration = installAndHydrateModelLockoutPersistence({ nowMs: now });
  }, "boot hydration must not throw on malformed rows");
  assert.equal(hydration!.restored, 0, "no malformed row may become a live lock");
  assert.equal(
    hydration!.purged + hydration!.skipped,
    fixtures.length,
    "every malformed row must be purged or skipped"
  );
  for (const fixture of fixtures) {
    assert.equal(
      accountFallback.isModelLocked(PROVIDER, CONNECTION, fixture.model),
      false,
      `${fixture.model} must not be infinitely locked`
    );
    const info = accountFallback.getModelLockoutInfo(PROVIDER, CONNECTION, fixture.model);
    assert.equal(info, null, `${fixture.model} must have no live lock info`);
  }
  const remaining = readAllModelResilienceState();
  assert.ok(
    remaining.every((entry) => entry.lockUntilMs === null),
    "any malformed deadline left in SQLite must be ignored (no live lock), never hydrated"
  );
});
