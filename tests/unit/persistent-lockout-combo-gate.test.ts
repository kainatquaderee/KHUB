/**
 * AC-5 — a hydrated model lockout must gate combo/AUTO candidate selection the
 * same way a lockout created in the current process does. Routing reads only
 * in-memory state after boot; it must not need a DB round-trip per candidate.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-combo-gate-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const { installAndHydrateModelLockoutPersistence } =
  await import("../../src/lib/resilience/modelLockoutHydration.ts");
const { readAllModelResilienceState } = await import("../../src/lib/db/modelLockoutState.ts");
const accountFallback = await import("../../open-sse/services/accountFallback.ts");
const { setModelLockoutPersistenceAdapter } =
  await import("../../open-sse/services/accountFallback/persistenceBridge.ts");
const { filterLockoutCandidates } =
  await import("../../open-sse/services/autoCombo/modelLockoutFilter.ts");

const HOUR = 3_600_000;
const MODEL = "gpt-5.6-luna";

test.after(() => {
  accountFallback.clearAllModelLockouts({ persist: false });
  setModelLockoutPersistenceAdapter(null);
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("AC-5: hydrated lockouts exclude or narrow combo candidates", () => {
  installAndHydrateModelLockoutPersistence();
  accountFallback.clearAllModelLockouts({ persist: false });
  accountFallback.lockModel("codex", "conn-a", MODEL, "quota_exhausted", HOUR, {
    failureCount: 2,
    resetAfterMs: 30 * 60_000,
  });
  assert.equal(readAllModelResilienceState().length, 1, "lockout must be persisted before boot");

  // Simulate a fresh process: the only surviving state is the SQLite row.
  accountFallback.clearAllModelLockouts({ persist: false });
  const hydration = installAndHydrateModelLockoutPersistence();
  assert.equal(hydration.restored, 1);

  assert.equal(accountFallback.isModelLocked("codex", "conn-a", MODEL), true);
  assert.equal(accountFallback.isModelLocked("codex", "conn-b", MODEL), false);

  const { pool, diagnosis } = filterLockoutCandidates([
    { provider: "codex", model: MODEL, connectionId: "conn-a" },
    {
      provider: "codex",
      model: MODEL,
      allowedConnectionIds: ["conn-a", "conn-b"],
    },
    { provider: "codex", model: MODEL, connectionId: "conn-b" },
  ]);

  assert.deepEqual(
    pool.map((candidate) => candidate.allowedConnectionIds ?? [candidate.connectionId]),
    [["conn-b"], ["conn-b"]],
    "the fully locked candidate is excluded; the mixed candidate is narrowed"
  );
  assert.deepEqual(diagnosis, { excludedLockout: 1, total: 3 });
});
