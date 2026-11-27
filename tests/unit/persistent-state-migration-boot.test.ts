/**
 * AC-13 — migration 226 adds the persistent model-resilience table without
 * touching existing provider cooldown rows, and is safe to replay at boot.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const repoMigrations = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/lib/db/migrations"
);
const migrationFile = "226_model_resilience_state.sql";
const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-migration-226-"));
fs.copyFileSync(path.join(repoMigrations, migrationFile), path.join(migrationsDir, migrationFile));

const previousMigrationsDir = process.env.OMNIROUTE_MIGRATIONS_DIR;
process.env.OMNIROUTE_MIGRATIONS_DIR = migrationsDir;
const { runMigrations } = await import("../../src/lib/db/migrationRunner.ts");

test.after(() => {
  fs.rmSync(migrationsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (previousMigrationsDir === undefined) delete process.env.OMNIROUTE_MIGRATIONS_DIR;
  else process.env.OMNIROUTE_MIGRATIONS_DIR = previousMigrationsDir;
});

function tableColumns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name
  );
}

test("AC-13: migration 226 creates absolute-timestamp columns and preserves connection rows", () => {
  const db = new Database(":memory:");
  const until = "2026-12-01T00:00:00.000Z";
  try {
    db.exec("CREATE TABLE provider_connections (id TEXT PRIMARY KEY, rate_limited_until TEXT)");
    db.prepare("INSERT INTO provider_connections (id, rate_limited_until) VALUES (?, ?)").run(
      "conn-226",
      until
    );

    assert.equal(runMigrations(db, { isNewDb: true }), 1);

    const columns = tableColumns(db, "model_resilience_state");
    for (const column of [
      "state_key",
      "provider",
      "connection_id",
      "scope",
      "model_scope",
      "reason_code",
      "lock_until_ms",
      "locked_at_ms",
      "failure_count",
      "last_failure_at_ms",
      "reset_after_ms",
      "last_cooldown_ms",
    ]) {
      assert.ok(columns.includes(column), `missing column ${column}`);
    }

    const indexes = new Set(
      (
        db.prepare("PRAGMA index_list(model_resilience_state)").all() as Array<{ name: string }>
      ).map((row) => row.name)
    );
    assert.ok(indexes.has("idx_model_resilience_state_expiry"));
    assert.ok(indexes.has("idx_model_resilience_state_conn"));

    const connection = db
      .prepare("SELECT rate_limited_until FROM provider_connections WHERE id = ?")
      .get("conn-226") as { rate_limited_until: string };
    assert.equal(connection.rate_limited_until, until, "existing cooldown data must survive");
  } finally {
    db.close();
  }
});

test("AC-13: replaying migration 226 is a no-op and keeps hydrated rows", () => {
  const db = new Database(":memory:");
  try {
    assert.equal(runMigrations(db, { isNewDb: true }), 1);
    const now = Date.now();
    db.prepare(
      `INSERT INTO model_resilience_state (
         state_key, provider, connection_id, scope, model_scope, reason_code,
         lock_until_ms, locked_at_ms, failure_count, last_failure_at_ms,
         reset_after_ms, last_cooldown_ms, created_at, updated_at
       ) VALUES (?, 'codex', 'conn-226', 'exact', 'gpt-5.6-luna', 'rate_limit', ?, ?, 1, ?, 0, NULL, ?, ?)`
    ).run(
      "codex:conn-226:exact:gpt-5.6-luna",
      now + 60_000,
      now,
      now,
      new Date(now).toISOString(),
      new Date(now).toISOString()
    );

    assert.equal(runMigrations(db), 0, "replay must not re-apply migration 226");
    const row = db.prepare("SELECT lock_until_ms FROM model_resilience_state").get() as {
      lock_until_ms: number;
    };
    assert.equal(row.lock_until_ms, now + 60_000);
  } finally {
    db.close();
  }
});
