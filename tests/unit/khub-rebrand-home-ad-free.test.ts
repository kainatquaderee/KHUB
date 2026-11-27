/**
 * A1 (KHUB rebrand) — the Home route must be sponsor/partner-ad free, repo-wide.
 *
 * QA-owned verification of the KHUB rebrand change set. The three sponsor
 * banners and their version gate were deleted:
 *
 *   src/app/(dashboard)/dashboard/KimiSponsorBanner.tsx
 *   src/app/(dashboard)/dashboard/CheaperInferenceSponsorBanner.tsx
 *   src/app/(dashboard)/dashboard/VscodeCopilotBanner.tsx
 *   src/app/(dashboard)/dashboard/kimiSponsorBannerGate.ts
 *
 * The identifiers below are the *module* identifiers (PascalCase component
 * names + the gate module), deliberately not the camelCase i18n message
 * namespaces (`kimiSponsorBanner`, …) which are catalog entries, not imports.
 *
 * Bite: the guard function is exercised against the exact pre-change lines
 * (copied from `git show cd13c8b33:'src/app/(dashboard)/home/page.tsx'`), so a
 * version of this test that could not fail is not possible.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "src");
const HOME_DIR = path.join(ROOT, "src", "app", "(dashboard)", "home");
const DASHBOARD_DIR = path.join(ROOT, "src", "app", "(dashboard)", "dashboard");

const REMOVED_AD_IDENTIFIERS = [
  "KimiSponsorBanner",
  "CheaperInferenceSponsorBanner",
  "VscodeCopilotBanner",
  "kimiSponsorBannerGate",
] as const;

/** Code extensions only — i18n message catalogs live under src/i18n/messages. */
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".jsx", ".css"];

function findRemovedAdRefs(source: string): string[] {
  return REMOVED_AD_IDENTIFIERS.filter((identifier) => source.includes(identifier));
}

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "messages") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSourceFiles(full, out);
    else if (SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

const read = (file: string) => fs.readFileSync(file, "utf8");

test("no source file under src/ references a removed sponsor-banner module", () => {
  const files = walkSourceFiles(SRC_DIR);
  assert.ok(files.length > 500, `expected a populated src tree, scanned ${files.length} files`);

  const offenders = files
    .map((file) => ({ file: path.relative(ROOT, file), refs: findRemovedAdRefs(read(file)) }))
    .filter((entry) => entry.refs.length > 0);

  assert.deepEqual(
    offenders,
    [],
    "the KHUB build must not import/render the removed sponsor-banner modules"
  );
});

test("the four removed ad modules are absent from disk", () => {
  const removedFiles = [
    "KimiSponsorBanner.tsx",
    "CheaperInferenceSponsorBanner.tsx",
    "VscodeCopilotBanner.tsx",
    "kimiSponsorBannerGate.ts",
  ];
  for (const file of removedFiles) {
    assert.equal(
      fs.existsSync(path.join(DASHBOARD_DIR, file)),
      false,
      `${file} must stay deleted (KHUB is ad-free)`
    );
  }
});

test("the Home page and Home layout carry no banner reference", () => {
  for (const file of ["page.tsx", "layout.tsx"]) {
    const source = read(path.join(HOME_DIR, file));
    assert.deepEqual(
      findRemovedAdRefs(source),
      [],
      `src/app/(dashboard)/home/${file} must not reference a removed sponsor banner`
    );
  }
});

test("the Home route still renders its non-ad banners and its i18n provider (scoped deletion)", () => {
  const page = read(path.join(HOME_DIR, "page.tsx"));
  // Negative control: the change removed the ads, not the whole banner stack.
  for (const survivor of ["BootstrapBanner", "UnpricedUsageBanner", "NewsBanner"]) {
    assert.ok(page.includes(survivor), `Home must still render ${survivor}`);
  }
  const layout = read(path.join(HOME_DIR, "layout.tsx"));
  assert.match(layout, /SectionI18nProvider/, "HomeRouteLayout must still mount the i18n provider");
});

test("bite — the guard flags the pre-change Home page imports and JSX", () => {
  // Verbatim pre-change lines (git show cd13c8b33:'src/app/(dashboard)/home/page.tsx').
  const preChangeHomePage = [
    'import KimiSponsorBanner from "../dashboard/KimiSponsorBanner";',
    'import CheaperInferenceSponsorBanner from "../dashboard/CheaperInferenceSponsorBanner";',
    'import VscodeCopilotBanner from "../dashboard/VscodeCopilotBanner";',
    "      <KimiSponsorBanner />",
    "      <CheaperInferenceSponsorBanner />",
    "      <VscodeCopilotBanner />",
  ].join("\n");
  assert.deepEqual(findRemovedAdRefs(preChangeHomePage), [
    "KimiSponsorBanner",
    "CheaperInferenceSponsorBanner",
    "VscodeCopilotBanner",
  ]);
  assert.deepEqual(findRemovedAdRefs('import { kimiBannerGate } from "./kimiSponsorBannerGate";'), [
    "kimiSponsorBannerGate",
  ]);
});
