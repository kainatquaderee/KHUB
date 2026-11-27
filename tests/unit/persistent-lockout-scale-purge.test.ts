/**
 * AC-9 — 1,500 stale + 2 active 7-day lockouts. Boot must keep both active
 * lockouts, purge/hide every stale row, and never retain 1,500 stale rows for
 * the soft cap to become a routing problem.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-scale-purge-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const accountFallback = await import("../../open-sse/services/accountFallback.ts");
const { buildExactModelLockKey } =
  await import("../../open-sse/services/accountFallback/exactModelLock.ts");
const { installAndHydrateModelLockoutPersistence } =
  await import("../../src/lib/resilience/modelLockoutHydration.ts");
const { readAllModelResilienceState, upsertModelResilienceState } =
  await import("../../src/lib/db/modelLockoutState.ts");

const DAY = 86_400_000;
const STALE_COUNT = 1500;
const PROVIDER = "codex";
const CONNECTION = "scale-connection";

function row(stateKey: string, model: string, lockUntilMs: number, now: number) {
  return {
    stateKey,
    provider: PROVIDER,
    connectionId: CONNECTION,
    scope: "exact" as const,
    modelScope: model,
    reasonCode: "quota_exhausted",
    lockUntilMs,
    lockedAtMs: now - 8 * DAY,
    failureCount: 2,
    lastFailureAtMs: now - 8 * DAY,
    resetAfterMs: 30 * 60_000,
    lastCooldownMs: null,
  };
}

test.after(() => {
  accountFallback.clearAllModelLockouts({ persist: false });
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("AC-9: two active 7-day lockouts survive while 1,500 stale rows are purged", () => {
  const now = Date.now();
  for (let i = 0; i < STALE_COUNT; i += 1) {
    const model = `stale-model-${i}`;
    upsertModelResilienceState(
      row(buildExactModelLockKey(PROVIDER, CONNECTION, model), model, now - DAY, now)
    );
  }
  const activeModels = ["active-model-a", "active-model-b"];
  for (const model of activeModels) {
    upsertModelResilienceState(
      row(buildExactModelLockKey(PROVIDER, CONNECTION, model), model, now + 7 * DAY, now)
    );
  }
  assert.equal(readAllModelResilienceState().length, STALE_COUNT + activeModels.length);

  const hydration = installAndHydrateModelLockoutPersistence({ nowMs: now });
  assert.equal(hydration.purged, STALE_COUNT, "every stale row must be removed at boot");
  assert.equal(hydration.restored, 2, "both active 7-day lockouts must be restored");
  assert.equal(hydration.skipped, 0);
  assert.equal(hydration.warning, undefined, "active rows must not be evicted for the cap");

  assert.equal(accountFallback.getModelLockoutSize(), 2, "stale rows must be hidden from routing");
  for (const model of activeModels) {
    assert.equal(accountFallback.isModelLocked(PROVIDER, CONNECTION, model), true);
  }
  assert.equal(accountFallback.isModelLocked(PROVIDER, CONNECTION, "stale-model-0"), false);
  assert.equal(
    accountFallback.isModelLocked(PROVIDER, CONNECTION, `stale-model-${STALE_COUNT - 1}`),
    false
  );

  const persisted = readAllModelResilienceState();
  assert.ok(
    persisted.length <= 1000,
    `persisted active+stale count must be <=1000, got ${persisted.length}`
  );
  assert.deepEqual(persisted.map((entry) => entry.modelScope).sort(), activeModels.slice().sort());
});
