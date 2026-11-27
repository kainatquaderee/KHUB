/**
 * A3 (KHUB rebrand) — adversarial semantics of migration
 * `227_rename_default_instance_name_khub.sql`.
 *
 * QA-owned. Complements the developer's
 * tests/unit/db/migration-227-rename-default-instance-name.test.ts, which pins
 * the happy path; this file attacks the equality predicate and the scope of the
 * UPDATE:
 *
 *   - only the exact JSON literal `"OmniRoute"` (the encoding updateSettings()
 *     writes) is rewritten — near-misses (case, whitespace, prefix, unquoted,
 *     empty, non-JSON) are left alone;
 *   - the row is addressed by (namespace = 'settings', key = 'instanceName'):
 *     a different namespace, a different key and a prefix-namespace are untouched;
 *   - a missing row is not an error;
 *   - re-running is a no-op (idempotent) and never clobbers a custom name.
 *
 * The final test is a mutation probe: the assertions used above are run against
 * deliberately broken variants of the migration SQL and must FAIL, which is what
 * proves the assertions bite rather than pass by construction.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SqliteAdapter } from "../../../src/lib/db/adapters/types.ts";
import { openMemorySqliteAdapter } from "../_helpers/memorySqliteAdapter.ts";

type Row = { namespace: string; key: string; value: string };

const MIGRATION = "227_rename_default_instance_name_khub.sql";
const repoMigrations = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../src/lib/db/migrations"
);
const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-migration-227-qa-"));
fs.copyFileSync(path.join(repoMigrations, MIGRATION), path.join(migrationsDir, MIGRATION));
const MIGRATION_SQL = fs.readFileSync(path.join(migrationsDir, MIGRATION), "utf8");

const originalMigrationsDir = process.env.OMNIROUTE_MIGRATIONS_DIR;
process.env.OMNIROUTE_MIGRATIONS_DIR = migrationsDir;

const { runMigrations } = await import("../../../src/lib/db/migrationRunner.ts");

test.after(() => {
  fs.rmSync(migrationsDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (originalMigrationsDir === undefined) delete process.env.OMNIROUTE_MIGRATIONS_DIR;
  else process.env.OMNIROUTE_MIGRATIONS_DIR = originalMigrationsDir;
});

const STOCK = JSON.stringify("OmniRoute"); // '"OmniRoute"' — the encoding updateSettings() writes.
const CUSTOM = JSON.stringify("My Gateway"); // '"My Gateway"'

function seedDb(rows: Row[]): SqliteAdapter {
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

function readRows(db: SqliteAdapter): Row[] {
  return db
    .prepare<Row>("SELECT namespace, key, value FROM key_value ORDER BY namespace, key")
    .all();
}

function valueOf(db: SqliteAdapter, namespace: string, key: string): string | undefined {
  return db
    .prepare<{ value: string }>("SELECT value FROM key_value WHERE namespace = ? AND key = ?")
    .get(namespace, key)?.value;
}

/** Run the real migration file through the real migration runner. */
function runMigrationSql(rows: Row[]): { db: SqliteAdapter; applied: number } {
  const db = seedDb(rows);
  const applied = runMigrations(db, { isNewDb: true });
  return { db, applied };
}

test("the exact stored default is rewritten to the KHUB JSON literal", () => {
  const { db, applied } = runMigrationSql([
    { namespace: "settings", key: "instanceName", value: STOCK },
  ]);
  assert.equal(applied, 1, "the migration is applied on an untouched ledger");
  assert.equal(valueOf(db, "settings", "instanceName"), JSON.stringify("KHUB"));
  assert.equal(readRows(db).length, 1, "no row is inserted or deleted");
});

test("near-miss values are never rewritten", () => {
  const nearMisses: Array<[string, string]> = [
    ["trailing space inside the JSON string", JSON.stringify("OmniRoute ")],
    ["leading space inside the JSON string", JSON.stringify(" OmniRoute")],
    ["suffix", JSON.stringify("OmniRoute2")],
    ["prefix", JSON.stringify("MyOmniRoute")],
    ["lowercase", JSON.stringify("omniroute")],
    ["uppercase", JSON.stringify("OMNIROUTE")],
    ["unquoted (not JSON encoded)", "OmniRoute"],
    ["single-quoted SQL-ish", "'OmniRoute'"],
    ["empty string", ""],
    ["JSON null", "null"],
    ["already KHUB", JSON.stringify("KHUB")],
  ];

  for (const [label, value] of nearMisses) {
    const { db, applied } = runMigrationSql([
      { namespace: "settings", key: "instanceName", value },
    ]);
    assert.equal(applied, 1);
    assert.equal(
      valueOf(db, "settings", "instanceName"),
      value,
      `near-miss value must survive: ${label}`
    );
    assert.equal(readRows(db).length, 1);
  }
});

