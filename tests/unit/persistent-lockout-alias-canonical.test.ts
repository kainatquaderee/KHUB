/**
 * AC-16 — `cx` and `codex` share one lockout namespace, in memory and after
 * persistence/hydration. Neither spelling may route around a live lock.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-alias-canonical-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const accountFallback = await import("../../open-sse/services/accountFallback.ts");
const { installAndHydrateModelLockoutPersistence } =
  await import("../../src/lib/resilience/modelLockoutHydration.ts");
const { readAllModelResilienceState, upsertModelResilienceState } =
  await import("../../src/lib/db/modelLockoutState.ts");

const HOUR = 3_600_000;
const MODEL = "gpt-5.6-alias";

test.after(() => {
  accountFallback.clearAllModelLockouts({ persist: false });
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("AC-16: an alias-written lock is persisted with the canonical key and visible both ways", () => {
  installAndHydrateModelLockoutPersistence();
  accountFallback.clearAllModelLockouts({ persist: false });
  accountFallback.lockModel("cx", "conn-alias-a", MODEL, "quota_exhausted", HOUR, {
    failureCount: 1,
  });

  const rows = readAllModelResilienceState();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.stateKey.startsWith("codex:"), true, "stateKey must be canonicalized");
  assert.equal(rows[0]!.provider, "codex", "provider column must be canonicalized");
  assert.equal(accountFallback.isModelLocked("codex", "conn-alias-a", MODEL), true);
  assert.equal(accountFallback.isModelLocked("cx", "conn-alias-a", MODEL), true);

  accountFallback.clearAllModelLockouts({ persist: false });
  assert.equal(installAndHydrateModelLockoutPersistence().restored, 1);
  assert.equal(accountFallback.isModelLocked("codex", "conn-alias-a", MODEL), true);
  assert.equal(accountFallback.isModelLocked("cx", "conn-alias-a", MODEL), true);
});

test("AC-16: a canonical-written lock is visible through the alias after hydration", () => {
  accountFallback.clearAllModelLockouts({ persist: false });
  accountFallback.lockExactModel("codex", "conn-alias-b", MODEL, "quota_exhausted", HOUR, {
    failureCount: 2,
  });
  accountFallback.clearAllModelLockouts({ persist: false });

  const hydration = installAndHydrateModelLockoutPersistence();
  assert.equal(hydration.restored, 2, "both alias and canonical rows must be restored");
  assert.equal(accountFallback.isModelLocked("cx", "conn-alias-b", MODEL), true);
  assert.equal(accountFallback.getModelLockoutInfo("cx", "conn-alias-b", MODEL)?.failureCount, 2);
  assert.equal(accountFallback.isModelLocked("codex", "conn-alias-b", MODEL), true);
});

test("AC-16: hydration canonicalizes an alias provider column onto the canonical key", () => {
  accountFallback.clearAllModelLockouts({ persist: false });
  const now = Date.now();
  upsertModelResilienceState({
    stateKey: "codex:conn-alias-c:exact:gpt-5.6-alias",
    provider: "cx",
    connectionId: "conn-alias-c",
    scope: "exact",
    modelScope: MODEL,
    reasonCode: "quota_exhausted",
    lockUntilMs: now + HOUR,
    lockedAtMs: now,
    failureCount: 3,
    lastFailureAtMs: now,
    resetAfterMs: 30 * 60_000,
    lastCooldownMs: null,
  });

  const hydration = installAndHydrateModelLockoutPersistence({ nowMs: now });
  assert.equal(hydration.restored, 3, "the alias-provider row must hydrate");
  assert.equal(accountFallback.isModelLocked("codex", "conn-alias-c", MODEL), true);
  assert.equal(accountFallback.isModelLocked("cx", "conn-alias-c", MODEL), true);
  assert.equal(
    accountFallback.getModelLockoutInfo("codex", "conn-alias-c", MODEL)?.failureCount,
    3
  );
});
