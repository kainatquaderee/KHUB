/**
 * NFR-2 — boot hydration remains bounded with a large persisted lockout table,
 * and the per-request lock check stays cheap after hydration.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-lockout-perf-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const accountFallback = await import("../../open-sse/services/accountFallback.ts");
const { buildExactModelLockKey } =
  await import("../../open-sse/services/accountFallback/exactModelLock.ts");
const { setModelLockoutPersistenceAdapter } =
  await import("../../open-sse/services/accountFallback/persistenceBridge.ts");
const { installAndHydrateModelLockoutPersistence } =
  await import("../../src/lib/resilience/modelLockoutHydration.ts");
const { clearAllModelResilienceState, upsertModelResilienceState } =
  await import("../../src/lib/db/modelLockoutState.ts");

const DAY = 86_400_000;
const HOUR = 3_600_000;
const PROVIDER = "openai";
const CONNECTION_ID = "hydration-perf-connection";
const ROW_COUNT = 10_000;
const CHECK_COUNT = 1_000;
const HYDRATION_BUDGET_MS = 2_000;
const CHECK_BUDGET_MS = 1_000;

test.after(() => {
  accountFallback.clearAllModelLockouts({ persist: false });
  setModelLockoutPersistenceAdapter(null);
  clearAllModelResilienceState();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("NFR-2: 10k persisted rows hydrate within 2s and 1k checks within 1s", (t) => {
  const now = Date.now();
  const lockUntilMs = now + DAY;
  for (let i = 0; i < ROW_COUNT; i += 1) {
    const model = `perf-model-${i}`;
    upsertModelResilienceState({
      stateKey: buildExactModelLockKey(PROVIDER, CONNECTION_ID, model),
      provider: PROVIDER,
      connectionId: CONNECTION_ID,
      scope: "exact",
      modelScope: model,
      reasonCode: "rate_limited",
      lockUntilMs,
      lockedAtMs: now,
      failureCount: 1,
      lastFailureAtMs: now,
      resetAfterMs: HOUR,
      lastCooldownMs: null,
    });
  }

  const hydrationStart = performance.now();
  const hydration = installAndHydrateModelLockoutPersistence({ nowMs: now });
  const hydrationMs = performance.now() - hydrationStart;
  t.diagnostic(`hydrated ${hydration.restored} rows in ${hydrationMs.toFixed(1)}ms`);

  assert.equal(hydration.restored, ROW_COUNT, "every active row must be hydrated");
  assert.equal(hydration.purged, 0, "no active row may be purged for the soft cap");
  assert.match(hydration.warning ?? "", /soft cap 1000/, "overflow is reported by count only");
  assert.ok(
    hydrationMs <= HYDRATION_BUDGET_MS,
    `hydration took ${hydrationMs.toFixed(1)}ms, budget ${HYDRATION_BUDGET_MS}ms`
  );

  const checkStart = performance.now();
  for (let i = 0; i < CHECK_COUNT; i += 1) {
    assert.equal(accountFallback.isModelLocked(PROVIDER, CONNECTION_ID, `perf-model-${i}`), true);
  }
  const checksMs = performance.now() - checkStart;
  t.diagnostic(`completed ${CHECK_COUNT} isModelLocked checks in ${checksMs.toFixed(1)}ms`);
  assert.ok(
    checksMs <= CHECK_BUDGET_MS,
    `${CHECK_COUNT} checks took ${checksMs.toFixed(1)}ms, budget ${CHECK_BUDGET_MS}ms`
  );
});