test("only the (settings, instanceName) row is in scope", () => {
  const { db, applied } = runMigrationSql([
    { namespace: "settings", key: "instanceName", value: STOCK },
    { namespace: "settings", key: "InstanceName", value: STOCK },
    { namespace: "settings", key: "instanceName2", value: STOCK },
    { namespace: "settings", key: "customFaviconUrl", value: STOCK },
    { namespace: "settings2", key: "instanceName", value: STOCK },
    { namespace: "setting", key: "instanceName", value: STOCK },
    { namespace: "logs", key: "instanceName", value: STOCK },
  ]);
  assert.equal(applied, 1);

  assert.equal(valueOf(db, "settings", "instanceName"), JSON.stringify("KHUB"));
  for (const [namespace, key] of [
    ["settings", "InstanceName"],
    ["settings", "instanceName2"],
    ["settings", "customFaviconUrl"],
    ["settings2", "instanceName"],
    ["setting", "instanceName"],
    ["logs", "instanceName"],
  ]) {
    assert.equal(valueOf(db, namespace, key), STOCK, `${namespace}/${key} must be untouched`);
  }
});

test("a missing row is not an error and inserts nothing", () => {
  const { db, applied } = runMigrationSql([
    { namespace: "settings", key: "customFaviconUrl", value: "" },
  ]);
  assert.equal(applied, 1);
  assert.equal(valueOf(db, "settings", "instanceName"), undefined);
  assert.equal(readRows(db).length, 1);

  const empty = runMigrationSql([]);
  assert.equal(empty.applied, 1);
  assert.deepEqual(readRows(empty.db), []);
});

test("re-running is idempotent and never clobbers a custom name", () => {
  const db = seedDb([
    { namespace: "settings", key: "instanceName", value: STOCK },
    { namespace: "settings", key: "customFaviconUrl", value: CUSTOM },
  ]);
  assert.equal(runMigrations(db, { isNewDb: true }), 1);
  assert.equal(valueOf(db, "settings", "instanceName"), JSON.stringify("KHUB"));
  assert.equal(runMigrations(db, { isNewDb: true }), 0, "second run applies nothing");
  assert.equal(runMigrations(db, { isNewDb: true }), 0, "third run applies nothing");
  assert.equal(valueOf(db, "settings", "instanceName"), JSON.stringify("KHUB"));
  assert.equal(valueOf(db, "settings", "customFaviconUrl"), CUSTOM);

  // A custom instance name written after the migration is never revisited.
  db.prepare(
    "UPDATE key_value SET value = ? WHERE namespace = 'settings' AND key = 'instanceName'"
  ).run(CUSTOM);
  assert.equal(runMigrations(db, { isNewDb: true }), 0);
  assert.equal(valueOf(db, "settings", "instanceName"), CUSTOM);
});

test("bite — mutation probe: broken variants of the migration SQL violate the assertions above", () => {
  const dropLineContaining = (needle: string) =>
    MIGRATION_SQL.split("\n")
      .filter((line) => !line.includes(needle))
      .join("\n");

  const applySql = (sql: string, rows: Row[]): SqliteAdapter => {
    const db = seedDb(rows);
    db.exec(sql);
    return db;
  };

  // 1. Drop the `value = '"OmniRoute"'` guard: a custom name is clobbered.
  const withoutValueGuard = dropLineContaining("AND value =");
  assert.ok(withoutValueGuard !== MIGRATION_SQL, "the mutation actually changed the SQL");
  const clobbered = applySql(withoutValueGuard, [
    { namespace: "settings", key: "instanceName", value: CUSTOM },
  ]);
  assert.equal(
    valueOf(clobbered, "settings", "instanceName"),
    JSON.stringify("KHUB"),
    "without the value guard a custom name IS rewritten — so the near-miss assertions bite"
  );

  // 2. Drop the `key = 'instanceName'` guard: another settings key is rewritten.
  const withoutKeyGuard = dropLineContaining("AND key =");
  const wrongKey = applySql(withoutKeyGuard, [
    { namespace: "settings", key: "customFaviconUrl", value: STOCK },
  ]);
  assert.equal(
    valueOf(wrongKey, "settings", "customFaviconUrl"),
    JSON.stringify("KHUB"),
    "without the key guard the wrong row IS rewritten — so the scope assertions bite"
  );

  // 3. Replace the namespace guard: another namespace's instanceName is rewritten.
  const withoutNamespaceGuard = MIGRATION_SQL.replace(
    "WHERE namespace = 'settings'",
    "WHERE 1 = 1"
  );
  assert.ok(
    withoutNamespaceGuard !== MIGRATION_SQL,
    "the namespace mutation actually changed the SQL"
  );
  const wrongNamespace = applySql(withoutNamespaceGuard, [
    { namespace: "logs", key: "instanceName", value: STOCK },
  ]);
  assert.equal(
    valueOf(wrongNamespace, "logs", "instanceName"),
    JSON.stringify("KHUB"),
    "without the namespace guard the wrong namespace IS rewritten"
  );

  // 4. A different replacement value: the "becomes KHUB" expectation is not tautological.
  const differentReplacement = MIGRATION_SQL.replace(`'"KHUB"'`, `'"Khub"'`);
  assert.ok(differentReplacement !== MIGRATION_SQL, "the replacement mutation applied");
  const renamed = applySql(differentReplacement, [
    { namespace: "settings", key: "instanceName", value: STOCK },
  ]);
  assert.equal(valueOf(renamed, "settings", "instanceName"), JSON.stringify("Khub"));
  assert.notEqual(valueOf(renamed, "settings", "instanceName"), JSON.stringify("KHUB"));
});
