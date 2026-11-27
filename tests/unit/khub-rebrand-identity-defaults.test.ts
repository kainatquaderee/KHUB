/**
 * A2 (KHUB rebrand) — app identity defaults to KHUB.
 *
 * Verified here:
 *   - `DEFAULT_ROOT_LAYOUT_SETTINGS.instanceName === "KHUB"`, observed through
 *     the real read path on a fresh install (fresh DATA_DIR, empty settings).
 *   - The root metadata title still templates `${instanceName} — AI Gateway
 *     for Multi-Provider LLMs`, so an operator-chosen name wins; the default
 *     document title is derived from the two independently obtained halves.
 *   - `APP_CONFIG.name === "KHUB"` (the sidebar brand fallback).
 *   - Electron shell surfaces: window title, auto-update notification, Linux
 *     autostart entry.
 *
 * The root document title is NOT asserted by importing src/app/layout.tsx
 * (it pulls in globals.css + next-intl/server, which the node:test runtime
 * cannot load). The template is therefore pinned as a declared *contract*
 * assertion against the layout source, while the instance-name half comes from
 * a real behavioural read.
 *
 * Bite: each source guard is the same function the passing test calls, and the
 * last test runs it over the verbatim pre-change text (git show cd13c8b33) and
 * requires it to report violations.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { APP_CONFIG } from "../../src/shared/constants/appConfig.ts";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** Documented title contract (A2). */
const TITLE_SUFFIX = " — AI Gateway for Multi-Provider LLMs";

const TEST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "omniroute-khub-identity-"));
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.DISABLE_SQLITE_AUTO_BACKUP = "true";

const core = await import("../../src/lib/db/core.ts");
const { getRootLayoutSettings } = await import("../../src/lib/db/rootLayoutSettings.ts");

test.after(() => {
  try {
    core.resetDbInstance();
  } catch {
    /* best effort */
  }
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Slice one top-level function out of a JS module source. */
function functionSection(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `electron/main.js declares ${signature}`);
  const nextTopLevel = source.indexOf("\nfunction ", start + signature.length);
  return source.slice(start, nextTopLevel === -1 ? undefined : nextTopLevel);
}

/** Returns the identity surfaces that are missing/regressed in an electron/main.js source. */
function electronIdentityProblems(source: string): string[] {
  const problems: string[] = [];
  const windowSection = functionSection(source, "function createWindow(");
  if (!windowSection.includes('title: "KHUB"')) problems.push("window title is not KHUB");
  if (windowSection.includes('title: "OmniRoute"')) problems.push("window title still OmniRoute");

  const updaterSection = functionSection(source, "function setupAutoUpdater(");
  if (!updaterSection.includes('title: "KHUB Update Ready"')) {
    problems.push("auto-update notification title is not 'KHUB Update Ready'");
  }

  const autostartSection = functionSection(source, "function enableLinuxDesktopAutostart(");
  if (!autostartSection.includes('"Name=KHUB"')) problems.push("autostart Name is not KHUB");
  if (!autostartSection.includes('"Comment=KHUB Desktop Client"')) {
    problems.push("autostart Comment is not 'KHUB Desktop Client'");
  }
  return problems;
}

test("APP_CONFIG.name is KHUB", () => {
  assert.equal(APP_CONFIG.name, "KHUB");
});

test("a fresh install defaults the instance name to KHUB and a custom name wins", async () => {
  const db = core.getDbInstance();
  const fresh = await getRootLayoutSettings();
  assert.equal(fresh.instanceName, "KHUB");
  assert.equal(`KHUB${TITLE_SUFFIX}`, "KHUB — AI Gateway for Multi-Provider LLMs");

  const write = db.prepare(
    "INSERT OR REPLACE INTO key_value (namespace, key, value) VALUES ('settings', 'instanceName', ?)"
  );

  // The value migration 227 must match on existing installs: updateSettings()
  // stores every value as JSON (src/lib/db/settings.ts), so the stock default
  // row is the literal `"OmniRoute"` — quotes included. Measured here rather
  // than assumed, because the migration's equality predicate depends on it.
  write.run(JSON.stringify("OmniRoute"));
  const stored = db
    .prepare("SELECT value FROM key_value WHERE namespace = 'settings' AND key = 'instanceName'")
    .get() as { value: string };
  assert.equal(stored.value, '"OmniRoute"');

  // A custom name wins: the reader does not clamp to the KHUB default.
  write.run(JSON.stringify("My Gateway"));
  const customised = await getRootLayoutSettings();
  assert.equal(customised.instanceName, "My Gateway");
  assert.equal(
    `${customised.instanceName}${TITLE_SUFFIX}`,
    "My Gateway — AI Gateway for Multi-Provider LLMs"
  );
});

test("contract — the root layout templates the documented title from the instance name", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(
    layout,
    /title: `\$\{instanceName\} — AI Gateway for Multi-Provider LLMs`/,
    "the root metadata title must stay templated on instanceName (a custom name wins)"
  );
  assert.match(layout, /const instanceName = settings\.instanceName;/);
  assert.match(layout, /await getRootLayoutSettings\(\)/);
  assert.match(layout, /applicationName: instanceName/);
  assert.ok(!layout.includes("KHUB — KHUB"), "the default name must not be doubled into the title");
});

test("electron window title, auto-update notification and autostart entry say KHUB", () => {
  assert.deepEqual(electronIdentityProblems(read("electron/main.js")), []);
});

test("bite — the electron identity guard flags the pre-change electron/main.js", () => {
  // Verbatim pre-change lines (git show cd13c8b33:electron/main.js), wrapped in
  // the three top-level function signatures the guard slices.
  const preChange = [
    "function createWindow() {",
    '  title: "OmniRoute",',
    "}",
    "function setupAutoUpdater() {",
    '  title: "OmniRoute Update Ready",',
    "}",
    "function enableLinuxDesktopAutostart() {",
    '  "Name=OmniRoute",',
    '  "Comment=OmniRoute Desktop Client",',
    "}",
  ].join("\n");

  assert.deepEqual(electronIdentityProblems(preChange), [
    "window title is not KHUB",
    "window title still OmniRoute",
    "auto-update notification title is not 'KHUB Update Ready'",
    "autostart Name is not KHUB",
    "autostart Comment is not 'KHUB Desktop Client'",
  ]);
});
