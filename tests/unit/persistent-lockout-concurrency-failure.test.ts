/**
 * AC-14/15 — a longer re-lock must never reset accumulated escalation, and a
 * failing persistence adapter must never turn a routing lock into a request
 * failure or leak its raw error text into dashboard state.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-lockout-concurrency-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const accountFallback = await import("../../open-sse/services/accountFallback.ts");
const { setModelLockoutPersistenceAdapter } =
  await import("../../open-sse/services/accountFallback/persistenceBridge.ts");
const { installAndHydrateModelLockoutPersistence } =
  await import("../../src/lib/resilience/modelLockoutHydration.ts");
const { readAllModelResilienceState } = await import("../../src/lib/db/modelLockoutState.ts");

const DAY = 86_400_000;
const HOUR = 3_600_000;
const CONNECTION_ID = "concurrency-connection";
const MODEL = "gpt-5.6-concurrency";
const RAW_ERROR_SECRET = "BOOT_DB_FAILURE_leave_this_out_of_the_api";

test.after(() => {
  accountFallback.clearAllModelLockouts({ persist: false });
  setModelLockoutPersistenceAdapter(null);
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("AC-14: a 7d re-lock preserves the longer deadline and never lowers failureCount", () => {
  installAndHydrateModelLockoutPersistence();
  accountFallback.clearAllModelLockouts({ persist: true });

  accountFallback.lockModel("codex", CONNECTION_ID, MODEL, "quota_exhausted", HOUR, {
    failureCount: 5,
    lastFailureAt: Date.now(),
    resetAfterMs: 30 * 60_000,
  });
  accountFallback.lockModel("codex", CONNECTION_ID, MODEL, "quota_exhausted", 7 * DAY, {
    failureCount: 2,
    lastFailureAt: Date.now(),
    resetAfterMs: 30 * 60_000,
  });

  const info = accountFallback.getModelLockoutInfo("codex", CONNECTION_ID, MODEL);
  assert.ok(info, "the later, longer lock must remain active");
  assert.ok(info!.remainingMs > 6 * DAY, `expected ~7d remaining, got ${info!.remainingMs}ms`);
  assert.ok(
    info!.failureCount >= 5,
    `failureCount must stay monotonic; got ${info!.failureCount} after 5 → 2`
  );

  const row = readAllModelResilienceState().find(
    (entry) => entry.connectionId === CONNECTION_ID && entry.failureCount >= 5
  );
  assert.ok(row, "persisted row must keep the escalated failureCount");
  assert.ok(row!.lockUntilMs !== null && row!.lockUntilMs > Date.now() + 6 * DAY);
});

test("AC-14: overlapping 1h and 7d writes keep the 7d deadline and the higher count", async () => {
  installAndHydrateModelLockoutPersistence();
  accountFallback.clearAllModelLockouts({ persist: true });
  const overlapping = "overlap-connection";
  const model = "gpt-5.6-overlap";
  await Promise.all([
    Promise.resolve().then(() =>
      accountFallback.lockModel("codex", overlapping, model, "quota_exhausted", HOUR, {
        failureCount: 5,
        resetAfterMs: 30 * 60_000,
      })
    ),
    Promise.resolve().then(() =>
      accountFallback.lockModel("codex", overlapping, model, "quota_exhausted", 7 * DAY, {
        failureCount: 2,
        resetAfterMs: 30 * 60_000,
      })
    ),
  ]);

  const info = accountFallback.getModelLockoutInfo("codex", overlapping, model);
  assert.ok(info);
  assert.ok(info!.remainingMs > 6 * DAY, `expected ~7d, got ${info!.remainingMs}`);
  assert.ok(info!.failureCount >= 5, `failureCount must not shrink, got ${info!.failureCount}`);
  const row = readAllModelResilienceState().find((entry) => entry.connectionId === overlapping);
  assert.ok(row);
  assert.ok(row!.lockUntilMs !== null && row!.lockUntilMs > Date.now() + 6 * DAY);
  assert.ok(row!.failureCount >= 5, "persisted failureCount must not shrink");
});

test("AC-15: throwing persistence adapter leaves the lock in memory and boot still hydrates", () => {
  setModelLockoutPersistenceAdapter({
    upsert: () => {
      throw new Error(`${RAW_ERROR_SECRET}: upsert`);
    },
    deleteKeys: () => {
      throw new Error(`${RAW_ERROR_SECRET}: delete`);
    },
    clearAll: () => {
      throw new Error(`${RAW_ERROR_SECRET}: clear`);
    },
    markLockCleared: () => {
      throw new Error(`${RAW_ERROR_SECRET}: markCleared`);
    },
  });

  assert.doesNotThrow(() => accountFallback.clearAllModelLockouts(), "clear must stay best-effort");
  assert.doesNotThrow(() =>
    accountFallback.lockModel(
      "codex",
      "adapter-failure-connection",
      "gpt-5.6-adapter-failure",
      `Bearer ${RAW_ERROR_SECRET}`,
      HOUR,
      { failureCount: 1, resetAfterMs: 30 * 60_000 }
    )
  );

  assert.equal(
    accountFallback.isModelLocked("codex", "adapter-failure-connection", "gpt-5.6-adapter-failure"),
    true,
    "in-memory lock must survive a DB write failure"
  );
  const visible = JSON.stringify(accountFallback.getAllModelLockouts());
  assert.equal(visible.includes(RAW_ERROR_SECRET), false, "raw adapter error leaked to API state");

  assert.doesNotThrow(
    () => installAndHydrateModelLockoutPersistence(),
    "boot hydration must not fail because an adapter previously threw"
  );
  assert.ok(readAllModelResilienceState().length >= 1, "boot hydration still reaches the DB");
});
