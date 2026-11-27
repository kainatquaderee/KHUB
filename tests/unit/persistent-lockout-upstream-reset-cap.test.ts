/**
 * AC-19 — an authoritative upstream reset 9 days out survives operator cap
 * (1 day) and a process restart at +1 day with ~8 days left. Hydration must
 * restore the absolute deadline without re-applying the cap.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TEST_DATA_DIR =
  process.env.OMNIROUTE_TEST_DATA_DIR ??
  fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-upstream-reset-cap-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const DAY = 86_400_000;
const HOUR_BASE = 3_600_000;
const PHASE = process.env.OMNIROUTE_RESET_CAP_PHASE;
const CONNECTION_ID = "reset-cap-connection";
const MODEL = "gpt-5.6-reset-cap";
const UPSTREAM_RESET_MS = 9 * DAY;
const OPERATOR_CAP_MS = DAY;

if (PHASE === "write" || PHASE === "restore") {
  const shift = PHASE === "restore" ? DAY : 0;
  const realNow = Date.now();
  Date.now = () => realNow + shift;

  test(`phase ${PHASE}: authoritative reset survives restart and operator cap`, async () => {
    const core = await import("../../src/lib/db/core.ts");
    const { installAndHydrateModelLockoutPersistence } =
      await import("../../src/lib/resilience/modelLockoutHydration.ts");
    const { readAllModelResilienceState } = await import("../../src/lib/db/modelLockoutState.ts");
    const accountFallback = await import("../../open-sse/services/accountFallback.ts");

    try {
      installAndHydrateModelLockoutPersistence({ nowMs: Date.now() });
      if (PHASE === "write") {
        accountFallback.clearAllModelLockouts({ persist: false });
        const result = accountFallback.recordModelLockoutFailure(
          "codex",
          CONNECTION_ID,
          MODEL,
          "quota_exhausted",
          429,
          HOUR_BASE,
          null,
          {
            scope: "exact",
            exactCooldownMs: UPSTREAM_RESET_MS,
            exactCooldownIsUpstreamReset: true,
            maxCooldownMs: OPERATOR_CAP_MS,
          }
        );
        assert.equal(result.cooldownMs, UPSTREAM_RESET_MS, "authoritative reset must bypass cap");
        const row = readAllModelResilienceState().find(
          (entry) => entry.connectionId === CONNECTION_ID
        );
        assert.ok(row, "the authoritative reset must be persisted");
        assert.equal(row!.lockUntilMs, Date.now() + UPSTREAM_RESET_MS);
      } else {
        const rowsBefore = readAllModelResilienceState();
        assert.equal(rowsBefore.length, 1);
        const hydration = installAndHydrateModelLockoutPersistence({ nowMs: Date.now() });
        assert.equal(hydration.restored, 1);
        assert.equal(hydration.purged, 0, "the 9-day lock must not be purged at +1 day");
        assert.equal(accountFallback.isModelLocked("codex", CONNECTION_ID, MODEL), true);
        const info = accountFallback.getModelLockoutInfo("codex", CONNECTION_ID, MODEL);
        assert.ok(info);
        // Independently derived: 9d deadline minus the simulated 1d restart.
        assert.ok(
          Math.abs(info!.remainingMs - 8 * DAY) < 5_000,
          `expected ~8d remaining after restart, got ${info!.remainingMs}`
        );
        assert.equal(info!.reason, "quota_exhausted");
        assert.equal(info!.failureCount, 1);
        const row = readAllModelResilienceState().find(
          (entry) => entry.connectionId === CONNECTION_ID
        );
        assert.equal(row!.lockUntilMs, rowsBefore[0]!.lockUntilMs, "deadline must not change");
        assert.equal(row!.lastCooldownMs, UPSTREAM_RESET_MS, "cap must not be re-applied");
      }
    } finally {
      accountFallback.clearAllModelLockouts({ persist: false });
      core.resetDbInstance();
    }
  });
} else {
  test("AC-19: sequential processes share one DATA_DIR and preserve the uncapped deadline", () => {
    const hermeticDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-reset-cap-parent-"));
    const outputs: string[] = [];
    for (const phase of ["write", "restore"]) {
      outputs.push(
        execFileSync(
          process.execPath,
          ["--import", "tsx/esm", "--test", "--test-reporter=spec", fileURLToPath(import.meta.url)],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              NODE_TEST_CONTEXT: undefined,
              DATA_DIR: hermeticDir,
              OMNIROUTE_TEST_DATA_DIR: hermeticDir,
              OMNIROUTE_RESET_CAP_PHASE: phase,
            },
            encoding: "utf8",
            timeout: 120_000,
          }
        )
      );
    }
    outputs.forEach((output, index) => {
      assert.match(output, /pass 1\b/, `phase ${index} must pass`);
      assert.doesNotMatch(output, /fail [1-9]\b/, `phase ${index} must not fail`);
    });
    fs.rmSync(hermeticDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
}
