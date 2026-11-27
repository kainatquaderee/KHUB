/**
 * A3 (KHUB rebrand) — migration 227 on the REAL migration set, exercised the
 * way an upgrade actually happens.
 *
 * This file deliberately does NOT override `OMNIROUTE_MIGRATIONS_DIR`: the
 * runner uses `src/lib/db/migrations/` exactly as it does in production, so the
 * test proves the new file is discovered, ordered and applied by the shipped
 * runner, and that the row it rewrites is the row `getRootLayoutSettings()`
 * reads (a typo in the table, namespace or key name would fail here and nowhere
 * else).
 *
 * The only simulated part is the pre-upgrade state: a fresh install applies all
 * migrations, so the test deletes the `227` ledger row and writes the stock
 * default afterwards — the equivalent of a database that stopped at 226. That
 * ledger surgery is stated here rather than hidden.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "src", "lib", "db", "migrations");
const MIGRATION_FILE = "227_rename_default_instance_name_khub.sql";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-migration-227-real-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";
delete process.env.OMNIROUTE_MIGRATIONS_DIR;

const core = await import("../../../src/lib/db/core.ts");
const { getRootLayoutSettings } = await import("../../../src/lib/db/rootLayoutSettings.ts");
const { runMigrations } = await import("../../../src/lib/db/migrationRunner.ts");

test.after(() => {
  try {
    core.resetDbInstance();
  } catch {
    /* best effort */
  }
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const db = core.getDbInstance();

const writeInstanceName = (value: string) =>
  db
    .prepare(
      "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('settings', 'instanceName', ?)"
    )
    .run(JSON.stringify(value));

/** Simulate a database that stopped one migration before 227. */
const mark227Pending = () =>
  db.prepare("DELETE FROM _omniroute_migrations WHERE version = '227'").run();

const appliedVersions = (): string[] =>
  (db.prepare("SELECT version FROM _omniroute_migrations").all() as Array<{ version: string }>).map(
    (row) => row.version
  );

test("the runner applies migration 227 in the shipped ordering", () => {
  assert.ok(appliedVersions().includes("227"), "a clean install must record migration 227");

  // Ordering: the runner sorts the migration files itself (migrationRunner.ts
  // `.sort()`), so 227 has to be the successor of 226 for it to run after the
  // 226 schema and be the last file in the set.
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql"));
  assert.ok(files.includes(MIGRATION_FILE), `${MIGRATION_FILE} is present in the migrations dir`);
  const sorted = [...files].sort();
  const index = sorted.indexOf(MIGRATION_FILE);
  assert.equal(sorted[index - 1]?.slice(0, 3), "226", "227 sorts directly after 226");
  assert.equal(index, sorted.length - 1, "227 is the last migration in the shipped set");
});

test("an upgrade rewrites the stock default through the real read path", async () => {
  mark227Pending();
  writeInstanceName("OmniRoute");
  assert.equal(
    (await getRootLayoutSettings()).instanceName,
    "OmniRoute",
    "precondition: the pre-227 row reads back as OmniRoute"
  );

  assert.equal(runMigrations(db, { isNewDb: true }), 1, "exactly one pending migration");
  assert.equal(
    (await getRootLayoutSettings()).instanceName,
    "KHUB",
    "the row the migration rewrites must be the row the app reads"
  );
  assert.equal(runMigrations(db, { isNewDb: true }), 0, "the upgrade is idempotent");
  assert.equal((await getRootLayoutSettings()).instanceName, "KHUB");
});

test("an upgrade leaves an operator-chosen instance name alone", async () => {
  mark227Pending();
  writeInstanceName("My Gateway");

  assert.equal(runMigrations(db, { isNewDb: true }), 1);
  assert.equal((await getRootLayoutSettings()).instanceName, "My Gateway");
  assert.equal(runMigrations(db, { isNewDb: true }), 0);
  assert.equal((await getRootLayoutSettings()).instanceName, "My Gateway");
});
