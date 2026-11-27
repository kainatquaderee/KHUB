/**
 * Regression guard: the Home page must not render sponsorship/partner ads.
 *
 * The KHUB build removed the Kimi, CheaperInference and VS Code Copilot
 * banners. This test fails if any of them (or their version gate) is
 * reintroduced into the /home render path.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const HOME_PAGE = path.join(ROOT, "src/app/(dashboard)/home/page.tsx");
const DASHBOARD_DIR = path.join(ROOT, "src/app/(dashboard)/dashboard");

const REMOVED_BANNER_COMPONENTS = [
  "KimiSponsorBanner",
  "CheaperInferenceSponsorBanner",
  "VscodeCopilotBanner",
] as const;

test("Home page does not reference a sponsorship/partner banner", () => {
  const source = readFileSync(HOME_PAGE, "utf8");
  for (const name of REMOVED_BANNER_COMPONENTS) {
    assert.ok(
      !source.includes(name),
      `src/app/(dashboard)/home/page.tsx must not reference ${name} — Home is ad-free (KHUB)`
    );
  }
});

test("the deleted sponsor banner modules stay deleted", () => {
  const removedFiles = [
    ...REMOVED_BANNER_COMPONENTS.map((name) => `${name}.tsx`),
    "kimiSponsorBannerGate.ts",
  ];
  for (const file of removedFiles) {
    assert.ok(
      !existsSync(path.join(DASHBOARD_DIR, file)),
      `src/app/(dashboard)/dashboard/${file} must stay deleted — Home is ad-free (KHUB)`
    );
  }
});
