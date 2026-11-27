/**
 * NFR-1 — persistence hydration occupies the one safe place in the production
 * boot sequence: DB ready → stale crash-cooldown cleanup → hydration → combo
 * collision scan → server ready. A lockout must be in memory before routing is
 * advertised as ready, but only after the DB file and schema exist.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("../../src/instrumentation-node.ts", import.meta.url));
const source = fs.readFileSync(sourcePath, "utf8");
const registerStart = source.indexOf("export async function registerNodejs(");
assert.ok(registerStart >= 0, "registerNodejs() must exist in instrumentation-node.ts");

function positionOf(needle: string): number {
  const index = source.indexOf(needle, registerStart);
  assert.ok(index >= registerStart, `missing boot step: ${needle}`);
  return index;
}

test("NFR-1: model lockout hydration runs between crash cleanup and combo scan", () => {
  const order = [
    "markServerStarting();",
    "await ensureDbReadyForBoot();",
    "clearStaleCrashCooldowns()",
    "installAndHydrateModelLockoutPersistence()",
    "await scanComboModelNameCollisionsAtBoot();",
    "markServerReady();",
  ].map(positionOf);

  for (let i = 1; i < order.length; i += 1) {
    assert.ok(
      order[i - 1]! < order[i]!,
      `boot step ${i - 1} (index ${order[i - 1]}) must precede step ${i} (index ${order[i]})`
    );
  }
});

test("NFR-1: hydration is imported from the canonical module and cannot block boot", () => {
  assert.match(
    source.slice(registerStart),
    /await import\(\s*"@\/lib\/resilience\/modelLockoutHydration"\s*\)/,
    "boot must load the canonical hydration module"
  );
  const hydration = source.indexOf("const hydrated = installAndHydrateModelLockoutPersistence();");
  assert.ok(hydration >= registerStart);
  const catchIndex = source.indexOf("Model lockout hydration failed (non-fatal)", hydration);
  assert.ok(catchIndex > hydration, "hydration failure must be caught and logged as non-fatal");
});
