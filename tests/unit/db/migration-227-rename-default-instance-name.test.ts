// Migration 227 (KHUB rebrand) rewrites the stock default instance name for
// existing installs. `updateSettings()` stores values as JSON, so the stock
// value is the literal `"OmniRoute"` (quotes included). Only that exact
// settings/instanceName row is touched — a custom instanceName set by an
// operator must survive, and a second run is a no-op.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SqliteAdapter } from "../../../src/lib/db/adapters/types.ts";
import { openMemorySqliteAdapter } from "../_helpers/memorySqliteAdapter.ts";

const MIGRATION = "227_rename_default_instance_name_khub.sql";
const repoMigrations = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../src/lib/db/migrations"
);
const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-migration-227-"));
fs.copyFileSync(path.join(repoMigrations, MIGRATION), path.join(migrationsDir, MIGRATION));
const originalMigrationsDir = process.env.OMNIROUTE_MIGRATIONS_DIR;
process.env.OMNIROUTE_MIGRATIONS_DIR = migrationsDir;

const { runMigrations } = await import("../../../src/lib/db/migrationRunner.ts");

test.after(() => {
  fs.rmSync(migrationsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (originalMigrationsDir === undefined) delete process.env.OMNIROUTE_MIGRATIONS_DIR;
  else process.env.OMNIROUTE_MIGRATIONS_DIR = originalMigrationsDir;
});

function openDb(rows: Array<{ namespace: string; key: string; value: string }>): SqliteAdapter {
  const db = openMemorySqliteAdapter();
  db.exec(
    `CREATE TABLE key_value (
       namespace TEXT NOT NULL,
       key TEXT NOT NULL,
       value TEXT NOT NULL,
       PRIMARY KEY (namespace, key)
     );`
  );
  const insert = db.prepare("INSERT INTO key_value (namespace, key, value) VALUES (?, ?, ?)");
  for (const row of rows) insert.run(row.namespace, row.key, row.value);
  return db;
}

function readValue(db: SqliteAdapter, namespace: string, key: string): string | undefined {
  const row = db
    .prepare("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get(namespace, key) as { value?: string } | undefined;
  return row?.value;
}

test('the stored stock instanceName "OmniRoute" becomes "KHUB"', () => {
  const db = openDb([{ namespace: "settings", key: "instanceName", value: '"OmniRoute"' }]);
  try {
    assert.equal(runMigrations(db, { isNewDb: true }), 1);
    assert.equal(readValue(db, "settings", "instanceName"), '"KHUB"');
  } finally {
    db.close();
  }
});

test("a custom instanceName is never overwritten", () => {
  const db = openDb([{ namespace: "settings", key: "instanceName", value: '"Route Lab"' }]);
  try {
    assert.equal(runMigrations(db, { isNewDb: true }), 1);
    assert.equal(readValue(db, "settings", "instanceName"), '"Route Lab"');
  } finally {
    db.close();
  }
});

test("only the settings/instanceName row holding the stock value is touched", () => {
  const db = openDb([
    { namespace: "settings", key: "instanceName", value: '"OmniRoute"' },
    { namespace: "settings", key: "otherKey", value: '"OmniRoute"' },
    { namespace: "other", key: "instanceName", value: '"OmniRoute"' },
  ]);
  try {
    assert.equal(runMigrations(db, { isNewDb: true }), 1);
    assert.equal(readValue(db, "settings", "instanceName"), '"KHUB"');
    assert.equal(readValue(db, "settings", "otherKey"), '"OmniRoute"');
    assert.equal(readValue(db, "other", "instanceName"), '"OmniRoute"');
  } finally {
    db.close();
  }
});

test("a second run is a no-op", () => {
  const db = openDb([{ namespace: "settings", key: "instanceName", value: '"OmniRoute"' }]);
  try {
    assert.equal(runMigrations(db, { isNewDb: true }), 1);
    assert.equal(runMigrations(db, { isNewDb: true }), 0);
    assert.equal(readValue(db, "settings", "instanceName"), '"KHUB"');
  } finally {
    db.close();
  }
});
