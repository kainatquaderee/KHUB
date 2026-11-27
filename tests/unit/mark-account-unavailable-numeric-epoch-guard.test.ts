/**
 * TDD regression: the anti-thundering-herd guard inside `markAccountUnavailable`
 * (src/sse/services/auth.ts) must read legacy numeric-epoch cooldowns through
 * the tolerant `cooldownUntilMs` normalizer adopted for #3954, not a raw
 * `new Date(conn.rateLimitedUntil)`.
 *
 * Current writers persist canonical ISO UTC, but pre-feature rows in the TEXT
 * `rate_limited_until` column still hold a numeric string (e.g.
 * "1781696905131" or SQLite's REAL→TEXT "1781696905131.0"). `new Date(...)` on
 * those strings is Invalid Date (NaN), so `NaN > Date.now()` is false and the
 * guard never detects "already marked unavailable" for these connections.
 *
 * Effect: a second concurrent 429/failure on a connection already cooling down
 * from a long (e.g. 1h quota-exhaustion) legacy cooldown gets treated as a
 * brand-new failure — the guard is bypassed, `checkFallbackError` computes a
 * fresh (much shorter) base cooldown, and it OVERWRITES the long cooldown,
 * making the connection selectable again far sooner than intended.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-guard-"));
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");
const { invalidateDbCache } = await import("../../src/lib/db/readCache.ts");
const { parseCooldownUntilMs } =
  await import("../../src/lib/resilience/persistedResilienceCodec.ts");
const { markAccountUnavailable } = await import("../../src/sse/services/auth.ts");

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const HOUR = 3_600_000;

function readConnectionRow(connId: string) {
  const db = core.getDbInstance() as unknown as {
    prepare: (sql: string) => {
      get: (id: string) => { rate_limited_until: unknown; backoff_level: unknown } | undefined;
    };
  };
  return db
    .prepare("SELECT rate_limited_until, backoff_level FROM provider_connections WHERE id = ?")
    .get(connId);
}

/** Seed the legacy TEXT shape directly — current writers now persist ISO UTC. */
function seedLegacyEpochCooldown(connId: string, untilMs: number): void {
  const db = core.getDbInstance() as unknown as {
    prepare: (sql: string) => { run: (...params: unknown[]) => unknown };
  };
  db.prepare("UPDATE provider_connections SET rate_limited_until = ? WHERE id = ?").run(
    `${untilMs}.0`,
    connId
  );
  // Raw SQL bypasses the domain helper's cache invalidation; the guard reads
  // through the connection read cache, so make it see the seeded row.
  invalidateDbCache("connections", connId, { skipModelCatalog: true });
}

test("markAccountUnavailable does not shorten an existing numeric-epoch cooldown (anti-thundering-herd guard)", async () => {
  const conn = await providersDb.createProviderConnection({
    provider: "antigravity",
    authType: "oauth",
    name: "AG guard test",
  });
  const connId = (conn as { id: string }).id;

  // Simulate a pre-feature Antigravity full-quota row: a long (1h) cooldown
  // stored as numeric TEXT (SQLite REAL→TEXT form) by an older process.
  const longCooldownUntil = Date.now() + HOUR;
  seedLegacyEpochCooldown(connId, longCooldownUntil);

  const before = readConnectionRow(connId);
  assert.ok(
    /^\d+(\.\d+)?$/.test(String(before?.rate_limited_until)),
    `expected numeric epoch string, got ${String(before?.rate_limited_until)}`
  );
  assert.equal(
    parseCooldownUntilMs(before?.rate_limited_until as string | number | null),
    longCooldownUntil
  );

  // A second, concurrent 429 hits the SAME connection while it is still cooling.
  // The anti-thundering-herd guard should short-circuit and leave the existing
  // (longer) cooldown untouched.
  await markAccountUnavailable(connId, 429, "rate limited", "antigravity");

  const after = readConnectionRow(connId);
  const afterUntilMs = parseCooldownUntilMs(after?.rate_limited_until as string | number | null);

  assert.ok(
    afterUntilMs !== null && afterUntilMs >= longCooldownUntil - 1_000,
    `guard must not shorten the cooldown: expected >= ${longCooldownUntil}, got ${afterUntilMs}`
  );
  assert.equal(
    Number(after?.backoff_level ?? 0),
    Number(before?.backoff_level ?? 0),
    "backoff level must not be double-incremented by a deduped duplicate mark"
  );
});
