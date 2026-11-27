/**
 * AC-11 — upstream error text is never a persistence or API payload. Only
 * enumerated reason codes and the Cooldown Manager's explicit column allowlist
 * leave this boundary.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-secret-allowlist-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const accountFallback = await import("../../open-sse/services/accountFallback.ts");
const { setModelLockoutPersistenceAdapter } =
  await import("../../open-sse/services/accountFallback/persistenceBridge.ts");
const { installAndHydrateModelLockoutPersistence } =
  await import("../../src/lib/resilience/modelLockoutHydration.ts");
const { readAllModelResilienceState } = await import("../../src/lib/db/modelLockoutState.ts");
const { listConnectionCooldowns } = await import("../../src/lib/resilience/cooldownManager.ts");

const MALICIOUS_REASON = "Bearer sk-live-secret api_key=sk-live-2";
const SECRETS = [
  "sk-live-secret",
  "sk-live-2",
  "Bearer sk-live-secret",
  "access-token-secret",
  "refresh-token-secret",
  "id-token-secret",
  "owner-secret@example.test",
];
const FORBIDDEN_KEYS = [
  "api_key",
  "apiKey",
  "access_token",
  "accessToken",
  "refresh_token",
  "refreshToken",
  "id_token",
  "idToken",
  "email",
  "provider_specific_data",
  "providerSpecificData",
];

test.after(() => {
  accountFallback.clearAllModelLockouts({ persist: false });
  setModelLockoutPersistenceAdapter(null);
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function assertNoSecrets(value: string): void {
  for (const secret of SECRETS) {
    assert.equal(value.includes(secret), false, `secret leaked: ${secret}`);
  }
}

let connectionId = "";

test("AC-11: malicious upstream reason is reduced to an allowlisted reason code", async () => {
  installAndHydrateModelLockoutPersistence();
  accountFallback.clearAllModelLockouts({ persist: false });
  const connection = await providersDb.createProviderConnection({
    provider: "codex",
    authType: "oauth",
    name: "secret-bearing connection",
    apiKey: "sk-api-key-secret",
    accessToken: "access-token-secret",
    refreshToken: "refresh-token-secret",
    idToken: "id-token-secret",
    email: "owner-secret@example.test",
    providerSpecificData: { access_token: "access-token-secret", api_key: "sk-live-2" },
    isActive: true,
    testStatus: "active",
  });
  connectionId = String(connection.id);
  accountFallback.lockExactModel(
    "codex",
    connectionId,
    "model-secret",
    MALICIOUS_REASON,
    3_600_000
  );

  const rows = readAllModelResilienceState();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.reasonCode, "unknown");
  assertNoSecrets(JSON.stringify(rows));

  const lockouts = accountFallback.getAllModelLockouts();
  assert.equal(lockouts[0]!.reason, "unknown");
  assertNoSecrets(JSON.stringify(lockouts));
});

test("AC-11: Cooldown Manager returns only allowlisted columns and sanitized reasons", async () => {
  const connections = await listConnectionCooldowns("codex");
  const listed = connections.find((entry) => entry.id === connectionId);
  assert.ok(listed, "secret-bearing connection must be listed");
  for (const key of FORBIDDEN_KEYS) {
    assert.equal(key in (listed as Record<string, unknown>), false, `forbidden column ${key}`);
  }
  assert.equal(listed!.lockouts[0]!.reason, "unknown");
  assertNoSecrets(JSON.stringify(connections));
});
