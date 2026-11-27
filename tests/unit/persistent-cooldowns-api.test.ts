/**
 * AC-7/8/18 — the Cooldown Manager API reads hydrated state after a restart,
 * hides every credential column, and its clear operation is persisted.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-cooldowns-api-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = "persistent-cooldowns-api-test-secret";
process.env.INITIAL_PASSWORD = "bootstrap-password";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const apiKeysDb = await import("../../src/lib/db/apiKeys.ts");
const settingsDb = await import("../../src/lib/db/settings.ts");
const accountFallback = await import("../../open-sse/services/accountFallback.ts");
const { setModelLockoutPersistenceAdapter } =
  await import("../../open-sse/services/accountFallback/persistenceBridge.ts");
const { installAndHydrateModelLockoutPersistence } =
  await import("../../src/lib/resilience/modelLockoutHydration.ts");
const { readAllModelResilienceState } = await import("../../src/lib/db/modelLockoutState.ts");
const route = await import("../../src/app/api/resilience/cooldowns/route.ts");

const DAY = 86_400_000;
const MODEL = "gpt-5.6-luna";
const SECRETS = [
  "sk-api-key-do-not-leak",
  "access-token-do-not-leak",
  "refresh-token-do-not-leak",
  "id-token-do-not-leak",
  "owner@example-do-not-leak.test",
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
];

test.after(() => {
  accountFallback.clearAllModelLockouts({ persist: false });
  setModelLockoutPersistenceAdapter(null);
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  delete process.env.INITIAL_PASSWORD;
});

function url(pathname: string): string {
  return `https://example.com${pathname}`;
}

function authHeaders(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}`, "content-type": "application/json" };
}

async function bodyText(response: Response): Promise<string> {
  const text = await response.text();
  for (const secret of SECRETS) {
    assert.equal(text.includes(secret), false, `response leaked ${secret}`);
  }
  for (const key of FORBIDDEN_KEYS) {
    assert.equal(text.includes(`"${key}"`), false, `response exposed forbidden key ${key}`);
  }
  return text;
}

test("AC-7/8/18: persisted lockout survives restart and is exposed safely by GET", async () => {
  await settingsDb.updateSettings({ requireLogin: true, password: "" });
  const manageKey = await apiKeysDb.createApiKey("cooldowns-admin", "machine-cooldowns", [
    "manage",
  ]);
  const connection = await providersDb.createProviderConnection({
    provider: "codex",
    authType: "oauth",
    name: "hydrated connection",
    apiKey: SECRETS[0],
    accessToken: SECRETS[1],
    refreshToken: SECRETS[2],
    idToken: SECRETS[3],
    email: SECRETS[4],
    providerSpecificData: { access_token: SECRETS[1], api_key: SECRETS[0] },
    isActive: true,
    testStatus: "active",
  });
  const connectionId = String(connection.id);

  installAndHydrateModelLockoutPersistence();
  accountFallback.clearAllModelLockouts({ persist: false });
  // Exact scope keeps the real model id in the Cooldown Manager listing; a
  // quota-family Codex lock is intentionally reported as the `codex` family.
  accountFallback.lockExactModel("codex", connectionId, MODEL, "quota_exhausted", 7 * DAY, {
    failureCount: 2,
    resetAfterMs: 30 * 60_000,
  });
  assert.equal(readAllModelResilienceState().length, 1, "lockout must be persisted before restart");

  // Fresh process: only SQLite survives; hydration rebuilds the routing map.
  accountFallback.clearAllModelLockouts({ persist: false });
  const hydration = installAndHydrateModelLockoutPersistence();
  assert.equal(hydration.restored, 1);

  const unauthorizedProbe = await route.GET(new Request(url("/api/resilience/cooldowns")));
  assert.ok([401, 403].includes(unauthorizedProbe.status));
  await bodyText(unauthorizedProbe);

  const authorizedGet = await route.GET(
    new Request(url("/api/resilience/cooldowns"), { headers: authHeaders(manageKey.key) })
  );
  assert.equal(authorizedGet.status, 200);
  const payload = JSON.parse(await bodyText(authorizedGet)) as {
    connections: Array<{
      id: string;
      status: string;
      lockouts: Array<{ model: string; reason: string; remainingMs: number }>;
    }>;
  };

  const target = payload.connections.find((entry) => entry.id === connectionId);
  assert.ok(target, "hydrated connection must be listed");
  assert.notEqual(target!.status, "healthy");
  assert.equal(target!.status, "rate_limited");
  assert.deepEqual(
    target!.lockouts.map((entry) => entry.model),
    [MODEL]
  );
  assert.equal(target!.lockouts[0]!.reason, "quota_exhausted");
  assert.ok(target!.lockouts[0]!.remainingMs > 6 * DAY, "absolute deadline must survive restart");
});

test("AC-18: empty clear payload is rejected and leaves lockout unchanged", async () => {
  const manageKey = await apiKeysDb.createApiKey("cooldowns-empty", "machine-cooldowns", [
    "manage",
  ]);
  const invalid = await route.POST(
    new Request(url("/api/resilience/cooldowns"), {
      method: "POST",
      headers: authHeaders(manageKey.key),
      body: "{}",
    })
  );
  assert.equal(invalid.status, 400);
  await bodyText(invalid);

  assert.equal(readAllModelResilienceState().length, 1, "invalid request must not clear state");
  assert.equal(
    accountFallback.getModelLockoutInfo(
      "codex",
      readAllModelResilienceState()[0]!.connectionId,
      MODEL
    )?.failureCount,
    2
  );
});

test("AC-18: unauthenticated GET/POST are rejected without data", async () => {
  const getResponse = await route.GET(new Request(url("/api/resilience/cooldowns")));
  assert.ok([401, 403].includes(getResponse.status));
  await bodyText(getResponse);

  const postResponse = await route.POST(
    new Request(url("/api/resilience/cooldowns"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    })
  );
  assert.ok([401, 403].includes(postResponse.status));
  await bodyText(postResponse);
  assert.equal(readAllModelResilienceState().length, 1, "unauthenticated clear must not persist");
});

test("AC-8: authorised clear removes the lockout and survives another restart", async () => {
  const manageKey = await apiKeysDb.createApiKey("cooldowns-clear", "machine-cooldowns", [
    "manage",
  ]);
  const connection = readAllModelResilienceState()[0]!.connectionId;
  const response = await route.POST(
    new Request(url("/api/resilience/cooldowns"), {
      method: "POST",
      headers: authHeaders(manageKey.key),
      body: JSON.stringify({ connectionIds: [connection] }),
    })
  );
  assert.equal(response.status, 200);
  const result = (await response.json()) as { lockoutsCleared: number };
  assert.equal(result.lockoutsCleared, 1);
  assert.equal(readAllModelResilienceState().length, 0, "clear must be persisted");

  accountFallback.clearAllModelLockouts({ persist: false });
  const hydration = installAndHydrateModelLockoutPersistence();
  assert.equal(hydration.restored, 0);
  assert.equal(accountFallback.isModelLocked("codex", connection, MODEL), false);
});
