/**
 * AC-5 — the first combo route after a restart must not send ANY upstream
 * request to the locked connection; the alternate target must be dispatched.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-combo-upstream-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const accountFallback = await import("../../open-sse/services/accountFallback.ts");
const { installAndHydrateModelLockoutPersistence } =
  await import("../../src/lib/resilience/modelLockoutHydration.ts");
const { readAllModelResilienceState } = await import("../../src/lib/db/modelLockoutState.ts");
const { handleComboChat } = await import("../../open-sse/services/combo.ts");

const DAY = 86_400_000;
const MODEL = "gpt-5.6-luna";

test.after(() => {
  accountFallback.clearAllModelLockouts({ persist: false });
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("AC-5: hydrated lockout yields zero upstream attempts on the locked connection", async () => {
  installAndHydrateModelLockoutPersistence();
  accountFallback.clearAllModelLockouts({ persist: false });
  accountFallback.lockExactModel("codex", "conn-a", MODEL, "quota_exhausted", 7 * DAY, {
    failureCount: 2,
    resetAfterMs: 30 * 60_000,
  });
  assert.equal(readAllModelResilienceState().length, 1, "lockout must be persisted");

  // Fresh process: only SQLite state remains, then boot hydration rebuilds it.
  accountFallback.clearAllModelLockouts({ persist: false });
  const hydration = installAndHydrateModelLockoutPersistence();
  assert.equal(hydration.restored, 1);
  assert.equal(accountFallback.isModelLocked("cx", "conn-a", MODEL), true);

  const upstreamAttempts = new Map<string, number>();
  const response = await handleComboChat({
    body: { stream: false, messages: [{ role: "user", content: "first route after restart" }] },
    combo: {
      name: "persistent-lockout-combo",
      strategy: "priority",
      models: [
        { id: "a", kind: "model", model: `codex/${MODEL}`, connectionId: "conn-a", weight: 1 },
        { id: "b", kind: "model", model: `codex/${MODEL}`, connectionId: "conn-b", weight: 1 },
      ],
      config: { maxRetries: 0, retryDelayMs: 0, fallbackDelayMs: 0 },
    },
    settings: { resilienceSettings: { comboCooldownWait: { enabled: false } } },
    allCombos: null,
    log: { info() {}, warn() {}, debug() {}, error() {} },
    isModelAvailable: async () => true,
    handleSingleModel: async (_body, _modelStr, target) => {
      const id = target?.connectionId ?? "unknown";
      upstreamAttempts.set(id, (upstreamAttempts.get(id) ?? 0) + 1);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: `served by ${id}` } }] }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    },
  });

  assert.equal(response.status, 200, "the alternate target must serve the request");
  assert.equal(
    upstreamAttempts.get("conn-a") ?? 0,
    0,
    "the hydrated locked connection must receive zero upstream attempts"
  );
  assert.ok((upstreamAttempts.get("conn-b") ?? 0) >= 1, "the second target must actually be used");
});
