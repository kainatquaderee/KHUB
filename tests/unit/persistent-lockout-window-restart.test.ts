/**
 * AC-10 — when the lock has expired but its escalation window is still live,
 * persisted failure state must survive a restart: the next failure escalates.
 * The row must only disappear once the window itself ends (AC-2/AC-10).
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
  fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-window-restart-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const PHASE = process.env.OMNIROUTE_WINDOW_PHASE;
const CONNECTION_ID = "window-connection";
const MODEL = "gpt-5.6-window";
const BASE_MS = MINUTE;

if (PHASE === "write" || PHASE === "restore") {
  const shift = PHASE === "restore" ? 2 * MINUTE : 0;
  const realNow = Date.now();
  Date.now = () => realNow + shift;

  test(`phase ${PHASE}: live escalation window survives a process boundary`, async () => {
    const core = await import("../../src/lib/db/core.ts");
    const { installAndHydrateModelLockoutPersistence } =
      await import("../../src/lib/resilience/modelLockoutHydration.ts");
    const { readAllModelResilienceState } = await import("../../src/lib/db/modelLockoutState.ts");
    const accountFallback = await import("../../open-sse/services/accountFallback.ts");

    try {
      installAndHydrateModelLockoutPersistence({ nowMs: Date.now() });
      if (PHASE === "write") {
        accountFallback.clearAllModelLockouts({ persist: false });
        const first = accountFallback.recordModelLockoutFailure(
          "codex",
          CONNECTION_ID,
          MODEL,
          "rate_limited",
          429,
          BASE_MS,
          null,
          { scope: "exact", maxCooldownMs: HOUR }
        );
        assert.equal(first.failureCount, 1);
        const row = readAllModelResilienceState().find(
          (entry) => entry.connectionId === CONNECTION_ID
        );
        assert.equal(row?.failureCount, 1);
      } else {
        const before = readAllModelResilienceState().find(
          (entry) => entry.connectionId === CONNECTION_ID
        );
        assert.ok(before, "purge must keep the row while the escalation window is still live");
        assert.ok(
          before!.lastFailureAtMs + before!.resetAfterMs + (before!.lastCooldownMs ?? 0) >
            Date.now(),
          "the escalation window must still be live"
        );
        assert.equal(accountFallback.isModelLocked("codex", CONNECTION_ID, MODEL), false);

        // Boot must restore failure state even though the short lock expired.
        installAndHydrateModelLockoutPersistence({ nowMs: Date.now() });
        const second = accountFallback.recordModelLockoutFailure(
          "codex",
          CONNECTION_ID,
          MODEL,
          "rate_limited",
          429,
          BASE_MS,
          null,
          { scope: "exact", maxCooldownMs: HOUR }
        );
        assert.equal(
          second.failureCount,
          2,
          "failure state in the live window must survive restart and escalate"
        );
        assert.equal(second.cooldownMs, 2 * BASE_MS);
      }
    } finally {
      accountFallback.clearAllModelLockouts({ persist: false });
      core.resetDbInstance();
    }
  });
} else {
  test("AC-10: an expired lock with a live escalation window escalates after restart", () => {
    const hermeticDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-window-parent-"));
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
              OMNIROUTE_WINDOW_PHASE: phase,
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
