/**
 * AC-2 / AC-10 — cross-process escalation after restart.
 *
 * The first process records a failure with a 10m lock and a 30m escalation
 * window. The second process starts 1m later (lock and window both live): the
 * second failure MUST count as #2 and use base * 2^(2-1). The third process
 * starts 2h later: the row is stale and must be removed.
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
  fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-escalation-restart-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const PHASE = process.env.OMNIROUTE_ESCALATION_PHASE;
const CONNECTION_ID = "escalation-connection";
const MODEL = "gpt-5.6-escalation";
const BASE_MS = 10 * MINUTE;

if (PHASE === "write" || PHASE === "restore" || PHASE === "expired-window") {
  const shift = PHASE === "restore" ? MINUTE : PHASE === "expired-window" ? 2 * HOUR : 0;
  const realNow = Date.now();
  Date.now = () => realNow + shift;

  test(`phase ${PHASE}: escalation state survives a process boundary`, async () => {
    const core = await import("../../src/lib/db/core.ts");
    const { installAndHydrateModelLockoutPersistence } =
      await import("../../src/lib/resilience/modelLockoutHydration.ts");
    const { readAllModelResilienceState } = await import("../../src/lib/db/modelLockoutState.ts");
    const accountFallback = await import("../../open-sse/services/accountFallback.ts");

    try {
      const hydration = installAndHydrateModelLockoutPersistence({ nowMs: Date.now() });
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
          { scope: "exact", maxCooldownMs: 24 * HOUR }
        );
        assert.equal(first.failureCount, 1);
        assert.equal(first.cooldownMs, BASE_MS, "first failure must use the base cooldown");
        assert.equal(first.resetAfterMs, 30 * MINUTE);
        const row = readAllModelResilienceState().find(
          (entry) => entry.connectionId === CONNECTION_ID
        );
        assert.ok(row, "first failure must be persisted");
        assert.equal(row!.failureCount, 1);
        assert.equal(row!.lastCooldownMs, BASE_MS);
        assert.equal(row!.lockUntilMs, Date.now() + BASE_MS);
      } else if (PHASE === "restore") {
        assert.equal(hydration.restored, 1, "live escalation window must be hydrated");
        const before = readAllModelResilienceState().find(
          (entry) => entry.connectionId === CONNECTION_ID
        );
        assert.equal(before?.failureCount, 1);
        // Both the lock and the escalation window are still live at +1m.
        assert.equal(accountFallback.isModelLocked("cx", CONNECTION_ID, MODEL), true);
        const second = accountFallback.recordModelLockoutFailure(
          "cx",
          CONNECTION_ID,
          MODEL,
          "rate_limited",
          429,
          BASE_MS,
          null,
          { scope: "exact", maxCooldownMs: 24 * HOUR }
        );
        assert.equal(
          second.failureCount,
          2,
          "a second failure inside the persisted window must escalate"
        );
        // Independently derived contract: base * 2^(count-1) = 60s * 2 = 120s.
        assert.equal(second.cooldownMs, 2 * BASE_MS);
        const after = readAllModelResilienceState().find(
          (entry) => entry.connectionId === CONNECTION_ID
        );
        assert.equal(after?.failureCount, 2, "escalated count must be persisted");
        assert.equal(after?.lastCooldownMs, 2 * BASE_MS);
        assert.equal(after?.lockUntilMs, Date.now() + 2 * BASE_MS);
        assert.equal(accountFallback.isModelLocked("codex", CONNECTION_ID, MODEL), true);
      } else {
        assert.equal(hydration.restored, 0, "no lock may be restored after the window");
        assert.equal(hydration.purged, 1, "row past lock and escalation window must be purged");
        assert.equal(
          readAllModelResilienceState().some((entry) => entry.connectionId === CONNECTION_ID),
          false
        );
      }
    } finally {
      accountFallback.clearAllModelLockouts({ persist: false });
      core.resetDbInstance();
    }
  });
} else {
  test("AC-2/AC-10: sequential processes escalate then purge the persisted window", () => {
    const hermeticDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-escalation-parent-"));
    const outputs: string[] = [];
    for (const phase of ["write", "restore", "expired-window"]) {
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
              OMNIROUTE_ESCALATION_PHASE: phase,
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
