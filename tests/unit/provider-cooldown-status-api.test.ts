/**
 * AC1 — GET /api/providers attaches the Cooldown Manager's own per-connection
 * verdict (`cooldownStatus`) to every connection, so the client never has to
 * re-derive health. The field defaults to `"healthy"` when the Cooldown Manager
 * has no row for a connection (its list is capped, and older payloads/caches
 * predate the field).
 *
 * The Cooldown Manager is the source of truth: this test reads it directly
 * (`connectionCooldownStatusById` / `listConnectionCooldowns`) and asserts the
 * API response matches, including a connection whose id is beyond the cap.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-provider-cooldown-status-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.API_KEY_SECRET = process.env.API_KEY_SECRET ?? "provider-cooldown-status-test-secret";
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const accountFallback = await import("../../open-sse/services/accountFallback.ts");
const manager = await import("../../src/lib/resilience/cooldownManager.ts");
const route = await import("../../src/app/api/providers/route.ts");

const IN_TEN_MINUTES = () => new Date(Date.now() + 10 * 60_000).toISOString();

async function resetStorage() {
  accountFallback.clearAllModelLockouts();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  delete process.env.INITIAL_PASSWORD;
}

let seq = 0;
async function seed(provider: string, overrides: Record<string, unknown> = {}) {
  seq += 1;
  return providersDb.createProviderConnection({
    provider,
    authType: "apikey",
    apiKey: `sk-test-${provider}-${seq}`,
    isActive: true,
    testStatus: "active",
    ...overrides,
  });
}

async function getConnections(provider?: string): Promise<Array<Record<string, unknown>>> {
  const url = `http://localhost/api/providers${provider ? `?provider=${provider}` : ""}`;
  const response = await route.GET(new Request(url));
  assert.equal(response.status, 200);
  const body = (await response.json()) as { connections: Array<Record<string, unknown>> };
  return body.connections;
}

test.after(() => {
  accountFallback.clearAllModelLockouts();
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("AC1: every connection carries the Cooldown Manager's own status", async () => {
  await resetStorage();

  const limited = await seed("tokenharbor", {
    name: "limited",
    errorCode: 429,
    lastErrorType: "rate_limited",
    lastError: "429 free allowance used",
  });
  const healthy = await seed("tokenharbor", { name: "healthy" });
  const cooling = await seed("tokenharbor", { name: "cooling" });
  await providersDb.updateProviderConnection(cooling.id, {
    testStatus: "unavailable",
    rateLimitedUntil: IN_TEN_MINUTES(),
    errorCode: 502,
    lastErrorType: "server_error",
  });
  const banned = await seed("tokenharbor", { name: "banned", testStatus: "banned" });
  const locked = await seed("tokenharbor", { name: "locked" });
  accountFallback.lockModel(
    "tokenharbor",
    locked.id,
    "gpt-6-luna-max",
    "model_unavailable",
    600_000
  );

  const statuses = await manager.connectionCooldownStatusById();
  const connections = await getConnections("tokenharbor");
  const byId = new Map(connections.map((c) => [String(c.id), c]));

  assert.equal(connections.length, 5);
  for (const connection of connections) {
    const id = String(connection.id);
    assert.ok("cooldownStatus" in connection, `connection ${id} must carry cooldownStatus`);
    assert.equal(connection.cooldownStatus, statuses.get(id) ?? "healthy", `connection ${id}`);
  }

  // The states the provider page has to agree with the Cooldown Manager on.
  assert.equal(byId.get(limited.id)!.cooldownStatus, "rate_limited");
  assert.equal(byId.get(healthy.id)!.cooldownStatus, "healthy");
  assert.equal(byId.get(cooling.id)!.cooldownStatus, "cooling_down");
  assert.equal(byId.get(banned.id)!.cooldownStatus, "terminal");
  assert.equal(byId.get(locked.id)!.cooldownStatus, "model_locked");

  // Cross-check against the /resilience page's own listing for the same provider.
  const listById = new Map(
    (await manager.listConnectionCooldowns("tokenharbor")).map((c) => [c.id, c.status])
  );
  for (const [id, connection] of byId) {
    assert.equal(connection.cooldownStatus, listById.get(id), `connection ${id}`);
  }
});

test("AC1: a connection the Cooldown Manager did not list still reads healthy", async () => {
  await resetStorage();

  // The Cooldown Manager caps its list at CONNECTION_LIMIT (1000) rows, so the
  // 1001st connection has no row in the map the route builds. Seed them all as
  // rate-limited: the 1000 that make the cap must read "rate_limited", and the
  // one beyond it must fall back to the documented "healthy" default.
  const TOTAL = 1001;
  const db = core.getDbInstance();
  const nowIso = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO provider_connections
       (id, provider, auth_type, is_active, priority, test_status, error_code, last_error_type, created_at, updated_at)
     VALUES (?, 'tokenharbor', 'apikey', 1, 0, 'active', '429', 'rate_limited', ?, ?)`
  );
  const ids = Array.from({ length: TOTAL }, (_, i) => `bulk-${String(i).padStart(4, "0")}`);
  db.transaction((rows: string[]) => {
    for (const id of rows) insert.run(id, nowIso, nowIso);
  })(ids);

  const statuses = await manager.connectionCooldownStatusById();
  const connections = await getConnections("tokenharbor");

  assert.equal(connections.length, TOTAL);
  const missing = connections.filter((c) => !statuses.has(String(c.id)));
  assert.equal(
    missing.length,
    TOTAL - statuses.size,
    "the Cooldown Manager map is capped, leaving the overflow unlisted"
  );
  for (const connection of connections) {
    assert.equal(connection.cooldownStatus, statuses.get(String(connection.id)) ?? "healthy");
  }
  for (const connection of missing) {
    assert.equal(
      connection.cooldownStatus,
      "healthy",
      "an unlisted connection must fall back to healthy, not be dropped or mislabelled"
    );
  }
  assert.equal(
    connections.filter((c) => c.cooldownStatus === "rate_limited").length,
    statuses.size
  );
});
