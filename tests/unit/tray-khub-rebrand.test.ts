/**
 * KHUB rebrand — the tray is user-visible branding, so every tray label and tooltip
 * must say KHUB and none may say OmniRoute. Covers the CLI tray menu (buildMenuItems),
 * the Unix systray / Windows PowerShell tray scripts, and the Electron main process
 * tray (asserted at source level: main.js only runs inside Electron, not under Node).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMenuItems } from "../../bin/cli/tray/tray.ts";

const REPO_ROOT = join(import.meta.dirname, "../..");
const read = (relativePath: string) => readFileSync(join(REPO_ROOT, relativePath), "utf8");

test("buildMenuItems labels use the KHUB brand", () => {
  const titles = buildMenuItems({ port: 20128, autostartEnabled: false }).map((item) => item.title);

  assert.ok(titles.includes("Open KHUB Dashboard"), `missing Open entry: ${titles.join(", ")}`);
  assert.ok(titles.includes("Quit KHUB"), `missing Quit entry: ${titles.join(", ")}`);
  assert.ok(
    !titles.some((title) => title.includes("OmniRoute")),
    `menu labels still say OmniRoute: ${titles.join(", ")}`
  );
});

test("Electron tray menu item and tooltip use KHUB", () => {
  const source = read("electron/main.js");

  assert.match(source, /label: "Open KHUB",\s*click: \(\) => showMainWindow\(\)/);
  assert.ok(!source.includes('label: "Open OmniRoute"'), "tray menu still opens OmniRoute");
  assert.ok(source.includes('tray.setToolTip("KHUB")'), "tray tooltip is not KHUB");
  assert.ok(!source.includes('tray.setToolTip("OmniRoute")'), "tray tooltip still says OmniRoute");
});

test("CLI systray and Windows tray scripts use KHUB labels", () => {
  const systray = read("bin/cli/tray/traySystray.mjs");
  const windows = read("bin/cli/tray/trayWindows.mjs");
  const tray = read("bin/cli/tray/tray.ts");

  assert.ok(systray.includes("KHUB  •  port ${port}"), "systray title is not KHUB");
  assert.ok(systray.includes("KHUB — port ${port}"), "systray tooltip is not KHUB");
  assert.ok(systray.includes('"Open KHUB Dashboard"'), "systray open label is not KHUB");
  assert.ok(systray.includes('"Quit KHUB"'), "systray quit label is not KHUB");
  assert.ok(!systray.includes('"OmniRoute'), "systray still has an OmniRoute string literal");

  assert.ok(windows.includes('$tray.Text = "KHUB - Port ${port}"'), "Windows tooltip is not KHUB");
  assert.ok(windows.includes('"Open KHUB Dashboard"'), "Windows open label is not KHUB");
  assert.ok(windows.includes('"Quit KHUB"'), "Windows quit label is not KHUB");
  assert.ok(!windows.includes('"OmniRoute'), "Windows tray still has an OmniRoute string literal");

  assert.ok(tray.includes('title: "KHUB"'), "Unix systray title is not KHUB");
  assert.ok(!tray.includes('title: "OmniRoute"'), "Unix systray title still says OmniRoute");
});
