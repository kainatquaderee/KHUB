/**
 * AC-1/2/3/4 — restart survival with absolute epoch-ms timestamps.
 *
 * The three phases below run as three SEPARATE Node processes sharing one
 * temporary DATA_DIR, so a restart is real rather than simulated by clearing
 * an in-memory map. Phase 2 and 3 advance Date.now() to model +1h / +8d.
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
  fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-restart-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const PHASE = process.env.OMNIROUTE_PERSIST_PHASE;
const CONNECTION_ID = "restart-connection";
const MODEL = "gpt-5.6-luna";

if (PHASE === "write" || PHASE === "restore" || PHASE === "sixdays" || PHASE === "expired") {
  const shift =
    PHASE === "restore" ? HOUR : PHASE === "sixdays" ? 6 * DAY : PHASE === "expired" ? 8 * DAY : 0;
  const realNow = Date.now();
  Date.now = () => realNow + shift;

  test(`phase ${PHASE}: model lockout survives a process boundary`, async () => {
    const core = await import("../../src/lib/db/core.ts");
    const { installAndHydrateModelLockoutPersistence } =
      await import("../../src/lib/resilience/modelLockoutHydration.ts");
    const { readAllModelResilienceState } = await import("../../src/lib/db/modelLockoutState.ts");
    const accountFallback = await import("../../open-sse/services/accountFallback.ts");

    try {
      const hydration = installAndHydrateModelLockoutPersistence({ nowMs: Date.now() });
      if (PHASE === "write") {
        accountFallback.clearAllModelLockouts({ persist: false });
        accountFallback.lockModel("codex", CONNECTION_ID, MODEL, "quota_exhausted", 7 * DAY, {
          failureCount: 2,
          resetAfterMs: 30 * 60_000,
        });
        const rows = readAllModelResilienceState();
        const row = rows.find((entry) => entry.connectionId === CONNECTION_ID);
        assert.ok(row, "lockout must be persisted before the process exits");
        assert.equal(row.failureCount, 2);
        assert.ok(row.lockUntilMs !== null && row.lockUntilMs > Date.now() + 6 * DAY);
      } else if (PHASE === "restore" || PHASE === "sixdays") {
        assert.equal(hydration.restored, 1, "one active lockout must be hydrated");
        assert.equal(hydration.skipped, 0);
        assert.equal(
          accountFallback.isModelLocked("codex", CONNECTION_ID, MODEL),
          true,
          "locked model must stay locked after restart +1h"
        );
        const info = accountFallback.getModelLockoutInfo("codex", CONNECTION_ID, MODEL);
        assert.ok(info, "lockout info must survive restart");
        assert.equal(info!.failureCount, 2, "failure count must survive restart");
        assert.equal(info!.reason, "quota_exhausted");
        const expectedRemaining = PHASE === "restore" ? 6 * DAY + 23 * HOUR : DAY;
        assert.ok(
          Math.abs(info!.remainingMs - expectedRemaining) < 5_000,
          `remaining should be ~${PHASE === "restore" ? "6d23h" : "1d"} at ${PHASE}, got ${info!.remainingMs}`
        );
        assert.equal(
          readAllModelResilienceState().filter((entry) => entry.connectionId === CONNECTION_ID)
            .length,
          1,
          "hydration must not delete the active row"
        );
      } else {
        assert.equal(hydration.restored, 0, "expired lockout must not be restored");
        assert.equal(hydration.purged, 1, "stale row must be purged at boot");
        assert.equal(
          accountFallback.isModelLocked("codex", CONNECTION_ID, MODEL),
          false,
          "lockout past expiry must not be active"
        );
        assert.equal(accountFallback.getModelLockoutInfo("codex", CONNECTION_ID, MODEL), null);
        assert.equal(
          readAllModelResilienceState().filter((entry) => entry.connectionId === CONNECTION_ID)
            .length,
          0,
          "expired row with past escalation window must be purged"
        );
      }
    } finally {
      accountFallback.clearAllModelLockouts({ persist: false });
      core.resetDbInstance();
    }
  });
} else {
  test("AC-1..4: sequential processes share one DATA_DIR and preserve absolute deadlines", () => {
    const hermeticDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-restart-parent-"));
    const outputs: string[] = [];
    for (const phase of ["write", "restore", "sixdays", "expired"]) {
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
              OMNIROUTE_PERSIST_PHASE: phase,
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
